// Konto auf der Client-Seite: Konfiguration, Speicher-Helfer, Texte und der HTTP-Dienst
// (der HTTP-Dienst gegen den echten Server steht in server/tests/client.test.ts).
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from './memory-storage';
import { codeFromJson, exportCode, importCode, isNewerSave, serialize } from '../src/core/save';
import { SAVE_VERSION, createInitialState } from '../src/core/state';
import { adoptedLastTick, codeCheck, progressOfState, readSyncUrl } from '../src/sync/config';
import { apiBase } from '../src/sync/http-service';
import {
  BACKUP_KEY,
  BASE_KEY,
  CLOUD_BACKUP_KEY,
  DEVICE_KEY,
  deviceId,
  parseBase,
  parseOwner,
  readBase,
  readOwner,
  writeBackup,
  writeBase,
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
  it('Besitzer des lokalen Stands und Sicherungen beider Seiten', () => {
    const storage = new MemoryStorage();
    expect(readOwner(storage)).toBeNull();
    writeBase(storage, 'eiche', { version: 2, pending: false });
    expect(readOwner(storage)).toBe('eiche');
    expect(parseOwner('{kaputt')).toBeNull();
    expect(parseOwner(JSON.stringify({ user: 42 }))).toBeNull();
    expect(parseOwner(JSON.stringify({ user: '' }))).toBeNull();
    writeBackup(storage, 'LOKAL');
    writeBackup(storage, 'CLOUD', CLOUD_BACKUP_KEY);
    expect(storage.getItem(BACKUP_KEY)).toBe('LOKAL');
    expect(storage.getItem(CLOUD_BACKUP_KEY)).toBe('CLOUD');
    storage.blocked = true;
    expect(readOwner(storage)).toBeNull();
    expect(() => writeBackup(storage, 'X', CLOUD_BACKUP_KEY)).not.toThrow();
  });

  it('parseBase: nur eigenes Konto, ganze Version ≥ 0', () => {
    expect(parseBase(JSON.stringify({ user: 'eiche', version: 3, pending: true }), 'eiche')).toEqual({ version: 3, pending: true });
    expect(parseBase(JSON.stringify({ user: 'buche', version: 3 }), 'eiche')).toBeNull();
    for (const version of [-1, 1.5, 'x', null, 1e300]) {
      expect(parseBase(JSON.stringify({ user: 'eiche', version }), 'eiche')).toBeNull();
    }
    expect(parseBase('{kaputt', 'eiche')).toBeNull();
    expect(parseBase(null, 'eiche')).toBeNull();
    expect(parseBase('null', 'eiche')).toBeNull();
  });

  it('readBase/writeBase und blockierter Speicher', () => {
    const storage = new MemoryStorage();
    writeBase(storage, 'eiche', { version: 2, pending: false });
    expect(JSON.parse(storage.getItem(BASE_KEY)!)).toEqual({ user: 'eiche', version: 2, pending: false });
    expect(readBase(storage, 'eiche')).toEqual({ version: 2, pending: false });
    storage.blocked = true;
    expect(readBase(storage, 'eiche')).toBeNull();
    expect(() => writeBase(storage, 'eiche', { version: 3, pending: true })).not.toThrow();
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
