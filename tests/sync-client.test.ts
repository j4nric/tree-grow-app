// Konto auf der Client-Seite: Konfiguration, Speicher-Helfer, Texte und der HTTP-Dienst
// (der HTTP-Dienst gegen den echten Server steht in server/tests/client.test.ts).
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from './memory-storage';
import { codeFromJson, exportCode, importCode, isNewerSave, serialize } from '../src/core/save';
import { SAVE_VERSION, createInitialState } from '../src/core/state';
import { adoptedLastTick, codeCheck, progressOfState, readSyncUrl } from '../src/sync/config';
import { sessionChange } from '../src/sync/account';
import { decideInitial } from '../src/sync/policy';
import { apiBase } from '../src/sync/http-service';
import {
  BACKUPS_KEY,
  BACKUP_KEY,
  BASE_KEY,
  CLOUD_BACKUP_KEY,
  DEVICE_KEY,
  MAX_BACKUPS,
  MAX_BACKUP_CHARS,
  OWNER_KEY,
  addBackup,
  baseKey,
  deviceId,
  migrateLegacyBackups,
  parseMeta,
  readBackups,
  readBase,
  readMeta,
  readOwner,
  writeBase,
  writeMeta,
  type BackupEntry,
} from '../src/sync/storage';
import {
  accountErrorText,
  agoText,
  isValidPassword,
  normalizeUsername,
  isSyncProblem,
  syncEventText,
  syncStatusText,
} from '../src/ui/account-view';

describe('Konfiguration', () => {
  it('readSyncUrl: nur http(s), Schrägstrich am Ende weg, sonst null', () => {
    expect(readSyncUrl('https://203-0-113-5.sslip.io')).toBe('https://203-0-113-5.sslip.io');
    expect(readSyncUrl(' https://sync.example.org/ ')).toBe('https://sync.example.org');
    expect(readSyncUrl('https://example.org/wald/api/')).toBe('https://example.org/wald/api');
    expect(readSyncUrl('http://localhost:8787')).toBe('http://localhost:8787');
    for (const bad of [undefined, null, '', '   ', 'ftp://x', 'javascript:alert(1)', 'https://', 'https://a b', 'https://x?y', 42]) {
      expect(readSyncUrl(bad)).toBeNull();
    }
    expect(apiBase('https://x.org///')).toBe('https://x.org');
  });

  it('progressOfState: Zyklus, Gesamt-Wachstum, Spielzeit', () => {
    const state = createInitialState(0, 1);
    state.totalGrowth = 40;
    state.meta.stats.completedCyclesGrowth = 2;
    state.meta.stats.playSeconds = 77;
    expect(progressOfState(state)).toEqual({ cycle: state.cycle.number, lifetimeGrowth: 42, playSeconds: 77 });
  });

  it('importCode mit keepClock behält die Uhr des Codes (Abgleich rechnet nach)', () => {
    const state = createInitialState(0, 1);
    state.lastTick = 5_000;
    const code = exportCode(state);
    const kept = importCode(code, 9_000, { keepClock: true });
    const reset = importCode(code, 9_000);
    expect(kept.ok && kept.result.state.lastTick).toBe(5_000);
    expect(reset.ok && reset.result.state.lastTick).toBe(9_000);
  });
});

