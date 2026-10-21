/**
 * Klangkulisse – reine Rechnungen ohne Web Audio (getestet in tests/sound-plan.test.ts).
 *
 * Hier steht, *was* zu hören ist: Lautstärken je Einstellung und Jahreszeit, Windböen,
 * Abstände der Vogelrufe, die Form eines Rufs, der Akkord je Harmoniestufe und die kurzen
 * Ereignis-Klänge. `sound.ts` setzt das nur noch in Web-Audio-Knoten um.
 *
 * Zufall kommt als Parameter (`rand`: Zahl in [0, 1)) – in der Oberfläche Math.random(),
 * in Tests feste Werte. Der Spielstand und sein Zufallsgenerator bleiben unberührt.
 */
import type { SoundLevel } from './settings';

/**
 * Pegel-Haushalt: Alle Stimmen zusammen erreichen hinter dem Master höchstens 1 (siehe
 * `peakBudget`), der Master „Normal“ ist 0,25 ≈ −12 dBFS – also bleibt die Spitze am
 * Ausgang in jedem Fall ≤ −12 dBFS. „Leise“ liegt 10 dB darunter (≈ −22 dBFS).
 * Kein Kompressor: Dessen automatischer Ausgleichs-Gain würde die Spitzen wieder anheben.
 */
export const MASTER_GAIN: Readonly<Record<SoundLevel, number>> = { off: 0, quiet: 0.25 * 10 ** (-10 / 20), normal: 0.25 };

/** Obergrenze des Masters (linear, ≈ −12 dBFS) – zugleich Grenze des Sicherheits-Clippers. */
export const MAX_MASTER_GAIN = 0.25;

export function masterGain(level: SoundLevel, hidden: boolean): number {
  if (hidden) return 0;
  return Math.min(MAX_MASTER_GAIN, MASTER_GAIN[level] ?? 0);
}

/** Klangfarbe einer Jahreszeit (Werte relativ, 0–1). */
export interface SeasonSound {
  /** Grundlautstärke des Windes. */
  wind: number;
  /** Obere Grenzfrequenz des Wind-Rauschens (Hz) – stärkerer Wind klingt heller. */
  cutoff: number;
  /** Vogelrufe pro Minute (Mittelwert). */
  birdsPerMinute: number;
  /** Anteil des Akkord-Pads (im Winter leiser). */
  pad: number;
}

/**
 * Je Jahreszeit (Reihenfolge wie `sceneSeason`: 0 Frühling · 1 Sommer · 2 Herbst · 3 Winter).
 * Herbst: etwas stärkerer Wind. Winter: fast Stille, keine Vögel.
 */
export const SEASON_SOUNDS: readonly SeasonSound[] = [
  { wind: 0.45, cutoff: 700, birdsPerMinute: 7, pad: 1 },
  { wind: 0.35, cutoff: 600, birdsPerMinute: 4, pad: 1 },
  { wind: 0.75, cutoff: 1000, birdsPerMinute: 0.5, pad: 0.8 },
  { wind: 0.15, cutoff: 450, birdsPerMinute: 0, pad: 0.5 },
];

/**
 * Stufenlose Klangfarbe aus dem Wert der Szene (`sceneSeason`, [0, 4), ganze Zahlen =
 * Mitte einer Jahreszeit). Zwischen den Mitten wird linear überblendet – ringförmig, also
 * von Winter (3) zurück zu Frühling (4 ≙ 0). Ungültige Werte → Frühling.
 */
export function seasonSound(season: number): SeasonSound {
  const n = SEASON_SOUNDS.length;
  const s = Number.isFinite(season) ? ((season % n) + n) % n : 0;
  const i = Math.floor(s) % n;
  const t = s - Math.floor(s);
  const a = SEASON_SOUNDS[i]!;
  const b = SEASON_SOUNDS[(i + 1) % n]!;
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    wind: mix(a.wind, b.wind),
    cutoff: mix(a.cutoff, b.cutoff),
    birdsPerMinute: mix(a.birdsPerMinute, b.birdsPerMinute),
    pad: mix(a.pad, b.pad),
  };
}

/**
 * Langsame Böen als Faktor in [0,6; 1,0]: drei überlagerte, nicht harmonische Wellen
 * (Perioden ≈ 11 s, 29 s, 5 s), damit der Wind nie gleichmäßig pumpt.
 */
