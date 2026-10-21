import { describe, expect, it } from 'vitest';
import {
  CUES,
  CUE_MIN_GAP,
  MASTER_GAIN,
  MAX_MASTER_GAIN,
  PAD_LEVEL,
  PAD_VOICES,
  SEASON_SOUNDS,
  WIND_LEVEL,
  ambienceMix,
  cueAllowed,
  masterGain,
  nextBirdDelay,
  padChord,
  planChirp,
  seasonSound,
  windGust,
} from '../src/ui/sound-plan';
import { createSound, fillPinkNoise, type SoundEnv } from '../src/ui/sound';

/** Kleiner, reproduzierbarer Zufall für Tests (nicht der Spiel-RNG). */
function lcg(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

const SPRING = 0;
const SUMMER = 1;
const AUTUMN = 2;
const WINTER = 3;

describe('Klang: Lautstärke', () => {
  it('Aus ist still, Leise < Normal, alles deutlich unter Vollaussteuerung', () => {
    expect(masterGain('off', false)).toBe(0);
    expect(masterGain('quiet', false)).toBeGreaterThan(0);
    expect(masterGain('quiet', false)).toBeLessThan(masterGain('normal', false));
    for (const level of ['off', 'quiet', 'normal'] as const) {
      expect(masterGain(level, false)).toBeLessThanOrEqual(MAX_MASTER_GAIN);
      expect(MASTER_GAIN[level]).toBeLessThanOrEqual(MAX_MASTER_GAIN);
    }
    // −12 dBFS ≈ 0,25 linear
    expect(20 * Math.log10(MAX_MASTER_GAIN)).toBeLessThanOrEqual(-12 + 0.1);
  });

  it('verborgener Tab: still', () => {
    expect(masterGain('normal', true)).toBe(0);
    expect(masterGain('quiet', true)).toBe(0);
  });

  it('Summe aller Stimmen bei voller Böe bleibt im Rahmen (vor dem Begrenzer)', () => {
    let peak = 0;
    for (let season = 0; season < 4; season += 0.25) {
      for (let t = 0; t < 120; t += 0.7) {
        const mix = ambienceMix(season, t, 4);
        peak = Math.max(peak, mix.wind + mix.pad);
      }
    }
    // Wind + Pad + ein Vogelruf + der lauteste Ereignis-Klang
    const cuePeak = Math.max(...Object.values(CUES).map((tones) => tones.reduce((s, t) => s + t.gain, 0)));
    expect(peak + 0.18 + cuePeak).toBeLessThan(2);
    expect((peak + 0.18 + cuePeak) * MAX_MASTER_GAIN).toBeLessThan(0.5);
  });
});

describe('Klang: Jahreszeiten', () => {
  it('Mitten der Jahreszeiten entsprechen der Tabelle', () => {
    for (let i = 0; i < 4; i++) expect(seasonSound(i)).toEqual(SEASON_SOUNDS[i]);
  });

  it('Herbst windiger als Frühling und Sommer, Winter fast still und ohne Vögel', () => {
    expect(seasonSound(AUTUMN).wind).toBeGreaterThan(seasonSound(SPRING).wind);
    expect(seasonSound(AUTUMN).wind).toBeGreaterThan(seasonSound(SUMMER).wind);
    expect(seasonSound(WINTER).wind).toBeLessThan(seasonSound(SUMMER).wind);
    expect(seasonSound(WINTER).birdsPerMinute).toBe(0);
    expect(seasonSound(SPRING).birdsPerMinute).toBeGreaterThan(seasonSound(SUMMER).birdsPerMinute);
    expect(seasonSound(SUMMER).birdsPerMinute).toBeGreaterThan(seasonSound(AUTUMN).birdsPerMinute);
  });

  it('überblendet stufenlos und ringförmig (Winter → Frühling)', () => {
    const mid = seasonSound(3.5);
    expect(mid.wind).toBeCloseTo((SEASON_SOUNDS[3]!.wind + SEASON_SOUNDS[0]!.wind) / 2);
    expect(seasonSound(4)).toEqual(seasonSound(0));
    expect(seasonSound(-1)).toEqual(seasonSound(3));
    expect(seasonSound(Number.NaN)).toEqual(SEASON_SOUNDS[0]);
  });

  it('Böen bleiben zwischen 0,6 und 1, auch bei ungültiger Zeit', () => {
    for (let t = 0; t < 600; t += 0.37) {
      const g = windGust(t);
      expect(g).toBeGreaterThanOrEqual(0.6);
      expect(g).toBeLessThanOrEqual(1);
    }
    expect(windGust(Number.NaN)).toBe(0.8);
  });

  it('Mischung: Wind folgt Jahreszeit und Böe, Pad erst ab Harmoniestufe 1', () => {
    const t = 10;
    expect(ambienceMix(AUTUMN, t, 0).wind).toBeCloseTo(WIND_LEVEL * SEASON_SOUNDS[2]!.wind * windGust(t));
    expect(ambienceMix(SPRING, t, 0).pad).toBe(0);
    expect(ambienceMix(SPRING, t, 1).pad).toBeGreaterThan(0);
    expect(ambienceMix(SPRING, t, 4).pad).toBeGreaterThan(ambienceMix(SPRING, t, 1).pad);
    expect(ambienceMix(SPRING, t, 4).pad).toBeLessThanOrEqual(PAD_LEVEL);
    expect(ambienceMix(WINTER, t, 4).pad).toBeLessThan(ambienceMix(SUMMER, t, 4).pad);
    expect(ambienceMix(WINTER, t, 2).birdsPerMinute).toBe(0);
  });
});

describe('Klang: Vogelrufe', () => {
  it('Abstände: exponentiell, mindestens 2 s, im Winter nie', () => {
    expect(nextBirdDelay(0, 0.5)).toBe(Infinity);
    expect(nextBirdDelay(Number.NaN, 0.5)).toBe(Infinity);
    expect(nextBirdDelay(6, 0)).toBe(2);
    expect(nextBirdDelay(6, 0.5)).toBeCloseTo(Math.log(2) * 10);
    expect(Number.isFinite(nextBirdDelay(6, 1))).toBe(true);
    // Mittelwert ≈ 60 / Rate
    const rand = lcg(7);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += nextBirdDelay(4, rand());
    expect(sum / n).toBeGreaterThan(13);
    expect(sum / n).toBeLessThan(17);
  });

  it('Ruf: 2–4 kurze, leise Gleittöne im Vogelbereich', () => {
    const rand = lcg(3);
    for (let k = 0; k < 200; k++) {
      const chirp = planChirp(rand);
      expect(chirp.notes.length).toBeGreaterThanOrEqual(2);
      expect(chirp.notes.length).toBeLessThanOrEqual(4);
      expect(Math.abs(chirp.pan)).toBeLessThanOrEqual(0.7);
      let last = -1;
      for (const n of chirp.notes) {
        expect(n.start).toBeGreaterThan(last);
        last = n.start;
        expect(n.duration).toBeGreaterThan(0.04);
        expect(n.duration).toBeLessThan(0.13);
        for (const f of [n.from, n.to]) {
          expect(f).toBeGreaterThan(1900);
          expect(f).toBeLessThanOrEqual(5500);
        }
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.18);
      }
    }
  });
});