describe('Spielstände neuerer Spielversionen', () => {
  function codeWithVersion(version: unknown): string {
    const data = JSON.parse(serialize(createInitialState(0, 1))) as Record<string, unknown>;
    data.version = version;
    return codeFromJson(JSON.stringify(data));
  }

  it('importCode lehnt einen Code mit version > SAVE_VERSION ab (nie herabstufen)', () => {
    expect(importCode(codeWithVersion(SAVE_VERSION + 1), 0)).toEqual({ ok: false, error: 'newer' });
    expect(importCode(codeWithVersion(1e300), 0)).toEqual({ ok: false, error: 'newer' });
    expect(importCode(codeWithVersion(SAVE_VERSION), 0).ok).toBe(true);
    // Unsinnige Versionen entscheidet weiter loadGame (robust, nie „neuer“).
    for (const v of [Number.NaN, '99', null, -1]) expect(importCode(codeWithVersion(v), 0)).not.toEqual({ ok: false, error: 'newer' });
  });

  it('isNewerSave: kaputtes JSON, Arrays, fehlende Version → false', () => {
    expect(isNewerSave('{')).toBe(false);
    expect(isNewerSave('[]')).toBe(false);
    expect(isNewerSave('{}')).toBe(false);
    expect(isNewerSave(JSON.stringify({ version: SAVE_VERSION + 1 }))).toBe(true);
  });

  it('codeCheck: ok, newer, invalid (auch zu groß)', () => {
    expect(codeCheck(importCode(exportCode(createInitialState(0, 1)), 0))).toBe('ok');
    expect(codeCheck(importCode(codeWithVersion(SAVE_VERSION + 1), 0))).toBe('newer');
    expect(codeCheck(importCode('VSZW1:kaputt.00000000', 0))).toBe('invalid');
    expect(codeCheck(importCode('x'.repeat(300_000), 0))).toBe('invalid');
  });

  it('adoptedLastTick: Alter nach Serverzeit statt fremder Uhr; ohne Alter nie in der Zukunft', () => {
    // Die Uhr des anderen Geräts geht eine Stunde vor – zählt nicht.
    expect(adoptedLastTick(10_000 + 3_600_000, 10_000, 2000)).toBe(8000);
    expect(adoptedLastTick(0, 10_000, 0)).toBe(10_000);
    expect(adoptedLastTick(0, 10_000, -50)).toBe(10_000);
    expect(adoptedLastTick(5000, 10_000)).toBe(5000);
    expect(adoptedLastTick(50_000, 10_000)).toBe(10_000);
    expect(adoptedLastTick(Number.NaN, 10_000, Number.NaN)).toBe(10_000);
    expect(adoptedLastTick(5000, 10_000, Infinity)).toBe(5000);
  });
});