export function windGust(time: number): number {
  if (!Number.isFinite(time)) return 0.8;
  const w = 0.5 * Math.sin(time * 0.57) + 0.3 * Math.sin(time * 0.217 + 1.3) + 0.2 * Math.sin(time * 1.21 + 0.4);
  return 0.8 + 0.2 * w;
}

/** Lautstärken der Stimmen relativ zum Ausgang (0–1). */
export interface AmbienceMix {
  wind: number;
  cutoff: number;
  pad: number;
  birdsPerMinute: number;
}

/** Wind-Anteil am Ausgang bei voller Böe (vor der Jahreszeit; Herbst 0,75 → 0,3). */
export const WIND_LEVEL = 0.4;
/** Spitze des Rausch-Puffers – der Tiefpass (kritisch gedämpft) hebt sie nicht an. */
export const NOISE_PEAK = 0.8;
/** Pad-Anteil am Ausgang: ein Hauch unter dem Wind. */
export const PAD_LEVEL = 0.1;

/** Mischung für einen Augenblick: Jahreszeit, Böen und Harmoniestufe (Pad erst ab Stufe 1). */
export function ambienceMix(season: number, time: number, harmonyTier: number): AmbienceMix {
  const s = seasonSound(season);
  const gust = windGust(time);
  const tier = clampTier(harmonyTier);
  return {
    wind: WIND_LEVEL * s.wind * gust,
    cutoff: s.cutoff * (0.75 + 0.25 * gust),
    pad: tier === 0 ? 0 : PAD_LEVEL * s.pad * (0.6 + 0.1 * tier),
    birdsPerMinute: s.birdsPerMinute,
  };
}

/** Längster Zeitschritt (s), der für Vogelrufe zählt – nach Pausen kein Ruf-Schwall. */
export const MAX_BIRD_STEP = 1;

/**
 * Wahrscheinlichkeit für einen Vogelruf in einem Zeitschritt `dt` (s) bei der
 * *augenblicklichen* Rate (Poisson-Ausdünnung): Je Aktualisierung neu gewürfelt, folgt die
 * Häufigkeit der Jahreszeit sofort – keine im Winter gewürfelten Stundenpausen.
 */
export function birdChance(birdsPerMinute: number, dt: number): number {
  if (!(birdsPerMinute > 0) || !Number.isFinite(birdsPerMinute) || !(dt > 0)) return 0;
  const step = Math.min(dt, MAX_BIRD_STEP);
  return 1 - Math.exp((-birdsPerMinute * step) / 60);
}

/** Ein einzelner Ton eines Vogelrufs (Zeiten in s relativ zum Rufbeginn). */
export interface ChirpNote {
  start: number;
  duration: number;
  /** Anfangs- und Endfrequenz (Hz) – ein kurzer Gleitton. */
  from: number;
  to: number;
  /** Frequenzmodulation: Tiefe (Hz) und Rate (Hz) – das leichte Trillern. */
  fmDepth: number;
  fmRate: number;
  gain: number;
}

export interface Chirp {
  notes: ChirpNote[];
  /** Stereoposition −1 … 1 (Vögel sitzen links und rechts im Wald). */
  pan: number;
}

/** Lautstärke eines Vogeltons relativ zum Ausgang – sehr leise. */
export const BIRD_LEVEL = 0.12;

/**
 * Ein Vogelruf aus 2–4 kurzen Gleittönen zwischen 2,2 und 4,6 kHz. `rand` liefert
 * Zufallszahlen in [0, 1) – mehrmals aufgerufen.
 */
export function planChirp(rand: () => number): Chirp {
  const count = 2 + Math.floor(rand() * 3);
  const base = 2200 + rand() * 1800;
  const falling = rand() < 0.5;
  const notes: ChirpNote[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const duration = 0.05 + rand() * 0.07;
    const pitch = base * (1 + 0.08 * (rand() - 0.5));
    const span = pitch * (0.12 + rand() * 0.15);
    notes.push({
      start,
      duration,
      from: falling ? pitch + span : pitch,
      to: falling ? pitch : Math.min(4600, pitch + span),
      fmDepth: 40 + rand() * 120,
      fmRate: 25 + rand() * 30,
      gain: BIRD_LEVEL * (0.6 + 0.4 * rand()),
    });
    start += duration + 0.03 + rand() * 0.08;
  }
  return { notes, pan: (rand() * 2 - 1) * 0.7 };
}

