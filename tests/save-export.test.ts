import { describe, expect, it } from 'vitest';
import {
  EXPORT_PREFIX,
  MAX_EXPORT_CODE_LENGTH,
  codeFromJson,
  exportCode,
  importCode,
  loadGame,
  serialize,
} from '../src/core/save';
import { SAVE_VERSION } from '../src/core/state';
import { tick } from '../src/core/tick';
import { stateAt } from './helpers';

/** Ein Stand mit allem, was ein Export mitnehmen muss. */
function richState() {
  const state = stateAt(3, ['earthworm', 'robin', 'bluetit'], 9);
  tick(state, 30);
  state.plants = ['moss', 'hazel'];
  state.meta.journal.plants = ['moss', 'hazel'];
  state.meta.journal.keepsakes = ['old-oak'];
  state.meta.forestMemory = 30;
  state.meta.regulars = ['robin'];
  state.pendingEncounters = [{ type: 'animal', cards: ['bee', 'oakmoth'], rerolls: 2 }];
  return state;
}

/** Ändert ein Zeichen im Nutzinhalt (nicht im Präfix, nicht in der Prüfsumme). */
function tamper(code: string): string {
  const at = EXPORT_PREFIX.length + 10;
  const c = code[at] === 'A' ? 'B' : 'A';
  return code.slice(0, at) + c + code.slice(at + 1);
}

describe('exportCode / importCode', () => {
  it('Roundtrip: gleicher Stand, nur die Uhr startet beim Import neu', () => {
    const state = richState();
    const code = exportCode(state);
    expect(code.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(code).toMatch(/^VSZW1:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    const imported = importCode(code, 777_000);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.result.migratedFromV1).toBe(false);
    // Genau wie Speichern und Laden (loadGame führt z. B. Tagebuch und H_max nach) …
    const stored = loadGame(serialize(state), 777_000)!.state;
    expect(imported.result.state).toEqual({ ...stored, lastTick: 777_000 });
    // … und alles, was der Spieler aufgebaut hat, ist unverändert da.
    const s = imported.result.state;
    expect(s.niches).toEqual(state.niches);
    expect(s.plants).toEqual(state.plants);
    expect(s.seeds).toBe(state.seeds);
    expect(s.totalGrowth).toBe(state.totalGrowth);
    expect(s.pendingEncounters).toEqual(state.pendingEncounters);
    expect(s.rngState).toBe(state.rngState);
    expect(s.meta.regulars).toEqual(['robin']);
    expect(s.meta.forestMemory).toBe(30);
    expect(s.meta.journal.keepsakes).toEqual(['old-oak']);
    // Deterministisch: gleicher Stand → gleicher Code.
    expect(exportCode(state)).toBe(code);
  });

  it('Umlaute und Sonderzeichen überstehen die Kodierung (UTF-8)', () => {
    const json = JSON.stringify({ version: SAVE_VERSION, note: 'Größe – Ökosystem 🌳' });
    const code = codeFromJson(json);
    const back = importCode(code, 0);
    expect(back.ok).toBe(true);
  });

  it('Leerraum und Zeilenumbrüche aus dem Kopieren werden ignoriert', () => {
    const code = exportCode(richState());
    const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40, 90)}\r\n ${code.slice(90)}  `;
    expect(importCode(wrapped, 1).ok).toBe(true);
  });

  it('falsche Prüfsumme: veränderter oder abgeschnittener Code', () => {
    const code = exportCode(richState());
    expect(importCode(tamper(code), 0)).toEqual({ ok: false, error: 'checksum' });
    const sum = code.slice(-8);
    const otherSum = (sum[0] === '0' ? '1' : '0') + sum.slice(1);
    expect(importCode(code.slice(0, -8) + otherSum, 0)).toEqual({ ok: false, error: 'checksum' });
    // Abgeschnitten (Prüfsumme fehlt teilweise) → kein gültiger Aufbau.
    expect(importCode(code.slice(0, -3), 0)).toEqual({ ok: false, error: 'format' });
  });

  it('Müll und leere Eingaben', () => {
    expect(importCode('', 0)).toEqual({ ok: false, error: 'empty' });
    expect(importCode('   \n ', 0)).toEqual({ ok: false, error: 'empty' });
    expect(importCode('Hallo Wald', 0)).toEqual({ ok: false, error: 'format' });
    expect(importCode('{"version":4}', 0)).toEqual({ ok: false, error: 'format' });
    expect(importCode(`${EXPORT_PREFIX}`, 0)).toEqual({ ok: false, error: 'format' });
    expect(importCode(`${EXPORT_PREFIX}abc`, 0)).toEqual({ ok: false, error: 'format' });
    expect(importCode(`${EXPORT_PREFIX}ab!c.12345678`, 0)).toEqual({ ok: false, error: 'format' });
    expect(importCode(`${EXPORT_PREFIX}abc.XYZXYZXY`, 0)).toEqual({ ok: false, error: 'format' });
    // Korrekte Prüfsumme, aber kein JSON bzw. kein Objekt → „invalid“.
    expect(importCode(codeFromJson('kein json'), 0)).toEqual({ ok: false, error: 'invalid' });
    expect(importCode(codeFromJson('[1,2,3]'), 0)).toEqual({ ok: false, error: 'invalid' });
    expect(importCode(codeFromJson('null'), 0)).toEqual({ ok: false, error: 'invalid' });
  });

  it('zu groß: lange Eingaben werden gar nicht erst dekodiert', () => {
    const huge = EXPORT_PREFIX + 'A'.repeat(MAX_EXPORT_CODE_LENGTH);
    expect(importCode(huge, 0)).toEqual({ ok: false, error: 'too-large' });
    // Knapp darunter ist eine Frage des Inhalts, nicht der Größe.
    expect(importCode(EXPORT_PREFIX + 'A'.repeat(1000), 0)).toEqual({ ok: false, error: 'format' });
  });

  it('alte Versionen v1–v4 laden wie aus dem Speicher (mit Migration)', () => {
    const v1 = { version: 1, resources: { water: 12, light: 3, energy: 4200 }, stage: 3, totalEnergy: 5000, lastTick: 1_000 };
    const r1 = importCode(codeFromJson(JSON.stringify(v1)), 50_000);
    expect(r1.ok && r1.result.migratedFromV1 && r1.result.keepsake).toBe(true);

    const v2 = {
      version: 2,
      totalGrowth: 2000,
      seeds: 10,
      waypoint: 8,
      stage: 3,
      niches: { roots: ['earthworm'], litter: ['robin'], edge: [], crown: [], bark: [], hollows: [] },
      pendingEncounters: [],
      rngState: 4242,
      meta: { forestMemory: 5, journal: { species: ['earthworm', 'robin'], keepsakes: [] } },
      lastTick: 1_000,
    };
    const v3 = { ...v2, version: 3, plants: ['moss'] };
    const v4 = JSON.parse(serialize(richState()));
    v4.version = 4;
    for (const raw of [v2, v3, v4]) {
      const json = JSON.stringify(raw);
      const imported = importCode(codeFromJson(json), 50_000);
      expect(imported.ok, `v${raw.version}`).toBe(true);
      if (!imported.ok) continue;
      // Gleiches Ergebnis wie loadGame, nur mit neu gestarteter Uhr.
      const loaded = loadGame(json, 50_000)!;
      expect(imported.result.state).toEqual({ ...loaded.state, lastTick: 50_000 });
      expect(imported.result.state.version).toBe(SAVE_VERSION);
    }
  });
});