describe('Klang: Pad und Ereignisse', () => {
  it('Akkord wächst mit der Harmoniestufe, Stufe 0 schweigt', () => {
    expect(padChord(0)).toEqual([]);
    for (let tier = 1; tier <= 4; tier++) {
      const chord = padChord(tier);
      expect(chord.length).toBeGreaterThan(padChord(tier - 1).length);
      expect(chord.length).toBeLessThanOrEqual(PAD_VOICES);
      expect([...chord].sort((a, b) => a - b)).toEqual(chord);
      for (const f of chord) {
        expect(f).toBeGreaterThan(100);
        expect(f).toBeLessThan(500);
      }
    }
    expect(padChord(9)).toEqual(padChord(4));
    expect(padChord(-2)).toEqual([]);
    expect(padChord(Number.NaN)).toEqual([]);
  });

  it('Pling, zwei Töne, kleiner Dreiklang – kurz und leise', () => {
    expect(CUES.encounter).toHaveLength(1);
    expect(CUES.achievement).toHaveLength(2);
    expect(CUES.stage).toHaveLength(3);
    for (const tones of Object.values(CUES)) {
      for (const t of tones) {
        expect(t.duration).toBeLessThanOrEqual(2);
        expect(t.gain).toBeLessThanOrEqual(0.4);
      }
    }
    // Erfolg: aufwärts; Dreiklang: Dur (4 + 3 Halbtöne)
    expect(CUES.achievement[1]!.freq).toBeGreaterThan(CUES.achievement[0]!.freq);
    const [a, b, c] = CUES.stage.map((t) => t.freq);
    expect(12 * Math.log2(b! / a!)).toBeCloseTo(4, 1);
    expect(12 * Math.log2(c! / b!)).toBeCloseTo(3, 1);
  });

  it('gleiche Ereignis-Klänge nicht dicht hintereinander', () => {
    expect(cueAllowed(undefined, 0)).toBe(true);
    expect(cueAllowed(10, 10 + CUE_MIN_GAP / 2)).toBe(false);
    expect(cueAllowed(10, 10 + CUE_MIN_GAP)).toBe(true);
  });
});

