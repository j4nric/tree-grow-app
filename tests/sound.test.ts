import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BIRD_LEVEL,
  CUES,
  CUE_MAX_DELAY,
  CUE_MIN_GAP,
  CUE_OVERTONE,
  CUE_PEAK_LIMIT,
  MASTER_GAIN,
  MAX_BIRD_STEP,
  MAX_MASTER_GAIN,
  NOISE_PEAK,
  PAD_FREQS,
  PAD_LEVEL,
  PAD_VOICES,
  SEASON_SOUNDS,
  WIND_LEVEL,
  ambienceMix,
  birdChance,
  cueAllowed,
  cueLength,
  cuePeak,
  masterGain,
  padChord,
  padVoiceGains,
  peakBudget,
  planChirp,
  planCueStart,
  seasonSound,
  windGust,
  type ActiveCue,
  type CueKind,
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

  it('Leise liegt etwa 10 dB unter Normal', () => {
    const db = 20 * Math.log10(masterGain('normal', false) / masterGain('quiet', false));
    expect(db).toBeGreaterThan(9);
    expect(db).toBeLessThan(11);
  });

  it('Pegel-Haushalt: Summe aller Stimmen samt Oberton ≤ 1 → Spitze ≤ −12 dBFS', () => {
    // Wind + Pad aus der echten Mischung (alle Jahreszeiten, Böen, Stufen)
    let ambience = 0;
    for (let season = 0; season < 4; season += 0.05) {
      for (let t = 0; t < 300; t += 0.13) {
        for (let tier = 0; tier <= 4; tier++) {
          const mix = ambienceMix(season, t, tier);
          ambience = Math.max(ambience, mix.wind * NOISE_PEAK + mix.pad * padVoiceGains(tier).reduce((a, b) => a + b, 0));
        }
      }
    }
    // Alle Ereignisse gleichzeitig angefordert: geplant wie in der Engine
    const active: ActiveCue[] = [];
    for (const kind of ['stage', 'achievement', 'encounter'] as CueKind[]) {
      const start = planCueStart(active, kind, 0);
      if (start !== null) active.push({ kind, start });
    }
    const cues = cuePeak(active) * (1 + CUE_OVERTONE);
    const total = ambience + BIRD_LEVEL + cues;
    const budget = peakBudget();
    expect(total).toBeLessThanOrEqual(budget.total + 1e-9);
    expect(budget.total).toBeLessThanOrEqual(1);
    for (const level of ['quiet', 'normal'] as const) {
      expect(20 * Math.log10(total * masterGain(level, false))).toBeLessThanOrEqual(-12);
    }
    expect(20 * Math.log10(total * masterGain('quiet', false))).toBeLessThanOrEqual(-21.9);
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
  it('Chance je Schritt: Poisson, im Winter nie, lange Schritte gedeckelt', () => {
    expect(birdChance(0, 1)).toBe(0);
    expect(birdChance(Number.NaN, 1)).toBe(0);
    expect(birdChance(6, 0)).toBe(0);
    expect(birdChance(6, -1)).toBe(0);
    expect(birdChance(6, 0.2)).toBeCloseTo(1 - Math.exp(-0.02));
    expect(birdChance(6, 3600)).toBe(birdChance(6, MAX_BIRD_STEP));
    expect(birdChance(6, 3600)).toBeLessThan(0.2);
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
        expect(n.gain).toBeLessThanOrEqual(BIRD_LEVEL);
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
    expect(padChord(4)).toEqual(PAD_FREQS);
    expect(padChord(-2)).toEqual([]);
    expect(padChord(Number.NaN)).toEqual([]);
  });

  it('Pad: feste Stimme je Halbton – Stufen blenden nur Lautstärken', () => {
    expect(PAD_FREQS).toHaveLength(PAD_VOICES);
    for (let tier = 0; tier <= 4; tier++) {
      const gains = padVoiceGains(tier);
      expect(gains).toHaveLength(PAD_VOICES);
      expect(gains.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-12);
      // Klingende Stimmen = Akkord der Stufe (gleiche Frequenzen)
      expect(PAD_FREQS.filter((_, i) => gains[i]! > 0)).toEqual(padChord(tier));
      if (tier > 0) {
        // Eine Stimme, die einmal klingt, klingt auf höheren Stufen weiter.
        const lower = padVoiceGains(tier - 1);
        lower.forEach((g, i) => expect(g > 0 ? gains[i]! > 0 : true).toBe(true));
      }
    }
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

  it('jeder Ereignis-Klang passt allein in den Haushalt', () => {
    for (const kind of Object.keys(CUES) as CueKind[]) {
      expect(cuePeak([{ kind, start: 0 }])).toBeLessThanOrEqual(CUE_PEAK_LIMIT);
      expect(planCueStart([], kind, 5)).toBe(5);
    }
  });

  it('alle Ereignisse gleichzeitig: spätere rücken nach hinten, Summe bleibt im Rahmen', () => {
    const active: ActiveCue[] = [];
    for (const kind of ['encounter', 'achievement', 'stage'] as CueKind[]) {
      const start = planCueStart(active, kind, 10);
      expect(start).not.toBeNull();
      expect(start!).toBeLessThanOrEqual(10 + CUE_MAX_DELAY + 1e-9);
      active.push({ kind, start: start! });
    }
    expect(active[0]!.start).toBe(10);
    expect(active[1]!.start).toBeGreaterThan(10);
    expect(cuePeak(active)).toBeLessThanOrEqual(CUE_PEAK_LIMIT + 1e-9);
    // Dicht abgetastet bestätigt: Spitze liegt an den Knicken
    let sampled = 0;
    for (let t = 9.9; t < 14; t += 0.0005) {
      let sum = 0;
      for (const c of active) for (const tone of CUES[c.kind]) {
        const x = t - c.start - tone.start;
        if (x > 0 && x <= tone.duration) sum += x <= 0.012 ? (tone.gain * x) / 0.012 : tone.gain * (0.0001 / tone.gain) ** ((x - 0.012) / (tone.duration - 0.012));
      }
      sampled = Math.max(sampled, sum);
    }
    expect(sampled).toBeLessThanOrEqual(cuePeak(active) + 1e-9);
    // Ausgeklungene Klänge zählen nicht mehr
    expect(planCueStart(active, 'stage', 10 + 3 + cueLength('stage'))).toBe(10 + 3 + cueLength('stage'));
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
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(NOISE_PEAK + 1e-6);
    expect(peak).toBeGreaterThan(NOISE_PEAK * 0.5);
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

/**
 * Nachbau eines AudioContext ohne Klang: zeichnet Automatisierungen auf, damit die Engine
 * (Freischaltung, Ausblenden, Vogelrufe) ohne Browser prüfbar ist.
 */
class FakeParam {
  value: number;
  events: { type: string; value?: number; time: number }[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  /** Letztes gesetztes Ziel (oder der feste Wert). */
  get target(): number {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!;
      if (e.value !== undefined) return e.value;
    }
    return this.value;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ type: 'target', value, time });
    return this;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: 'cancel', time });
    return this;
  }
}

class FakeNode {
  outputs: unknown[] = [];
  constructor(readonly kind: string) {}
  connect<T>(target: T): T {
    this.outputs.push(target);
    return target;
  }
  disconnect() {
    this.outputs = [];
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'interrupted' | 'closed';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode('destination');
  oscillators: (FakeNode & { frequency: FakeParam })[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];
  resumes = 0;
  suspends = 0;
  private listeners: (() => void)[] = [];
  constructor(initial: FakeContext['state']) {
    this.state = initial;
  }
  setState(state: FakeContext['state']) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn);
  }
  resume() {
    this.resumes++;
    this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.setState('suspended');
    return Promise.resolve();
  }
  createGain() {
    const n = Object.assign(new FakeNode('gain'), { gain: new FakeParam(1) });
    this.gains.push(n);
    return n;
  }
  createWaveShaper() {
    return Object.assign(new FakeNode('shaper'), { curve: null, oversample: 'none' });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode('filter'), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    return Object.assign(new FakeNode('source'), { buffer: null, loop: false, loopStart: 0, loopEnd: 0, start() {} });
  }
  createOscillator() {
    const n = Object.assign(new FakeNode('osc'), {
      type: 'sine',
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null,
      start() {},
      stop() {},
    });
    this.oscillators.push(n);
    return n;
  }
  createStereoPanner() {
    return Object.assign(new FakeNode('panner'), { pan: new FakeParam(0) });
  }
  /** Der Master: das Gain, das in den Clipper vor dem Ausgang führt. */
  master() {
    return this.gains.find((g) => (g.outputs[0] as FakeNode | undefined)?.kind === 'shaper')!;
  }
}

describe('Klang: Engine mit nachgebautem AudioContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initialState: FakeContext['state'], level: 'quiet' | 'normal' | 'off' = 'normal', seed = 5) {
    const listeners = new Map<string, () => void>();
    const body = { dataset: {} as Record<string, string> };
    const contexts: FakeContext[] = [];
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: ((type: string, fn: () => void) => void listeners.set(type, fn)) as unknown as Document['addEventListener'],
      body: body as unknown as HTMLElement,
    };
    const env: SoundEnv = {
      createContext: () => {
        const ctx = new FakeContext(initialState);
        contexts.push(ctx);
        return ctx as unknown as AudioContext;
      },
      doc,
      random: lcg(seed),
    };
    const sound = createSound(level, env);
    return { sound, listeners, contexts, doc, body };
  }

  it('Kontext sofort „running“ (Chromium): Master wird trotzdem eingeblendet', () => {
    const { sound, listeners, contexts } = setup('running');
    expect(contexts).toHaveLength(0);
    listeners.get('pointerdown')!();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.master().gain.target).toBeCloseTo(MASTER_GAIN.normal);
    expect(sound.state).toBe('running');
  });

  it('angehaltener Kontext (auch iOS „interrupted“) wird bei Berührung fortgesetzt', () => {
    for (const initial of ['suspended', 'interrupted'] as const) {
      const { sound, listeners, contexts } = setup(initial, 'quiet');
      listeners.get('touchend')!();
      expect(contexts[0]!.resumes).toBe(1);
      expect(contexts[0]!.master().gain.target).toBeCloseTo(MASTER_GAIN.quiet);
      expect(sound.state).toBe('running');
    }
    const { listeners } = setup('suspended');
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) expect(listeners.has(type)).toBe(true);
  });

  it('Aus → Leise: kein neuer Kontext, nur fortsetzen und einblenden', () => {
    vi.useFakeTimers();
    const { sound, listeners, contexts } = setup('running', 'normal');
    listeners.get('click')!();
    const ctx = contexts[0]!;
    sound.setLevel('off');
    expect(ctx.master().gain.target).toBe(0);
    expect(sound.state).toBe('off');
    vi.advanceTimersByTime(2000);
    expect(ctx.suspends).toBe(1);
    sound.setLevel('quiet');
    expect(contexts).toHaveLength(1);
    expect(ctx.resumes).toBe(1);
    expect(ctx.master().gain.target).toBeCloseTo(MASTER_GAIN.quiet);
    expect(sound.state).toBe('running');
  });

  it('verborgener Tab blendet aus und hält an, Rückkehr blendet wieder ein', () => {
    vi.useFakeTimers();
    const { sound, listeners, contexts, doc, body } = setup('running', 'normal');
    listeners.get('pointerdown')!();
    const ctx = contexts[0]!;
    doc.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    expect(ctx.master().gain.target).toBe(0);
    expect(body.dataset.sound).toBe('paused');
    vi.advanceTimersByTime(2000);
    expect(ctx.suspends).toBe(1);
    // Während verborgen: keine Aktualisierung, keine Klänge
    const oscBefore = ctx.oscillators.length;
    sound.update({ season: 0, harmonyTier: 2 }, 100);
    sound.cue('stage');
    expect(ctx.oscillators.length).toBe(oscBefore);
    doc.visibilityState = 'visible';
    listeners.get('visibilitychange')!();
    expect(ctx.resumes).toBe(1);
    expect(ctx.master().gain.target).toBeCloseTo(MASTER_GAIN.normal);
    expect(body.dataset.sound).toBe('running');
  });

  it('Stufenwechsel: Pad-Stimmen behalten ihre Tonhöhe, nur Lautstärken blenden', () => {
    const { sound, listeners, contexts } = setup('running');
    listeners.get('pointerdown')!();
    const ctx = contexts[0]!;
    const pad = ctx.oscillators.slice(0, PAD_VOICES);
    expect(pad.map((o) => o.frequency.value)).toEqual(PAD_FREQS);
    sound.update({ season: 3, harmonyTier: 1 }, 1);
    sound.update({ season: 3, harmonyTier: 4 }, 2);
    for (const o of pad) expect(o.frequency.events).toEqual([]);
  });

  it('Automatisierung nur bei spürbarer Änderung', () => {
    const { sound, listeners, contexts } = setup('running');
    listeners.get('pointerdown')!();
    const ctx = contexts[0]!;
    // Winter ohne Vögel, Pad-Stufe fest: gleiche Werte → keine neuen Ereignisse an den Stimmen
    sound.update({ season: 3, harmonyTier: 2 }, 1);
    const count = () => ctx.gains.reduce((n, g) => n + g.gain.events.length, 0);
    const before = count();
    sound.update({ season: 3, harmonyTier: 2 }, 1.2001);
    // höchstens Wind (Böe ändert sich etwas) – das Pad bleibt unberührt
    expect(count() - before).toBeLessThanOrEqual(1);
  });

  it('Vogelrufe: mittlere Rate je Jahreszeit nahe Soll, keine Stundenpausen', () => {
    const { sound, listeners, contexts } = setup('running', 'normal', 12345);
    listeners.get('pointerdown')!();
    const ctx = contexts[0]!;
    const isChirp = (o: { frequency: FakeParam }) => o.frequency.events.some((e) => e.type === 'set' && (e.value ?? 0) > 1500);
    const seen = new Set<unknown>();
    const chirps = [0, 0, 0, 0];
    const time = [0, 0, 0, 0];
    const perSeason = 180;
    const cycles = 20;
    const step = 0.2;
    let lastChirp = 0;
    let maxGap = 0;
    for (let i = 0; i * step < perSeason * 4 * cycles; i++) {
      const now = i * step;
      ctx.currentTime = now;
      const season = (((now / perSeason - 0.5) % 4) + 4) % 4;
      const q = Math.round(season) % 4;
      time[q]! += step;
      const before = ctx.oscillators.length;
      sound.update({ season, harmonyTier: 2 }, now);
      let chirped = false;
      for (const o of ctx.oscillators.slice(before)) {
        if (!seen.has(o) && isChirp(o)) chirped = true;
        seen.add(o);
      }
      if (chirped) {
        chirps[q]!++;
        if (q !== 3) maxGap = Math.max(maxGap, now - lastChirp);
        lastChirp = now;
      }
    }
    for (let q = 0; q < 4; q++) {
      // Soll: Tabelle gemittelt über die Jahreszeit (±0,5 um die Mitte, stufenlos überblendet)
      let sum = 0;
      let n = 0;
      for (let x = -0.5; x < 0.5; x += 0.001, n++) sum += seasonSound(q + x).birdsPerMinute;
      const expected = sum / n;
      const rate = chirps[q]! / (time[q]! / 60);
      if (expected === 0) expect(rate).toBe(0);
      else {
        expect(rate).toBeGreaterThan(expected * 0.75);
        expect(rate).toBeLessThan(expected * 1.25);
      }
    }
    // Keine Pausen, die über einen Winter hinaus reichen
    expect(maxGap).toBeLessThan(perSeason * 2);
  });
});