function clampTier(tier: number): number {
  return Number.isFinite(tier) ? Math.min(4, Math.max(0, Math.round(tier))) : 0;
}

/** Frequenz eines Halbtons über A2 (110 Hz). */
const note = (semitones: number) => 110 * 2 ** (semitones / 12);

/** Feste Pad-Stimmen (Halbtöne über A2): D3, A3, D4, F♯4, A4 – je Stimme ein Oszillator. */
export const PAD_NOTES: readonly number[] = [5, 12, 17, 21, 24];

/** Höchstzahl gleichzeitiger Pad-Stimmen (Stufe 4). */
export const PAD_VOICES = PAD_NOTES.length;

/** Frequenzen der festen Pad-Stimmen (Hz), aufsteigend. */
export const PAD_FREQS: readonly number[] = PAD_NOTES.map(note);

/** Welche Halbtöne je Harmoniestufe 0–4 klingen: von der Quinte zum vollen D-Dur mit Oktaven. */
const PAD_STEPS: readonly (readonly number[])[] = [
  [],
  [5, 12], // D3, A3
  [5, 12, 21], // + F♯4
  [5, 12, 17, 21], // + D4
  [5, 12, 17, 21, 24], // + A4
];

/**
 * Warmer Akkord je Harmoniestufe 0–4: Stufe 0 schweigt, danach wächst er von der Quinte
 * zum vollen Dur-Akkord (D-Dur, tief und ruhig). Frequenzen in Hz, aufsteigend.
 */
export function padChord(harmonyTier: number): number[] {
  return PAD_STEPS[clampTier(harmonyTier)]!.map(note);
}

/**
 * Lautstärke je fester Pad-Stimme (Reihenfolge wie `PAD_NOTES`): 1/PAD_VOICES, wenn der
 * Halbton zum Akkord gehört, sonst 0. Beim Stufenwechsel blenden so nur Lautstärken –
 * keine Stimme gleitet in der Tonhöhe. Summe ≤ 1.
 */
export function padVoiceGains(harmonyTier: number): number[] {
  const chord = PAD_STEPS[clampTier(harmonyTier)]!;
  return PAD_NOTES.map((n) => (chord.includes(n) ? 1 / PAD_VOICES : 0));
}

/** Ereignisse mit eigenem, kurzem Klang. */
export type CueKind = 'encounter' | 'achievement' | 'stage';

/** Ein Ton eines Ereignis-Klangs (Zeiten in s relativ zum Beginn). */
export interface CueTone {
  start: number;
  duration: number;
  freq: number;
  gain: number;
}

/** Lautstärke der Ereignis-Klänge relativ zum Ausgang. */
export const CUE_LEVEL = 0.3;

/**
 * Ereignis-Klänge: Begegnung – ein weiches „Pling“; Erfolg – zwei Töne aufwärts (Quarte);
 * Stufenwechsel – ein kleiner, gebrochener Dur-Dreiklang. Alle kurz und leise.
 */
export const CUES: Readonly<Record<CueKind, readonly CueTone[]>> = {
  encounter: [{ start: 0, duration: 0.9, freq: 1174.66, gain: CUE_LEVEL }],
  achievement: [
    { start: 0, duration: 0.6, freq: 783.99, gain: CUE_LEVEL * 0.9 },
    { start: 0.16, duration: 0.9, freq: 1046.5, gain: CUE_LEVEL * 0.9 },
  ],
  stage: [
    { start: 0, duration: 1.4, freq: 523.25, gain: CUE_LEVEL * 0.75 },
    { start: 0.14, duration: 1.3, freq: 659.25, gain: CUE_LEVEL * 0.7 },
    { start: 0.28, duration: 1.6, freq: 783.99, gain: CUE_LEVEL * 0.7 },
  ],
};

/** Anstieg eines Ereignis-Tons (s), danach exponentielles Ausklingen bis `duration`. */
export const CUE_ATTACK = 0.012;
/** Endwert des Ausklingens (Web Audio kann exponentiell nicht bis 0). */
export const CUE_FLOOR = 0.0001;
/** Leiser Oberton (Oktave) je Ereignis-Ton – erhöht die Spitze höchstens um diesen Anteil. */
export const CUE_OVERTONE = 0.18;
/**
 * Höchste Summe der Hüllkurven aller gleichzeitig klingenden Ereignis-Töne. Treffen
 * mehrere Ereignisse zusammen, rückt der spätere Klang nach hinten (`planCueStart`).
 */