describe('Klang: Rauschen und Engine ohne Web Audio', () => {
  it('Rauschen: begrenzt und als Schleife nahtlos', () => {
    const data = new Float32Array(20000);
    const loop = fillPinkNoise(data, lcg(11));
    expect(loop).toBeLessThan(data.length);
    expect(loop).toBeGreaterThan(data.length / 2);
    for (const v of data) expect(Math.abs(v)).toBeLessThan(1);
    // Sprung an der Schleifennaht nicht größer als zwischen Nachbarn sonst üblich.
    let maxStep = 0;
    for (let i = 1; i < loop; i++) maxStep = Math.max(maxStep, Math.abs(data[i]! - data[i - 1]!));
    expect(Math.abs(data[0]! - data[loop - 1]!)).toBeLessThanOrEqual(maxStep);
  });

  function fakeEnv(createContext: SoundEnv['createContext']) {
    const listeners = new Map<string, () => void>();
    const body = { dataset: {} as Record<string, string> };
    const env: SoundEnv = {
      createContext,
      doc: {
        visibilityState: 'visible',
        addEventListener: ((type: string, fn: () => void) => void listeners.set(type, fn)) as unknown as Document['addEventListener'],
        body: body as unknown as HTMLElement,
      },
      random: lcg(5),
    };
    return { env, listeners, body };
  }

  it('ohne AudioContext: nichts wirft, Zustand „nicht verfügbar“', () => {
    const { env, listeners, body } = fakeEnv(null);
    const sound = createSound('off', env);
    expect(sound.state).toBe('off');
    expect(body.dataset.sound).toBe('off');
    expect(() => {
      sound.setLevel('normal');
      listeners.get('pointerdown')?.();
      listeners.get('keydown')?.();
      listeners.get('visibilitychange')?.();
      sound.update({ season: 0, harmonyTier: 3 }, 1);
      sound.cue('encounter');
      sound.cue('achievement');
      sound.cue('stage');
    }).not.toThrow();
    expect(sound.state).toBe('unavailable');
    expect(body.dataset.sound).toBe('unavailable');
    sound.setLevel('off');
    expect(sound.state).toBe('off');
  });

  it('AudioContext erst bei Interaktion, und nur wenn Klang an ist; Fehler beim Anlegen → still', () => {
    let created = 0;
    const { env, listeners } = fakeEnv(() => {
      created++;
      throw new Error('blockiert');
    });
    const sound = createSound('quiet', env);
    expect(created).toBe(0);
    expect(sound.state).toBe('waiting');
    sound.update({ season: 0, harmonyTier: 0 }, 1);
    expect(created).toBe(0);
    listeners.get('pointerdown')?.();
    expect(created).toBe(1);
    expect(sound.state).toBe('unavailable');
    // Kein zweiter Versuch bei jeder Interaktion.
    listeners.get('keydown')?.();
    expect(created).toBe(1);

    const off = fakeEnv(() => {
      created++;
      throw new Error('blockiert');
    });
    createSound('off', off.env);
    off.listeners.get('pointerdown')?.();
    expect(created).toBe(1);
  });
});