describe('Speicher-Helfer', () => {
  const entry = (code: string, reason: BackupEntry['reason'] = 'before-take', at = 1000, owner: string | null = null) => ({
    code,
    owner,
    at,
    reason,
    progress: null,
  });

  it('Abgleich-Angaben: Besitzer und Grundlage in einem Eintrag; kaputte Werte, blockierter Speicher', () => {
    const storage = new MemoryStorage();
    expect(readMeta(storage)).toEqual({ owner: null, base: null });
    writeBase(storage, 'eiche', { version: 2, pending: false });
    expect(JSON.parse(storage.getItem(BASE_KEY)!)).toEqual({ user: 'eiche', version: 2, pending: false });
    expect(readOwner(storage)).toBe('eiche');
    expect(readBase(storage, 'eiche')).toEqual({ version: 2, pending: false });
    // Ein anderes Konto: die Grundlage von eiche gilt nicht mehr (A → B → A).
    writeBase(storage, 'buche', { version: 7, pending: true });
    expect(readBase(storage, 'eiche')).toBeNull();
    expect(readBase(storage, 'buche')).toEqual({ version: 7, pending: true });
    // Besitzer ohne Grundlage (nach dem Laden einer Sicherung).
    writeMeta(storage, { owner: 'linde', base: null });
    expect(readMeta(storage)).toEqual({ owner: 'linde', base: null });
    writeMeta(storage, { owner: null, base: null });
    expect(storage.getItem(BASE_KEY)).toBeNull();
    for (const raw of ['{kaputt', 'null', '[]', JSON.stringify({ user: '' }), JSON.stringify({ user: 42 })]) {
      expect(parseMeta(raw)).toBeNull();
    }
    for (const version of [-1, 1.5, 'x', 1e300]) {
      expect(parseMeta(JSON.stringify({ user: 'a', version }))).toEqual({ owner: 'a', base: null });
    }
    storage.blocked = true;
    expect(readMeta(storage)).toEqual({ owner: null, base: null });
    expect(() => writeBase(storage, 'eiche', { version: 3, pending: true })).not.toThrow();
  });

  it('Übergang: getrennte Schlüssel für Besitzer und Grundlage werden noch gelesen', () => {
    const storage = new MemoryStorage();
    storage.setItem(OWNER_KEY, 'b');
    storage.setItem(baseKey('b'), JSON.stringify({ user: 'b', version: 3, pending: false }));
    expect(readMeta(storage)).toEqual({ owner: 'b', base: { version: 3, pending: false } });
    expect(readBase(storage, 'a')).toBeNull();
    writeBase(storage, 'b', { version: 4, pending: false });
    expect(storage.getItem(OWNER_KEY)).toBeNull();
    expect(readMeta(storage).base).toEqual({ version: 4, pending: false });
  });

  it('A → B → A: die Grundlage von A gilt nicht mehr – Cloud gewinnt, nie das Spiel von B in A pushen', () => {
    const storage = new MemoryStorage();
    writeBase(storage, 'a', { version: 5, pending: false });
    writeBase(storage, 'b', { version: 3, pending: false });
    expect(readBase(storage, 'a')).toBeNull();
    const decision = decideInitial({
      remote: { version: 5, actionVersion: 5, device: 'x' },
      base: readBase(storage, 'a')?.version ?? null,
      localProgress: { cycle: 9, lifetimeGrowth: 9, playSeconds: 9 },
      remoteProgress: { cycle: 1, lifetimeGrowth: 0, playSeconds: 0 },
      device: 'me',
      localForeign: readOwner(storage) !== 'a',
    });
    expect(decision).toEqual({ kind: 'take', firstLogin: true });
  });

  it('Sicherungs-Ring: Duplikate einmal, höchstens MAX_BACKUPS, Sicherheitsnetz weicht zuerst', () => {
    const storage = new MemoryStorage();
    expect(readBackups(storage)).toEqual([]);
    const first = addBackup(storage, entry('erste-anmeldung', 'first-login-local', 1, 'eiche'));
    expect(addBackup(storage, entry('erste-anmeldung', 'before-take', 2))).toBe(first);
    expect(readBackups(storage)).toHaveLength(1);
    // Viele Sicherheitsnetz-Sicherungen verdrängen die wichtige nicht.
    for (let i = 0; i < 3 * MAX_BACKUPS; i++) addBackup(storage, entry(`netz${i}`, 'before-take', 10 + i));
    const all = readBackups(storage);
    expect(all).toHaveLength(MAX_BACKUPS);
    expect(all[0]).toMatchObject({ code: 'erste-anmeldung', owner: 'eiche', reason: 'first-login-local' });
    expect(all.at(-1)!.code).toBe(`netz${3 * MAX_BACKUPS - 1}`);
    // Nur wichtige: die älteste weicht.
    for (let i = 0; i < MAX_BACKUPS; i++) addBackup(storage, entry(`wichtig${i}`, 'lost-action', 100 + i));
    expect(readBackups(storage).map((e) => e.code)).toEqual(Array.from({ length: MAX_BACKUPS }, (_, i) => `wichtig${i}`));
    expect(new Set(readBackups(storage).map((e) => e.id)).size).toBe(MAX_BACKUPS);
  });

  it('Sicherungs-Ring: Größe begrenzt, voller Speicher, kaputte Einträge', () => {
    const storage = new MemoryStorage();
    const big = 'x'.repeat(Math.floor(MAX_BACKUP_CHARS / 3) - 10);
    for (let i = 0; i < 4; i++) addBackup(storage, entry(`${i}${big}`, 'lost-action', i));
    expect(readBackups(storage).map((e) => e.code[0])).toEqual(['1', '2', '3']);
    // setItem wirft (Speicher voll): ältere weichen, bis es passt.
    const full = new MemoryStorage();
    addBackup(full, entry('alt', 'lost-action', 1));
    const setItem = full.setItem.bind(full);
    full.setItem = (key, value) => {
      if (key === BACKUPS_KEY && value.includes('alt')) throw new Error('QuotaExceeded');
      setItem(key, value);
    };
    expect(addBackup(full, entry('neu', 'lost-action', 2))).not.toBeNull();
    expect(readBackups(full).map((e) => e.code)).toEqual(['neu']);
    storage.setItem(BACKUPS_KEY, JSON.stringify([{ id: 'a' }, null, entry('ok')].map((e, i) => (i === 2 ? { ...e, id: 'x' } : e))));
    expect(readBackups(storage).map((e) => e.code)).toEqual(['ok']);
    storage.setItem(BACKUPS_KEY, '{kaputt');
    expect(readBackups(storage)).toEqual([]);
  });

  it('frühere Einzel-Sicherungen werden mit ihrem Konto in den Ring übernommen', () => {
    const storage = new MemoryStorage();
    storage.setItem(BACKUP_KEY, 'LOKAL');
    storage.setItem(CLOUD_BACKUP_KEY, 'CLOUD');
    storage.setItem(`${CLOUD_BACKUP_KEY}:owner`, 'eiche');
    migrateLegacyBackups(storage, 5000);
    expect(readBackups(storage).map(({ code, owner, reason, at }) => ({ code, owner, reason, at }))).toEqual([
      { code: 'LOKAL', owner: null, reason: 'legacy', at: 5000 },
      { code: 'CLOUD', owner: 'eiche', reason: 'legacy', at: 5000 },
    ]);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
    expect(storage.getItem(`${CLOUD_BACKUP_KEY}:owner`)).toBeNull();
    migrateLegacyBackups(storage, 6000);
    expect(readBackups(storage)).toHaveLength(2);
  });

  it('deviceId: einmal erzeugt, dann gespeichert; kaputte IDs ersetzt', () => {
    const storage = new MemoryStorage();
    let n = 0;
    const random = () => `geraet-${++n}-abcdef`;
    const first = deviceId(storage, random);
    expect(deviceId(storage, random)).toBe(first);
    storage.setItem(DEVICE_KEY, 'x y');
    expect(deviceId(storage, random)).toBe('geraet-2-abcdef');
    storage.blocked = true;
    expect(deviceId(storage, random)).toBe('geraet-3-abcdef');
  });
});