export const CUE_PEAK_LIMIT = 0.4;
/** So weit (s) darf ein Ereignis-Klang höchstens nach hinten rücken; sonst entfällt er. */
export const CUE_MAX_DELAY = 1.5;
/** Raster (s), in dem ein Ereignis-Klang nach hinten rückt. */
const CUE_DELAY_STEP = 0.05;

/** Ein geplanter Ereignis-Klang (Beginn in Sekunden der Audio-Uhr). */
export interface ActiveCue {
  kind: CueKind;
  start: number;
}

/** Hüllkurve eines Ereignis-Tons zur Zeit `t` (relativ zum Tonbeginn) – wie in `sound.ts`. */
export function cueToneEnvelope(tone: CueTone, t: number): number {
  if (!(t > 0) || t > tone.duration) return 0;
  if (t <= CUE_ATTACK) return (tone.gain * t) / CUE_ATTACK;
  const f = (t - CUE_ATTACK) / (tone.duration - CUE_ATTACK);
  return tone.gain * (CUE_FLOOR / tone.gain) ** f;
}

/** Ende eines Ereignis-Klangs (s nach dessen Beginn). */
export function cueLength(kind: CueKind): number {
  return Math.max(...CUES[kind].map((t) => t.start + t.duration));
}

/**
 * Höchste Summe der Hüllkurven aller Ereignis-Töne. Jede Hüllkurve ist stückweise linear
 * (Anstieg) oder exponentiell fallend, also konvex – die Summe ist zwischen zwei Knicken
 * konvex und hat ihr Maximum an einem Knick. Darum genügt es, die Knicke zu prüfen.
 */
export function cuePeak(cues: readonly ActiveCue[]): number {
  const tones = cues.flatMap((c) => CUES[c.kind].map((tone) => ({ tone, at: c.start + tone.start })));
  let peak = 0;
  for (const { tone, at } of tones) {
    for (const t of [at + CUE_ATTACK, at + tone.duration]) {
      let sum = 0;
      for (const o of tones) sum += cueToneEnvelope(o.tone, t - o.at);
      peak = Math.max(peak, sum);
    }
  }
  return peak;
}

/**
 * Frühester Beginn (≥ `now`) für einen neuen Ereignis-Klang, bei dem zusammen mit den
 * noch klingenden die Summe `CUE_PEAK_LIMIT` nicht übersteigt; `null`, wenn er auch
 * `CUE_MAX_DELAY` später nicht passt (dann entfällt er).
 */
export function planCueStart(active: readonly ActiveCue[], kind: CueKind, now: number): number | null {
  const running = active.filter((c) => c.start + cueLength(c.kind) > now);
  for (let delay = 0; delay <= CUE_MAX_DELAY + 1e-9; delay += CUE_DELAY_STEP) {
    const start = now + delay;
    if (cuePeak([...running, { kind, start }]) <= CUE_PEAK_LIMIT + 1e-9) return start;
  }
  return null;
}

/**
 * Höchste Summe aller Stimmen hinter dem Master (linear): Wind bei voller Böe in der
 * windigsten Jahreszeit, volles Pad, ein Vogelruf und alle Ereignis-Töne samt Oberton.
 * Muss ≤ 1 bleiben, dann ist die Spitze am Ausgang ≤ Master (≤ −12 dBFS).
 */
export function peakBudget(): { wind: number; pad: number; bird: number; cue: number; total: number } {
  const wind = WIND_LEVEL * Math.max(...SEASON_SOUNDS.map((s) => s.wind)) * NOISE_PEAK;
  const pad = PAD_LEVEL * Math.max(...SEASON_SOUNDS.map((s) => s.pad));
  const bird = BIRD_LEVEL;
  const cue = CUE_PEAK_LIMIT * (1 + CUE_OVERTONE);
  return { wind, pad, bird, cue, total: wind + pad + bird + cue };
}

/** Mindestabstand (s) zwischen zwei gleichen Ereignis-Klängen – nie hektisch. */
export const CUE_MIN_GAP = 1.5;

/** Darf ein Ereignis-Klang jetzt erklingen? (`last`: Zeit des letzten gleichen, s.) */
export function cueAllowed(last: number | undefined, now: number): boolean {
  return last === undefined || !(now - last < CUE_MIN_GAP);
}
