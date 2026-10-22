// Konto-Abgleich systematisch: Abfolgen aus
//   je Tab: Anmelden A/B, Abmelden, lokal spielen, neu laden, neu laden mitten im Senden,
//           Sicherung wiederherstellen
//   global: anderes Gerät schreibt in A/B, zweiter Tab, Netzfehler (vor/nach dem Schreiben,
//           Sitzung weg = 401, 422 neuere Spielversion, 507 Server voll), Live-Meldungen gehen
//           verloren
// – über einen Fake-Server, einen gemeinsamen Fake-localStorage und den echten Kern
// (controller.ts + engine.ts). Jeder Takt speichert jeden Tab (Autosave).
//
// Geprüft wird:
// (a) Ein Spiel, das zuletzt als Konto X gespielt wurde, landet nie in der Cloud eines
//     anderen Kontos Y mit vorhandenem Stand (nur in eine leere Cloud darf es – danach ist
//     es Y's Linie, seine Fortsetzungen sind erlaubt).
// (b) Jeder Stand, den der Abgleich (oder „Wiederherstellen“) ersetzt hat und dessen Aktionen
//     danach weder in einer Cloud noch lokal (Speicher eines Tabs, gespeicherter Stand)
//     vorkommen, liegt nach JEDEM Schritt als Sicherung im Ring – auch am Ende noch.
// (c) Nur in der Familie „zwei Tabs mit demselben Konto“ (unten): Keine je gemachte Aktion
//     verschwindet, ohne in einer Cloud, einem offenen Tab, dem gespeicherten Stand oder im
//     Ring zu liegen.
//
// Der Prüfstand (World, Tab, run, runSameAccount) steht in tests/sync-harness.ts; die
// vollständige Aufzählung „zwei Tabs, Länge 4“ ist auf tests/sync-same4-*.test.ts verteilt.
import { describe, expect, it } from 'vitest';
import { FROZEN_TEXT } from '../src/sync/controller';
import { BACKUP_KEY, addBackup, readBackups, readBase, readMeta, readOwner } from '../src/sync/storage';
import { MemoryStorage } from './memory-storage';
import {
  SAME4_PARTS,
  SAME_STEPS,
  SAVE,
  STEPS,
  Tab,
  World,
  decode,
  encode,
  label,
  reload,
  rng,
  run,
  runSameAccount,
  sameLabel,
  sameLength4,
  settle,
} from './sync-harness';

