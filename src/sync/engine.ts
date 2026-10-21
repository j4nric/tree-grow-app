/**
 * Abgleich des Spielstands mit der Cloud – ohne DOM, ohne eigene Uhr, ohne Netzwerk-
 * Bibliothek: Zeit kommt über `host.clock()`, die Cloud über das SyncBackend. So läuft
 * derselbe Code mit dem eigenen Sync-Server (http-service.ts) und mit der Fake-Cloud in Vitest.
 *
 * Ablauf: `start()` gleicht einmal ab (decideInitial), danach ruft der Aufrufer `poll()`
 * regelmäßig (z. B. jede Sekunde) – dort fallen gedrosselte Aktions-Pushes, periodische
 * Pushes und Wiederholungen nach Fehlern (Backoff) an. Änderungen anderer Geräte kommen
 * über das Abo. Nie Datenverlust durch Netzfehler: Der lokale Stand bleibt unberührt, bis
 * ein Push gelingt oder eine fremde Aktion übernommen wird.
 */
import {
  backoffMs,
  decideInitial,
  isNewerSchema,
  nextPushAt,
  reactToRemote,
  resolveConflict,
  type Progress,
  type RemoteMeta,
} from './policy';
import type { RemoteSave, SaveWrite, SyncBackend, WriteResult } from './types';

/** Gespeicherte Grundlage des lokalen Stands (je Konto, im localStorage des Aufrufers). */
export interface SyncBase {
  /** Cloud-Version, auf der der lokale Stand beruht. */
  version: number;
  /** Seitdem gab es eine Aktion, die noch nicht in der Cloud ist. */
  pending: boolean;
}

/**
 * Warum der Abgleich angehalten ist (der lokale Stand bleibt dabei immer unberührt):
 * - 'outdated': In der Cloud liegt ein Stand einer neueren Spielversion → Seite neu laden.
 *   Bleibt bis zum Neuladen; dieses Gerät schreibt nichts mehr.
 * - 'cloud-unreadable': Der Cloud-Stand ist kaputt → nicht darüber schreiben; später erneut prüfen.
 * - 'local-invalid': Der eigene Stand ließe sich nicht wieder importieren (z. B. zu groß) → nicht senden.
 * - 'backup-failed': Ein Stand, der ersetzt würde, ließ sich nicht sichern (Speicher voll) →
 *   nichts ersetzen; später erneut versuchen.
 */
export type SyncProblem = 'outdated' | 'cloud-unreadable' | 'local-invalid' | 'backup-failed';

export type SyncPhase = 'connecting' | 'synced' | 'offline' | SyncProblem;

export interface SyncStatus {
  phase: SyncPhase;
  /** Letzter erfolgreicher Abgleich (host.clock), null = noch keiner. */
  lastSyncedAt: number | null;
}

export type SyncEvent =
  /** Erste Anmeldung auf diesem Gerät: welcher Stand gewonnen hat. */
  | { kind: 'first-login'; winner: 'local' | 'cloud' }
  /** Stand eines anderen Geräts übernommen; `lostLocal`: eine eigene Aktion ging dabei verloren. */
  | { kind: 'taken'; lostLocal: boolean };

/** Warum der lokale Stand gesichert wird (siehe BackupReason in storage.ts). */
export type LocalBackupReason = 'first-login-local' | 'lost-action' | 'before-take';

/** Ergebnis der Prüfung eines Text-Codes: lesbar, aus neuerer Spielversion, unlesbar. */
export type CodeCheck = 'ok' | 'newer' | 'invalid';

export interface SyncHost {
  clock(): number;
  /** SAVE_VERSION dieses Spiels. */
  readonly saveVersion: number;
  /** Aktueller Spielstand als Text-Code. */
  snapshot(): string;
  /** Ließe sich der Code in diesem Spiel importieren? */
  check(data: string): CodeCheck;
  /** Fortschritt des aktuellen lokalen Stands (null = nichts Nennenswertes). */
  localProgress(): Progress | null;
  /** Fortschritt eines Cloud-Stands; null = unlesbar. */
  progressOf(data: string): Progress | null;
  /**
   * Cloud-Stand übernehmen (laden, nachrechnen, anzeigen). `ageMs`: Alter nach Serverzeit
   * (fehlt = unbekannt). false = unlesbar, nichts geändert.
   */
  apply(data: string, ageMs?: number): boolean;
  /** Lokalen Stand sichern, bevor er ersetzt wird. */
  backup(reason: LocalBackupReason): boolean;
  /** Cloud-Stand sichern, bevor er bei der ersten Anmeldung ersetzt werden könnte. */
  backupCloud(data: string): boolean;
  /** Der lokale Stand wurde zuletzt mit einem anderen Konto abgeglichen. */
  localIsForeign(): boolean;
  /** Periodische Pushes erlaubt (sichtbarer Tab)? */
  isActive(): boolean;
  loadBase(): SyncBase | null;
  saveBase(base: SyncBase): void;
  onStatus(status: SyncStatus): void;
  onEvent(event: SyncEvent): void;
}