describe('Sitzung in mehreren Tabs', () => {
  it('sessionChange: gleich, abgemeldet, anderes Konto', () => {
    expect(sessionChange('eiche', 'eiche')).toBe('none');
    expect(sessionChange(null, null)).toBe('none');
    expect(sessionChange('eiche', null)).toBe('signed-out');
    expect(sessionChange('eiche', 'buche')).toBe('stale');
    // Hier abgemeldet, anderswo angemeldet: dieser Tab spielt einen anderen Stand → nicht anschließen.
    expect(sessionChange(null, 'buche')).toBe('stale');
    // … außer es ist genau das Konto, zu dem der lokale Stand gehört: dann mitmachen.
    expect(sessionChange(null, 'buche', 'buche')).toBe('signed-in');
    expect(sessionChange(null, 'buche', 'eiche')).toBe('stale');
    expect(sessionChange('eiche', 'buche', 'buche')).toBe('stale');
  });
});

describe('Texte', () => {
  it('Benutzername und Passwort wie auf dem Server', () => {
    expect(normalizeUsername(' Eiche_1 ')).toBe('eiche_1');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('-ab')).toBeNull();
    expect(normalizeUsername('Bäume')).toBeNull();
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('x'.repeat(201))).toBe(false);
  });

  it('agoText und syncStatusText', () => {
    expect(agoText(Number.NaN)).toBe('gerade eben');
    expect(agoText(-5)).toBe('gerade eben');
    expect(agoText(12_400)).toBe('vor 12 s');
    expect(agoText(3 * 60_000)).toBe('vor 3 min');
    expect(agoText(2 * 3_600_000)).toBe('vor 2 h');
    expect(syncStatusText({ phase: 'synced', lastSyncedAt: 1000 }, 2000)).toBe('Synchronisiert');
    expect(syncStatusText({ phase: 'synced', lastSyncedAt: 1000 }, 13_000)).toBe('Gespeichert vor 12 s');
    expect(syncStatusText({ phase: 'connecting', lastSyncedAt: null }, 0)).toMatch(/Verbinde/);
    expect(syncStatusText({ phase: 'offline', lastSyncedAt: null }, 0)).toMatch(/^Offline/);
    expect(syncStatusText({ phase: 'offline', lastSyncedAt: 0 }, 61_000)).toMatch(/zuletzt gespeichert vor 1 min/);
    expect(syncStatusText({ phase: 'outdated', lastSyncedAt: 0 }, 0)).toMatch(/^Neue Spielversion – bitte neu laden/);
    expect(syncStatusText({ phase: 'cloud-unreadable', lastSyncedAt: 0 }, 0)).toMatch(/nicht lesbar/);
    expect(syncStatusText({ phase: 'local-invalid', lastSyncedAt: null }, 0)).toMatch(/zu groß/);
    expect(isSyncProblem({ phase: 'outdated', lastSyncedAt: null })).toBe(true);
    expect(isSyncProblem({ phase: 'offline', lastSyncedAt: null })).toBe(false);
  });

  it('Hinweise und Fehlertexte', () => {
    expect(syncEventText({ kind: 'taken', lostLocal: false })).toBe('Auf anderem Gerät weitergespielt – übernommen.');
    expect(syncEventText({ kind: 'first-login', winner: 'local' })).toMatch(/war weiter/);
    expect(accountErrorText('taken')).toMatch(/gibt es schon/);
    expect(accountErrorText(undefined)).toMatch(/nicht geklappt/);
    expect(accountErrorText('registration-closed')).toMatch(/keine neuen Konten/);
    expect(accountErrorText('storage-full')).toMatch(/keinen Platz/);
  });
});
