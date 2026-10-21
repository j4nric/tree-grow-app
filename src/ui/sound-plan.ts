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
 * Lautstärke am Ausgang (linear, vor dem Begrenzer) je Einstellung. „Normal“ liegt bei
 * etwa −12 dBFS, „Leise“ bei etwa −20 dBFS – deutlich unter Vollaussteuerung.
 */
export const MASTER_GAIN: Readonly<Record<SoundLevel, number>> = { off: 0, quiet: 0.1, normal: 0.25 };

/** Obergrenze, die keine Stimme und kein Ereignis überschreitet (linear, ≈ −12 dBFS). */
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

/** Wind-Anteil am Ausgang bei voller Böe. */
export const WIND_LEVEL = 0.5;
/** Pad-Anteil am Ausgang: ein Hauch unter dem Wind. */
export const PAD_LEVEL = 0.12;

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

/**
 * Sekunden bis zum nächsten Vogelruf: exponentiell verteilt (zufällige, aber im Mittel
 * gleichmäßige Abstände), mindestens 2 s. Ohne Vögel (Winter) → Infinity.
 */
export function nextBirdDelay(birdsPerMinute: number, rand: number): number {
  if (!(birdsPerMinute > 0) || !Number.isFinite(birdsPerMinute)) return Infinity;
  const u = Math.min(Math.max(Number.isFinite(rand) ? rand : 0.5, 0), 0.999999);
  return Math.max(2, (-Math.log(1 - u) * 60) / birdsPerMinute);
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
export const BIRD_LEVEL = 0.18;

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

/**
 * Warmer Akkord je Harmoniestufe 0–4: Stufe 0 schweigt, danach wächst er von der Quinte
 * zum vollen Dur-Akkord mit None (D-Dur, tief und ruhig). Frequenzen in Hz, aufsteigend.
 */
export function padChord(harmonyTier: number): number[] {
  const steps: readonly (readonly number[])[] = [
    [],
    [5, 12], // D3, A3
    [5, 12, 21], // + F♯4
    [5, 12, 17, 21], // + D4
    [5, 12, 17, 21, 24], // + A4
  ];
  return steps[clampTier(harmonyTier)]!.map(note);
}

/** Höchstzahl gleichzeitiger Pad-Stimmen (Stufe 4). */
export const PAD_VOICES = 5;

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
export const CUE_LEVEL = 0.35;

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

/** Mindestabstand (s) zwischen zwei gleichen Ereignis-Klängen – nie hektisch. */
export const CUE_MIN_GAP = 1.5;

/** Darf ein Ereignis-Klang jetzt erklingen? (`last`: Zeit des letzten gleichen, s.) */
export function cueAllowed(last: number | undefined, now: number): boolean {
  return last === undefined || !(now - last < CUE_MIN_GAP);
}