describe('Konto-Abgleich: alle Abfolgen', () => {
  it('Länge 3 vollständig, alle Startlagen der Clouds', async () => {
    for (const [cloudA, cloudB] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      for (const a of STEPS)
        for (const b of STEPS)
          for (const c of STEPS) {
            const steps = [a, b, c];
            const violations = await run(steps, cloudA, cloudB);
            if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
          }
    }
  }, 600_000);

  it('4000 zufällige Abfolgen der Länge 8', async () => {
    const random = rng(20261021);
    for (let i = 0; i < 4000; i++) {
      const steps = Array.from({ length: 8 }, () => STEPS[Math.floor(random() * STEPS.length)]!);
      const cloudA = random() < 0.7;
      const cloudB = random() < 0.7;
      const violations = await run(steps, cloudA, cloudB);
      if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
    }
  }, 600_000);

  it('1500 zufällige Abfolgen der Länge 8 mit knappem Speicher (Quota)', async () => {
    const random = rng(4711);
    for (let i = 0; i < 1500; i++) {
      const steps = Array.from({ length: 8 }, () => STEPS[Math.floor(random() * STEPS.length)]!);
      const limit = 900 + Math.floor(random() * 1200);
      const violations = await run(steps, true, random() < 0.7, limit);
      if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (Limit ${limit})`).toEqual([]);
    }
  }, 600_000);

  it('die Prüfungen schlagen an (Gegenprobe ohne Schutz)', async () => {
    // A's Spiel direkt in B's Cloud schreiben → Verstoß (a); ohne Sicherung → Verstoß (b).
    const world = new World(new MemoryStorage());
    world.otherDevice('B');
    const old = world.clouds.get('B')!;
    world.write('B', { data: encode({ account: 'A', actions: ['x'] }), version: old.version + 1, actionVersion: 9, device: 'd' }, false);
    world.checkBackups();
    expect(world.violations.some((v) => v.startsWith('(a)'))).toBe(true);
    expect(world.violations.some((v) => v.startsWith('(b)'))).toBe(true);
    // Liegt der alte Stand im Ring, ist (b) erfüllt.
    const ok = new World(new MemoryStorage());
    ok.otherDevice('B');
    const before = ok.clouds.get('B')!;
    addBackup(ok.storage, { code: before.data, owner: 'B', at: 0, reason: 'first-login-cloud', progress: null });
    ok.write('B', { data: encode({ account: 'B', actions: ['y'] }), version: before.version + 1, actionVersion: 9, device: 'd' }, false);
    ok.checkBackups();
    expect(ok.violations).toEqual([]);
  });
});

describe('Konto-Abgleich: zwei Tabs mit demselben Konto', () => {
  // „Länge 4 vollständig“ selbst läuft in tests/sync-same4-1.test.ts bis -3 (parallel).
  it('Länge 4 vollständig: die Teile decken jede Abfolge genau einmal ab, jeder Teil hat seine Datei', () => {
    const seen = new Set<string>();
    let total = 0;
    for (let part = 0; part < SAME4_PARTS; part++) {
      for (const steps of sameLength4(part)) {
        seen.add(steps.map(sameLabel).join(' → '));
        total++;
      }
    }
    expect(total).toBe(SAME_STEPS.length ** 4);
    expect(seen.size).toBe(total);
    const files = Object.keys(import.meta.glob('./sync-same4-*.test.ts')).sort();
    expect(files).toEqual(Array.from({ length: SAME4_PARTS }, (_, i) => `./sync-same4-${i + 1}.test.ts`));
  });

  it('3000 zufällige Abfolgen der Länge 12', async () => {
    const random = rng(1021);
    const failures: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const steps = Array.from({ length: 12 }, () => SAME_STEPS[Math.floor(random() * SAME_STEPS.length)]!);
      const violations = await runSameAccount(steps);
      if (violations.length > 0 && failures.length < 5) failures.push(`${steps.map(sameLabel).join(' → ')}: ${violations.join('; ')}`);
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it('Gegenprobe: (c) schlägt an, wenn eine Aktion nirgends mehr liegt', () => {
    const world = new World(new MemoryStorage());
    world.made.add('weg');
    world.checkMade();
    expect(world.violations.some((v) => v.startsWith('(c)'))).toBe(true);
  });

  async function twoTabs() {
    const storage = new MemoryStorage();
    const world = new World(storage);
    storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
    world.otherDevice('A');
    const first = new Tab(world);
    world.tabs.push(first);
    await first.core.start();
    await first.core.signIn('A', 'pw');
    await settle(world);
    const second = new Tab(world);
    world.tabs.push(second);
    await second.core.start();
    await settle(world);
    return { world, storage, first, second };
  }

  it('Tab 0 handelt offline und wird geschlossen, Tab 1 speichert darüber: Stand von Tab 0 liegt im Ring', async () => {
    const { world, storage, first, second } = await twoTabs();
    world.offline = true;
    first.play();
    const action = first.game.actions.at(-1)!;
    // Abwechselnd speichern: höchstens eine Sicherung je Tab, keine Flut im Ring.
    for (let i = 0; i < 20; i++) {
      second.persist();
      first.persist();
    }
    expect(readBackups(storage).filter((e) => e.reason === 'other-tab')).toHaveLength(1);
    // Schließen (Senden scheitert offline), danach speichert Tab 1.
    first.persist();
    void first.core.flush();
    first.core.dispose();
    world.tabs.splice(0, 1);
    await settle(world);
    second.persist();
    expect(decode(storage.getItem(SAVE))!.actions).not.toContain(action);
    const saved = readBackups(storage).filter((e) => e.reason === 'other-tab');
    expect(saved).toHaveLength(1);
    expect(decode(saved[0]!.code)!.actions).toContain(action);
    expect(saved[0]!.owner).toBe('A');
  });

  it('Sicherung eines anderen Tabs verschwindet, sobald dessen Aktion in der Cloud ist', async () => {
    const { world, storage, first, second } = await twoTabs();
    first.play();
    second.persist();
    expect(readBackups(storage).filter((e) => e.reason === 'other-tab')).toHaveLength(1);
    // Die Liste im Konto-Abschnitt kennt die neue Sicherung sofort.
    expect(second.shown.some((e) => e.reason === 'other-tab')).toBe(true);
    world.clock += 2000;
    await first.core.poll();
    await settle(world);
    expect(decode(world.clouds.get('A')!.data)!.actions).toContain(first.game.actions.at(-1));
    expect(readBackups(storage).filter((e) => e.reason === 'other-tab')).toEqual([]);
  });

  it("Neuladen des Tabs mit offener Aktion, während der andere speichert: nach dem Senden keine 'other-tab'-Sicherung mehr", async () => {
    const { world, storage, first, second } = await twoTabs();
    const otherTab = () => readBackups(storage).filter((e) => e.reason === 'other-tab');
    world.offline = true;
    first.play();
    second.persist();
    expect(otherTab()).toHaveLength(1);
    // Tab 0 lädt neu (speichert vorher) – seine Kennung ist danach eine neue.
    world.clock += 1000;
    await reload(world, 0);
    second.persist();
    first.persist();
    second.persist();
    expect(otherTab().length).toBeGreaterThan(0);
    // Wieder online: Tab 0 sendet, danach sind alle Sicherungen von ihm (auch die geerbte) weg.
    world.offline = false;
    world.clock += 60_000;
    await world.tabs[0]!.core.poll();
    await settle(world);
    expect(world.tabs[0]!.core.engine?.hasUnsent).toBe(false);
    expect(otherTab()).toEqual([]);
    world.checkMade();
    expect(world.violations).toEqual([]);
  });

  it("geerbte Kennung räumt nur ab, was vor dem Laden gesichert wurde", async () => {
    const { world, storage, first, second } = await twoTabs();
    world.offline = true;
    first.play();
    second.persist(); // sichert Tab 0
    // Tab 1 lädt den gespeicherten Stand von Tab 0 – und erbt dessen Kennung.
    world.clock += 1000;
    await reload(world, 1);
    // Danach macht Tab 0 weiter; Tab 1 sichert den neueren Stand über die alte Kennung.
    world.clock += 1000;
    first.play();
    const later = first.game.actions.at(-1)!;
    world.tabs[1]!.persist();
    expect(readBackups(storage).some((e) => e.reason === 'other-tab' && decode(e.code)!.actions.includes(later))).toBe(true);
    // Tab 0 wird offline geschlossen; Tab 1 sendet seinen Stand (ohne `later`).
    first.persist();
    first.core.dispose();
    world.tabs.splice(0, 1);
    world.offline = false;
    world.clock += 60_000;
    await world.tabs[0]!.core.flush();
    await settle(world);
    expect(readBackups(storage).some((e) => decode(e.code)!.actions.includes(later))).toBe(true);
    world.checkMade();
    expect(world.violations).toEqual([]);
  });

  it('ein Tab: offline neu geladen und gespielt – die Aktion bleibt als offen vermerkt', async () => {
    const storage = new MemoryStorage();
    const world = new World(storage);
    storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
    world.otherDevice('A');
    world.tabs.push(new Tab(world));
    await world.tabs[0]!.core.start();
    await world.tabs[0]!.core.signIn('A', 'pw');
    await settle(world);
    world.offline = true;
    await reload(world, 0);
    expect(world.tabs[0]!.core.engine?.status.phase).toBe('offline');
    world.tabs[0]!.play();
    expect(readBase(storage, 'A')?.pending).toBe(true);
    // Neu geladen und wieder online: Die Aktion geht als Aktion ans Konto.
    await reload(world, 0);
    world.offline = false;
    world.clock += 60_000;
    await world.tabs[0]!.core.poll();
    await settle(world);
    const cloud = world.clouds.get('A')!;
    expect(decode(cloud.data)!.actions).toContain(world.tabs[0]!.game.actions.at(-1));
    expect(cloud.actionVersion).toBe(cloud.version);
  });
});

describe('Kern des Kontos: Einzelfälle', () => {
  async function setup() {
    const storage = new MemoryStorage();
    const world = new World(storage);
    storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
    world.otherDevice('A');
    world.otherDevice('B');
    const tab = new Tab(world);
    world.tabs.push(tab);
    await tab.core.start();
    return { world, storage, tab };
  }

  it('abgemeldet gespielt: Grundlage des Besitzers wird „offen“, beim Wiederanmelden gesichert', async () => {
    const { world, storage, tab } = await setup();
    await tab.core.signIn('A', 'pw');
    await settle(world);
    await tab.core.signOut(true);
    expect(readBase(storage, 'A')?.pending).toBe(false);
    tab.play();
    expect(readBase(storage, 'A')?.pending).toBe(true);
    // Inzwischen macht ein anderes Gerät in A weiter → beim Anmelden wird übernommen, aber gesichert.
    world.otherDevice('A');
    const before = encode(tab.game);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    expect(readBackups(storage).find((e) => e.code === before)).toMatchObject({ owner: 'A', reason: 'lost-action' });
    expect(world.violations).toEqual([]);
  });

  it('veralteter Tab: Hinweis und keine Sicherungen mehr angeboten', async () => {
    const { world, storage, tab } = await setup();
    const other = new Tab(world);
    await other.core.start();
    await other.core.signIn('B', 'pw');
    await settle(world);
    tab.core.checkSession();
    expect(tab.core.stale).toBe(true);
    expect(tab.frozen).toBe(true);
    expect(tab.notes).toContain(FROZEN_TEXT);
    expect(tab.core.backups()).toEqual([]);
    expect(readBackups(storage).length).toBeGreaterThan(0);
  });

  it('Sicherungen: angemeldet nur eigene und rein lokale, abgemeldet alle; neueste zuerst', async () => {
    const { world, storage, tab } = await setup();
    addBackup(storage, { code: encode({ account: 'B', actions: ['b'] }), owner: 'B', at: 1, reason: 'lost-action', progress: null });
    addBackup(storage, { code: encode({ account: null, actions: ['l'] }), owner: null, at: 2, reason: 'before-restore', progress: null });
    expect(tab.core.backups().map((e) => e.owner)).toEqual([null, 'B']);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    const owners = tab.core.backups().map((e) => e.owner);
    expect(owners).not.toContain('B');
    expect(owners).toContain(null);
    const foreign = readBackups(storage).find((e) => e.owner === 'B')!;
    expect(tab.core.restore(foreign.id)).toBeTruthy(); // nicht angeboten → abgelehnt
  });

  it('abgemeldet wiederhergestellt: gehört der Sicherung (ohne Grundlage), Stand davor im Ring', async () => {
    const { storage, tab } = await setup();
    const current = encode(tab.game);
    const id = addBackup(storage, { code: encode({ account: 'B', actions: ['b1', 'b2'] }), owner: 'B', at: 1, reason: 'lost-action', progress: null })!;
    expect(tab.core.restore(id)).toBeNull();
    expect(tab.game.actions).toEqual(['b1', 'b2']);
    expect(readMeta(storage)).toEqual({ owner: 'B', base: null });
    expect(readBackups(storage).find((e) => e.code === current)).toMatchObject({ reason: 'before-restore', owner: null });
  });

  it('zwei abgemeldete Tabs: Wiederherstellen in einem ändert nicht, wem das Spiel des anderen gehört', async () => {
    // Ablauf aus dem Review: B, ab, A, ab; Tab 1 (A's Spiel); Tab 0 lädt B's Sicherung; Tab 1
    // speichert, lädt neu und meldet sich mit B an → B's Cloud darf nie A's Spiel bekommen.
    const { world, storage, tab } = await setup();
    world.tabs.length = 0;
    world.tabs.push(tab);
    for (const name of ['B', 'A']) {
      await tab.core.signIn(name, 'pw');
      await settle(world);
      await tab.core.signOut(true);
    }
    const second = new Tab(world);
    world.tabs.push(second);
    await second.core.start();
    expect(readOwner(storage)).toBe('A');
    const backupB = tab.core.backups().find((e) => e.owner === 'B');
    expect(backupB).toBeTruthy();
    expect(tab.core.restore(backupB!.id)).toBeNull();
    second.persist();
    expect(readOwner(storage)).toBe('A');
    await reload(world, 1);
    const reloaded = world.tabs[1]!;
    await reloaded.core.signIn('B', 'pw');
    await settle(world);
    world.checkBackups();
    expect(world.violations).toEqual([]);
    expect(decode(world.clouds.get('B')!.data)!.actions).not.toContain('A-fremd1');
  });

  it('erste Anmeldung bleibt gesichert, auch wenn danach öfter übernommen wird (Ring statt Einzel-Slot)', async () => {
    const { world, storage, tab } = await setup();
    const local0 = encode(tab.game);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    for (let i = 0; i < 15; i++) {
      world.otherDevice('A');
      await reload(world, 0);
      await settle(world);
    }
    expect(readBackups(storage).some((e) => e.code === local0 && e.reason === 'first-login-local')).toBe(true);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
  });
});