/** Abgleich angehalten (siehe SyncProblem) – kein Netzfehler, aber auch kein Erfolg. */
class SyncBlocked extends Error {
  constructor(readonly problem: SyncProblem) {
    super(problem);
  }
}

/** So oft hintereinander wird ein Konflikt beim Push höchstens aufgelöst (dann Backoff). */
const MAX_CONFLICT_ROUNDS = 3;

export class SyncEngine {
  private known = 0;
  private ready = false;
  private busy = false;
  private stopped = false;
  private recheck = false;
  private pendingAction = false;
  private failures = 0;
  private problem: SyncProblem | null = null;
  private lastAttemptAt = -Infinity;
  private lastSyncedAt: number | null = null;
  private lastPhase: SyncPhase | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly backend: SyncBackend,
    private readonly host: SyncHost,
    private readonly device: string,
  ) {}

  /** Abo starten und einmal abgleichen. Fehler werden nicht geworfen (poll versucht es erneut). */
  async start(): Promise<void> {
    if (this.stopped || this.unsubscribe) return;
    this.unsubscribe = this.backend.subscribe((change) => this.onRemote(change));
    this.pendingAction = this.host.loadBase()?.pending ?? false;
    this.emitStatus();
    await this.run(() => this.initial());
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  get status(): SyncStatus {
    return { phase: this.phase(), lastSyncedAt: this.lastSyncedAt };
  }

  /** Bekannte Cloud-Version (für Tests und Anzeige). */
  get version(): number {
    return this.known;
  }

  /** Gibt es eine Aktion, die noch nicht in der Cloud ist (z. B. vor dem Abmelden)? */
  get hasUnsent(): boolean {
    return this.pendingAction;
  }

  /** Eine Spieleraktion ist passiert: bald (gedrosselt) pushen. */
  markAction(): void {
    if (this.stopped) return;
    const was = this.pendingAction;
    this.pendingAction = true;
    // Nur beim Wechsel auf „offen“ speichern (eine Schreibung je Aktion genügt sonst).
    if (this.ready && !was) this.host.saveBase({ version: this.known, pending: true });
  }

  /** Regelmäßig aufrufen: startet fällige Pushes bzw. Wiederholungen. */
  poll(): Promise<void> {
    if (this.stopped || this.busy || this.problem === 'outdated') return Promise.resolve();
    const now = this.host.clock();
    if (!this.ready) {
      if (now < this.lastAttemptAt + backoffMs(this.failures)) return Promise.resolve();
      return this.run(() => this.initial());
    }
    if (this.recheck) {
      if (now < this.lastAttemptAt + backoffMs(this.failures)) return Promise.resolve();
      return this.run(() => this.refresh());
    }
    const due = nextPushAt({
      lastAttemptAt: this.lastAttemptAt,
      pendingAction: this.pendingAction,
      failures: this.failures,
      active: this.host.isActive(),
    });
    return now >= due ? this.run(() => this.push()) : Promise.resolve();
  }

  /** Sofort pushen (z. B. beim Verlassen der Seite), ohne Drosselung. */
  flush(): Promise<void> {
    if (this.stopped || this.busy || !this.ready || this.recheck || this.problem === 'outdated') return Promise.resolve();
    return this.run(() => this.push());
  }

  // --- intern ---------------------------------------------------------------------

  private phase(): SyncPhase {
    if (this.problem) return this.problem;
    if (this.failures > 0) return 'offline';
    return this.ready ? 'synced' : 'connecting';
  }

  private emitStatus(force = false): void {
    const phase = this.phase();
    if (!force && phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.host.onStatus(this.status);
  }

  /** Führt eine Netz-Aufgabe aus: nie zwei gleichzeitig, Fehler → Backoff. */
  private async run(task: () => Promise<void>): Promise<void> {
    if (this.stopped || this.busy || this.problem === 'outdated') return;
    this.busy = true;
    this.lastAttemptAt = this.host.clock();
    try {
      await task();
    } catch (error) {
      if (!this.stopped) {
        // Angehalten oder Netzfehler: später (mit Backoff) erneut versuchen – außer bei
        // 'outdated', das bis zum Neuladen bleibt.
        if (error instanceof SyncBlocked) this.problem = error.problem;
        this.failures++;
      }
      this.emitStatus();
    } finally {
      this.busy = false;
    }
    // Während der Aufgabe kam eine Änderungsmeldung: gleich nachsehen.
    if (!this.stopped && this.ready && this.recheck && this.failures === 0) await this.run(() => this.refresh());
  }

  private succeeded(): void {
    // Nach stop() (abgemeldet, anderes Konto) nichts mehr für dieses Konto speichern.
    if (this.stopped) return;
    this.failures = 0;
    this.problem = null;
    this.lastSyncedAt = this.host.clock();
    this.host.saveBase({ version: this.known, pending: this.pendingAction });
    this.emitStatus(true);
  }

  /**
   * Darf dieser Cloud-Stand übernommen werden – und darf darüber geschrieben werden?
   * Neuere Spielversion → 'outdated' (nie übernehmen, nie überschreiben). Unlesbar →
   * 'cloud-unreadable' (später erneut nachsehen).
   */
  private ensureReadable(remote: RemoteSave): void {
    if (isNewerSchema(remote, this.host.saveVersion)) throw new SyncBlocked('outdated');
    const check = this.host.check(remote.data);
    if (check === 'newer') throw new SyncBlocked('outdated');
    if (check !== 'ok') {
      this.recheck = true;
      throw new SyncBlocked('cloud-unreadable');
    }
  }

  /** Schreib-Ergebnis auswerten: 'outdated' hält den Abgleich an. */
  private written(result: WriteResult): 'ok' | 'conflict' {
    if (result === 'outdated') throw new SyncBlocked('outdated');
    return result;
  }

  private async initial(): Promise<void> {
    this.recheck = false;
    const remote = await this.backend.fetch();
    if (this.stopped) return;
    if (remote) this.ensureReadable(remote);
    const base = this.host.loadBase();
    const localProgress = this.host.localProgress();
    const decision = decideInitial({
      remote,
      base: base?.version ?? null,
      localProgress,
      remoteProgress: remote ? this.host.progressOf(remote.data) : null,
      device: this.device,
      localForeign: this.host.localIsForeign(),
    });
    if (decision.kind === 'blocked') {
      this.recheck = true;
      throw new SyncBlocked('cloud-unreadable');
    }
    if (decision.kind !== 'insert' && decision.firstLogin) {
      // Erste Anmeldung: beide Stände sichern, bevor einer den anderen ersetzt.
      const savedCloud = this.host.backupCloud(remote!.data);
      const savedLocal = !localProgress || this.host.backup('first-login-local');
      if (!savedCloud || !savedLocal) throw new SyncBlocked('backup-failed');
    }
    if (decision.kind === 'insert') {
      const result = this.written(await this.backend.insert(this.write(1, true)));
      if (this.stopped) return;
      if (result === 'conflict') throw new Error('conflict'); // anderes Gerät war schneller → erneut
      this.known = 1;
      this.pendingAction = false;
    } else if (decision.kind === 'push') {
      // Erste Anmeldung oder offene Aktion: die anderen Geräte sollen den Stand übernehmen.
      const action = decision.firstLogin || this.pendingAction;
      const write = this.write(decision.version + 1, action);
      const result = this.written(await this.backend.update(decision.version, write));
      if (this.stopped) return;
      if (result === 'conflict') throw new Error('conflict');
      this.known = write.version;
      this.pendingAction = false;
      if (decision.firstLogin) this.host.onEvent({ kind: 'first-login', winner: 'local' });
    } else {
      // remote ist hier gesetzt (decideInitial liefert 'take' nur mit Datensatz).
      const lost = !decision.firstLogin && this.pendingAction;
      // Sicherheitsnetz: Vor dem Ersetzen beim Start immer den lokalen Stand sichern (bei
      // der ersten Anmeldung oben schon geschehen) – auch wenn keine offene Aktion bekannt ist.
      // Eine überholte eigene Aktion nie ohne Sicherung ersetzen (Speicher voll → anhalten).
      if (!decision.firstLogin && localProgress && !this.host.backup(lost ? 'lost-action' : 'before-take') && lost) {
        throw new SyncBlocked('backup-failed');
      }
      this.take(remote!);
      if (decision.firstLogin) this.host.onEvent({ kind: 'first-login', winner: 'cloud' });
      else if (lost) this.host.onEvent({ kind: 'taken', lostLocal: true });
    }
    this.ready = true;
    this.succeeded();
  }

  /**
   * Neuer Datensatz für Version `version`; mit Aktion → actionVersion = version. Ein Stand,
   * den dieses Spiel selbst nicht wieder importieren könnte, wird nie gesendet.
   */
  private write(version: number, action: boolean): SaveWrite {
    const data = this.host.snapshot();
    if (this.host.check(data) !== 'ok') throw new SyncBlocked('local-invalid');
    const row: SaveWrite = { data, version, device: this.device, schema: this.host.saveVersion };
    if (action) row.actionVersion = version;
    return row;
  }

  /** Übernimmt einen (geprüften) Cloud-Stand. */
  private take(remote: RemoteSave): void {
    if (!this.host.apply(remote.data, remote.ageMs)) {
      // Trotz Prüfung nicht ladbar: nichts ändern, nicht darüber schreiben.
      this.recheck = true;
      throw new SyncBlocked('cloud-unreadable');
    }
    this.known = remote.version;
    this.pendingAction = false;
  }

  private async push(): Promise<void> {
    for (let round = 0; round < MAX_CONFLICT_ROUNDS; round++) {
      const action = this.pendingAction;
      const write = this.write(this.known + 1, action);
      this.pendingAction = false;
      let result: 'ok' | 'conflict';
      try {
        result = this.written(await this.backend.update(this.known, write));
      } catch (error) {
        // Netzfehler oder angehalten: die Aktion bleibt offen.
        if (action) this.pendingAction = true;
        throw error;
      }
      if (this.stopped) return;
      if (result === 'ok') {
        this.known = write.version;
        this.succeeded();
        return;
      }
      if (action) this.pendingAction = true;
      const remote = await this.backend.fetch();
      if (this.stopped) return;
      if (!remote) {
        // Datensatz verschwunden (z. B. in der Cloud gelöscht): neu anlegen.
        this.known = 0;
        if (this.written(await this.backend.insert(this.write(1, true))) === 'conflict') continue;
        this.known = 1;
        this.pendingAction = false;
        this.succeeded();
        return;
      }
      this.ensureReadable(remote);
      if (resolveConflict(this.known, remote, this.device) === 'take') {
        const lost = this.pendingAction;
        if (lost && !this.host.backup('lost-action')) throw new SyncBlocked('backup-failed');
        this.take(remote);
        this.host.onEvent({ kind: 'taken', lostLocal: lost });
        this.succeeded();
        return;
      }
      // Nur fremde Zeit oder unser eigener Push: lokal auf der neuen Version weiterschreiben.
      this.known = remote.version;
    }
    throw new Error('conflict');
  }

  /** Änderungsmeldung aus dem Abo. */
  private onRemote(change: RemoteMeta | null): void {
    if (this.stopped || this.problem === 'outdated') return;
    // Ein Gerät mit neuerer Spielversion hat geschrieben: sofort anhalten.
    if (change && isNewerSchema(change, this.host.saveVersion)) {
      this.problem = 'outdated';
      this.emitStatus();
      return;
    }
    // Während des ersten Abgleichs: danach noch einmal nachsehen.
    if (!this.ready) {
      this.recheck = true;
      return;
    }
    if (change === null || this.busy) {
      this.recheck = true;
      if (!this.busy) void this.run(() => this.refresh());
      return;
    }
    const reaction = reactToRemote(this.known, change, this.device);
    if (reaction === 'ignore') return;
    if (reaction === 'advance') {
      this.known = change.version;
      this.host.saveBase({ version: this.known, pending: this.pendingAction });
      return;
    }
    this.recheck = true;
    void this.run(() => this.refresh());
  }

  /** Cloud-Stand holen und wie eine Änderungsmeldung behandeln. */
  private async refresh(): Promise<void> {
    this.recheck = false;
    const remote = await this.backend.fetch();
    if (this.stopped) return;
    if (!remote) {
      // Kein Datensatz (mehr): Der nächste Push legt ihn neu an.
      this.succeeded();
      return;
    }
    const reaction = reactToRemote(this.known, remote, this.device);
    // War der Abgleich wegen eines unlesbaren Stands angehalten, auch denselben erneut prüfen.
    if (reaction !== 'ignore' || this.problem === 'cloud-unreadable') this.ensureReadable(remote);
    if (reaction === 'advance') {
      this.known = remote.version;
    } else if (reaction === 'take') {
      const lost = this.pendingAction;
      if (lost && !this.host.backup('lost-action')) {
        this.recheck = true;
        throw new SyncBlocked('backup-failed');
      }
      this.take(remote);
      this.host.onEvent({ kind: 'taken', lostLocal: lost });
    }
    this.succeeded();
  }
}
