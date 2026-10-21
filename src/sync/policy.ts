/**
 * Konto-Abgleich: reine Entscheidungslogik (ohne Netzwerk, ohne DOM, ohne Uhr).
 *
 * Modell: optimistische Versionierung. Der Datensatz in der Cloud trägt eine Version,
 * die jeder erfolgreiche Push um 1 erhöht, und `actionVersion` – die Version des letzten
 * Pushs, der eine Spieleraktion enthielt. Weil das Spiel deterministisch ist (Zeit nur
 * über lastTick), unterscheiden sich zwei Geräte ohne neue Aktionen nur in der Uhr: Ein
 * fremder Push ohne Aktion muss nicht übernommen werden, nur die Version rückt nach.
 */

/** Aktionen höchstens so oft pushen (gedrosselt). */
export const ACTION_THROTTLE_MS = 1000;
/** Ohne Aktion: so oft den laufenden Stand sichern. */
export const PERIODIC_MS = 15_000;
/** Wartezeit nach dem ersten Fehler; verdoppelt sich je weiterem Fehler. */
export const BACKOFF_BASE_MS = 2000;
/** Längste Wartezeit zwischen zwei Versuchen. */
export const BACKOFF_MAX_MS = 5 * 60_000;

/** Wartezeit vor dem nächsten Versuch nach `failures` Fehlern in Folge (0 → keine). */
export function backoffMs(failures: number): number {
  if (!(failures > 0)) return 0;
  // Ab 30 Fehlern wäre 2^n ohnehin weit über dem Maximum (und Infinity bleibt endlich).
  const n = Math.min(Math.floor(failures), 30);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export interface PushTiming {
  /** Zeitpunkt des letzten Push-Versuchs (ms), -Infinity = noch nie. */
  lastAttemptAt: number;
  /** Seit dem letzten erfolgreichen Push gab es eine Spieleraktion. */
  pendingAction: boolean;
  /** Fehler in Folge (0 = der letzte Versuch gelang). */
  failures: number;
  /** Periodische Pushes erlaubt (z. B. nur bei sichtbarem Tab). */
  active: boolean;
}

/**
 * Wann der nächste Push fällig ist (ms). Infinity = gerade keiner. Nach Fehlern zählt der
 * Backoff, sonst: Aktion gedrosselt nach ACTION_THROTTLE_MS, ohne Aktion alle PERIODIC_MS.
 */
export function nextPushAt(t: PushTiming): number {
  const last = Number.isFinite(t.lastAttemptAt) ? t.lastAttemptAt : -Infinity;
  if (t.failures > 0) {
    if (!t.pendingAction && !t.active) return Infinity;
    return last + backoffMs(t.failures);
  }
  if (t.pendingAction) return last + ACTION_THROTTLE_MS;
  return t.active ? last + PERIODIC_MS : Infinity;
}

/** Wie weit ein Spielstand ist – zum Vergleich bei der ersten Anmeldung auf einem Gerät. */
export interface Progress {
  /** Nummer des laufenden Zyklus. */
  cycle: number;
  /** Wachstum über alle Zyklen. */
  lifetimeGrowth: number;
  /** Spielzeit über alle Zyklen in Sekunden. */
  playSeconds: number;
}

/** Ungültige Zahlen (NaN, negativ) zählen als 0, damit kaputte Stände nie gewinnen. */
function safe(n: number): number {
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

/** > 0: a ist weiter als b, < 0: b ist weiter, 0: gleich weit. Reihenfolge: Zyklus, Wachstum, Spielzeit. */
export function compareProgress(a: Progress, b: Progress): number {
  for (const key of ['cycle', 'lifetimeGrowth', 'playSeconds'] as const) {
    const x = safe(a[key]);
    const y = safe(b[key]);
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Kopfdaten eines Cloud-Datensatzes (ohne den Spielstand selbst). */
export interface RemoteMeta {
  version: number;
  actionVersion: number;
  device: string;
  /** Spielstand-Version (SAVE_VERSION) des schreibenden Spiels; fehlt = unbekannt (0). */
  schema?: number;
}

/** Stammt der Datensatz aus einer neueren Spielversion als `saveVersion`? */
export function isNewerSchema(remote: RemoteMeta, saveVersion: number): boolean {
  const schema = remote.schema ?? 0;
  return Number.isFinite(schema) && schema > saveVersion;
}

export interface InitialInput {
  /** Datensatz in der Cloud (null = noch keiner). */
  remote: RemoteMeta | null;
  /**
   * Version, auf der der lokale Stand für dieses Konto zuletzt beruhte (null = dieses Gerät
   * hat mit diesem Konto noch nie abgeglichen → erste Anmeldung).
   */
  base: number | null;
  /** Lokaler Stand und Cloud-Stand (für die erste Anmeldung). */
  localProgress: Progress | null;
  /** null = Cloud-Stand unlesbar. */
  remoteProgress: Progress | null;
  /** Kennung dieses Geräts: Stammt der Cloud-Stand von hier, ist er unsere eigene Linie. */
  device: string;
  /**
   * Der lokale Stand gehört nachweislich zu einem anderen Konto (zuletzt mit ihm
   * abgeglichen) – dann gewinnt bei der ersten Anmeldung immer der Cloud-Stand.
   */
  localForeign: boolean;
}

export type InitialDecision =
  /** Noch kein Datensatz: lokalen Stand anlegen. */
  | { kind: 'insert' }
  /** Lokalen Stand über die Cloud-Version `version` schreiben. */
  | { kind: 'push'; version: number; firstLogin: boolean }
  /** Cloud-Stand übernehmen. */
  | { kind: 'take'; firstLogin: boolean }
  /** Cloud-Stand unlesbar: weder übernehmen noch darüber schreiben. */
  | { kind: 'blocked' };

/**
 * Abgleich beim Anmelden bzw. beim Start mit bestehender Sitzung.
 * - Unlesbarer Cloud-Stand: blockiert (nie darüber schreiben).
 * - Stammt der Cloud-Stand von diesem Gerät (die Antwort auf den Push ging verloren): Er
 *   ist unsere eigene Linie, der lokale Stand ihre Fortsetzung → pushen.
 * - Kennt das Gerät die Linie (base): Gab es seitdem eine fremde Aktion → übernehmen, sonst
 *   ist der lokale Stand die Fortsetzung → pushen.
 * - Erste Anmeldung: Gehört der lokale Stand zu einem anderen Konto → Cloud. Sonst gewinnt
 *   der weiter fortgeschrittene Stand (Gleichstand → Cloud).
 */
export function decideInitial(input: InitialInput): InitialDecision {
  const { remote, base } = input;
  if (!remote) return { kind: 'insert' };
  if (!input.remoteProgress) return { kind: 'blocked' };
  const known = base !== null && Number.isFinite(base);
  if (remote.device !== '' && remote.device === input.device) return { kind: 'push', version: remote.version, firstLogin: false };
  if (known) {
    return remote.actionVersion > base ? { kind: 'take', firstLogin: false } : { kind: 'push', version: remote.version, firstLogin: false };
  }
  if (!input.localProgress || input.localForeign) return { kind: 'take', firstLogin: true };
  return compareProgress(input.localProgress, input.remoteProgress) > 0
    ? { kind: 'push', version: remote.version, firstLogin: true }
    : { kind: 'take', firstLogin: true };
}

export type RemoteReaction =
  /** Eigenes Echo oder veraltet: nichts tun. */
  | 'ignore'
  /** Fremder Push ohne neue Aktion: nur die bekannte Version nachziehen. */
  | 'advance'
  /** Fremde Aktion: Cloud-Stand übernehmen. */
  | 'take';

/** Reaktion auf eine Änderungsmeldung (Realtime) zum eigenen Datensatz. */
export function reactToRemote(known: number, change: RemoteMeta, device: string): RemoteReaction {
  if (!(change.version > known)) return 'ignore';
  // Eigenes Echo (z. B. Antwort auf den Push ging verloren): Der Stand stammt von hier.
  if (change.device === device) return 'advance';
  return change.actionVersion > known ? 'take' : 'advance';
}

/**
 * Konflikt beim Push (die Cloud ist weiter als `known`): Stammt der Cloud-Stand von diesem
 * Gerät, ist er ein eigener Push, dessen Antwort verloren ging – der lokale Stand ist seine
 * Fortsetzung → darüber schreiben (nie den älteren Schnappschuss übernehmen). Gab es seitdem
 * eine fremde Aktion, gewinnt die Cloud (die eigene, noch nicht gepushte Aktion geht
 * verloren). Sonst enthält die Cloud nur Zeit, die der lokale Stand auch hat → darüber.
 */
export function resolveConflict(known: number, remote: RemoteMeta, device: string): 'take' | 'push' {
  if (remote.device !== '' && remote.device === device) return 'push';
  return remote.actionVersion > known ? 'take' : 'push';
}
