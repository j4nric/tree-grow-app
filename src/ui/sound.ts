/**
 * Klangkulisse per Web Audio API – prozedural, ohne Audiodateien.
 *
 * Nur Oberfläche: liest die Szene (Jahreszeit, Harmoniestufe) und spielt kurze
 * Ereignis-Klänge, verändert nie den Spielstand. Was erklingt, rechnet `sound-plan.ts`
 * (rein, getestet); hier werden daraus Web-Audio-Knoten.
 *
 * - Standard „Aus“: Dann entsteht gar kein AudioContext.
 * - Autoplay-Regeln: Der AudioContext entsteht erst bei einer Nutzerinteraktion (Zeiger,
 *   Klick, Berührung, Taste, Wahl in den Einstellungen) und wird bei der nächsten
 *   fortgesetzt, falls der Browser ihn angehalten hat (auch iOS-Zustand „interrupted“).
 * - Verborgener Tab: ausblenden und anhalten; beim Zurückkehren weich wieder einblenden.
 * - Ohne Web Audio (alte Browser, Tests) bleibt alles still – nichts wirft.
 *
 * Signalweg: Stimmen → Master → Sicherheits-Clipper (±0,25) → Ausgang. Die Anteile der
 * Stimmen sind so bemessen (`peakBudget` in sound-plan.ts), dass ihre Summe ≤ 1 bleibt;
 * mit dem Master (Normal 0,25) ist die Spitze also ≤ −12 dBFS, Leise 10 dB darunter.
 * Kein Kompressor – dessen automatischer Ausgleichs-Gain hob die Spitzen bis −2 dBFS.
 * Der Clipper greift nur, falls der Haushalt je verletzt würde.
 */
import type { SoundLevel } from './settings';
import {
  CUES,
  CUE_ATTACK,
  CUE_FLOOR,
  CUE_OVERTONE,
  MAX_MASTER_GAIN,
  NOISE_PEAK,
  PAD_FREQS,
  ambienceMix,
  birdChance,
  cueAllowed,
  cueLength,
  masterGain,
  padVoiceGains,
  planChirp,
  planCueStart,
  type ActiveCue,
  type CueKind,
} from './sound-plan';

/** Was die Kulisse aus der Szene braucht. */
export interface SoundView {
  /** Jahreszeit stufenlos wie `SceneInput.season` ([0, 4)). */
  season: number;
  /** Harmoniestufe 0–4. */
  harmonyTier: number;
}

/** Zustand für Tests und Fehlersuche (`body[data-sound]`). */
export type SoundState = 'off' | 'waiting' | 'running' | 'paused' | 'unavailable';

export interface SoundEngine {
  readonly state: SoundState;
  setLevel(level: SoundLevel): void;
  /** Jeden Frame aufrufen (`now` in Sekunden); intern gedrosselt. */
  update(view: SoundView, now: number): void;
  /** Kurzer Ereignis-Klang (nur, wenn die Kulisse läuft). */
  cue(kind: CueKind): void;
}

/** Umgebung – in Tests ersetzbar. */
export interface SoundEnv {
  createContext: (() => AudioContext) | null;
  doc: Pick<Document, 'addEventListener' | 'visibilityState'> & { body?: HTMLElement | null };
  random: () => number;
}

/** So oft werden Wind und Pad nachgeführt (s) – Rampen glätten dazwischen. */
const UPDATE_EVERY = 0.2;
/** Zeitkonstante der weichen Übergänge (s). */
const SMOOTH = 0.6;
/** Ein- und Ausblenden beim Umschalten, Verbergen, Zurückkehren (s). */
const FADE = 0.4;
/** Länge des Rausch-Puffers (s), läuft in Schleife. */
const NOISE_SECONDS = 3;
/** Biquad-Güte in dB (Web Audio): −6,02 dB ≙ Q 0,5 – kritisch gedämpft, kein Überschwingen. */
const Q_NO_OVERSHOOT = 20 * Math.log10(0.5);
/** Unterhalb dieser Änderung wird keine neue Automatisierung gesetzt (relativ bzw. absolut). */
const MIN_CHANGE = 0.01;
const MIN_CHANGE_ABS = 1e-4;
/** Gesten, die einen AudioContext freischalten dürfen (iOS: erst touchend/click). */
const GESTURES = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'] as const;

/** Angehalten (auch iOS „interrupted“ nach Anruf o. Ä.) → bei Interaktion fortsetzen. */
function isHalted(state: string): boolean {
  return state === 'suspended' || state === 'interrupted';
}

/** Bisherige Automatisierung ab `t` verwerfen, aktuellen Wert halten (Fallback ohne cancelAndHoldAtTime). */
function holdAt(param: AudioParam, t: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

/** Kennlinie des Sicherheits-Clippers: Identität bis ±MAX_MASTER_GAIN, darüber flach. */
function clipCurve() {
  // Stützstellen bei −1, −0,75 … 1: ±0,25 liegt genau auf einer Stützstelle.
  const n = 9;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    curve[i] = Math.max(-MAX_MASTER_GAIN, Math.min(MAX_MASTER_GAIN, x));
  }
  return curve;
}

function defaultEnv(): SoundEnv {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return {
    createContext: typeof Ctor === 'function' ? () => new Ctor() : null,
    doc: document,
    random: Math.random,
  };
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  padGain: GainNode;
  padVoices: GainNode[];
}

export function createSound(initial: SoundLevel, env: SoundEnv = defaultEnv()): SoundEngine {
  let level = initial;
  let graph: Graph | null = null;
  let failed = env.createContext === null;
  let hidden = env.doc.visibilityState === 'hidden';
  let lastUpdate = -Infinity;
  /** Ende des laufenden Vogelrufs (Audio-Uhr) – Rufe überlappen nie. */
  let birdBusyUntil = -Infinity;
  /** Noch klingende Ereignis-Klänge (Audio-Uhr) für den Pegel-Haushalt. */
  let activeCues: ActiveCue[] = [];
  /** Zuletzt gesetzte Ziele je Parameter – nur spürbare Änderungen neu planen. */
  let targets = new WeakMap<AudioParam, number>();
  let shownState: SoundState | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  const lastCue: Partial<Record<CueKind, number>> = {};

  function currentState(): SoundState {
    if (level === 'off') return 'off';
    if (failed) return 'unavailable';
    if (!graph) return 'waiting';
    if (hidden || graph.ctx.state !== 'running') return 'paused';
    return 'running';
  }

  function publish(): void {
    const s = currentState();
    if (s === shownState) return;
    shownState = s;
    const body = env.doc.body;
    if (body) body.dataset.sound = s;
  }

  /** Legt den AudioContext und alle festen Knoten an (einmal, bei einer Nutzerinteraktion). */
  function build(): Graph | null {
    if (graph || failed || !env.createContext) return graph;
    try {
      const ctx = env.createContext();
      const master = ctx.createGain();
      master.gain.value = 0;
      // Sicherheits-Clipper: bei eingehaltenem Haushalt wirkungslos (Identität).
      const clipper = ctx.createWaveShaper();
      clipper.curve = clipCurve();
      clipper.oversample = 'none';
      master.connect(clipper).connect(ctx.destination);

      // Wind: rosa gefärbtes Rauschen in Schleife → Tiefpass → Lautstärke.
      const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const loopLength = fillPinkNoise(noise.getChannelData(0), env.random, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = loopLength / ctx.sampleRate;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 600;
      windFilter.Q.value = Q_NO_OVERSHOOT;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      source.connect(windFilter).connect(windGain).connect(master);
      source.start();

      // Pad: je Halbton eine feste Dreiecksstimme, leicht verstimmt, durch einen dunklen
      // Tiefpass. Beim Stufenwechsel blenden nur die Lautstärken.
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 800;
      padFilter.Q.value = Q_NO_OVERSHOOT;
      const padGain = ctx.createGain();
      padGain.gain.value = 0;
      padFilter.connect(padGain).connect(master);
      const padVoices: GainNode[] = [];
      PAD_FREQS.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = (i % 2 === 0 ? 1 : -1) * (3 + i);
        const voice = ctx.createGain();
        voice.gain.value = 0;
        osc.connect(voice).connect(padFilter);
        osc.start();
        padVoices.push(voice);
      });
      graph = { ctx, master, windGain, windFilter, padGain, padVoices };
      targets = new WeakMap();
      ctx.addEventListener?.('statechange', publish);
      lastUpdate = -Infinity;
      return graph;
    } catch {
      // Kein Web Audio oder blockiert: still bleiben, nie das Spiel stören.
      failed = true;
      graph = null;
      return null;
    }
  }

  /** Lautstärke am Ausgang weich anpassen; bei „Aus“ oder verborgenem Tab danach anhalten. */
  function applyMaster(): void {
    if (!graph) return;
    const { ctx, master } = graph;
    const target = masterGain(level, hidden);
    clearTimeout(suspendTimer);
    try {
      if (target > 0 && isHalted(ctx.state)) void ctx.resume().catch(() => undefined);
      holdAt(master.gain, ctx.currentTime);
      master.gain.setTargetAtTime(target, ctx.currentTime, FADE / 3);
      if (target === 0) {
        suspendTimer = setTimeout(() => {
          if (graph && masterGain(level, hidden) === 0) void graph.ctx.suspend().catch(() => undefined);
          publish();
        }, FADE * 2500);
      }
    } catch {
      // ignorieren – höchstens bleibt es still
    }
    publish();
  }

  /** Nutzerinteraktion: Kulisse anlegen bzw. fortsetzen (Autoplay-Regeln). */
  function unlock(): void {
    if (level === 'off' || hidden) return;
    const fresh = !graph;
    const g = graph ?? build();
    if (!g) {
      publish();
      return;
    }
    // Frisch angelegt: Master steht auf 0 und muss eingeblendet werden – auch wenn der
    // Browser den Kontext in der Geste sofort „running“ anlegt (Chromium).
    if (fresh || g.ctx.state !== 'running') applyMaster();
    else publish();
  }

  const onGesture = () => unlock();
  for (const type of GESTURES) env.doc.addEventListener(type, onGesture, { capture: true, passive: true });
  env.doc.addEventListener('visibilitychange', () => {
    hidden = env.doc.visibilityState === 'hidden';
    applyMaster();
    publish();
  });

  /** Parameter weich nachführen – nur bei spürbarer Änderung eine neue Automatisierung. */
  function glide(param: AudioParam, target: number, t: number, timeConstant: number): void {
    const prev = targets.get(param);
    if (prev !== undefined && Math.abs(target - prev) <= Math.max(MIN_CHANGE_ABS, Math.abs(prev) * MIN_CHANGE)) return;
    targets.set(param, target);
    param.setTargetAtTime(target, t, timeConstant);
  }

  function setPad(g: Graph, harmonyTier: number, amount: number): void {
    const t = g.ctx.currentTime;
    glide(g.padGain.gain, amount, t, SMOOTH * 3);
    padVoiceGains(harmonyTier).forEach((gain, i) => glide(g.padVoices[i]!.gain, gain, t, SMOOTH * 2));
  }

  function playChirp(g: Graph): void {
    const { ctx, master } = g;
    const chirp = planChirp(env.random);
    const t0 = ctx.currentTime + 0.05;
    const last = chirp.notes[chirp.notes.length - 1];
    birdBusyUntil = t0 + (last ? last.start + last.duration + 0.05 : 0);
    const out: AudioNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : master;
    if (out !== master) {
      (out as StereoPannerNode).pan.value = chirp.pan;
      out.connect(master);
    }
    let end = t0;
    for (const n of chirp.notes) {
      const start = t0 + n.start;
      const stop = start + n.duration;
      end = Math.max(end, stop);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.from, start);
      osc.frequency.exponentialRampToValueAtTime(n.to, stop);
      const fm = ctx.createOscillator();
      fm.frequency.value = n.fmRate;
      const fmDepth = ctx.createGain();
      fmDepth.gain.value = n.fmDepth;
      fm.connect(fmDepth).connect(osc.frequency);
      const shape = ctx.createGain();
      shape.gain.setValueAtTime(0, start);
      shape.gain.linearRampToValueAtTime(n.gain, start + Math.min(0.015, n.duration / 3));
      shape.gain.exponentialRampToValueAtTime(CUE_FLOOR, stop);
      osc.connect(shape).connect(out);
      osc.start(start);
      fm.start(start);
      osc.stop(stop + 0.02);
      fm.stop(stop + 0.02);
      osc.onended = () => {
        osc.disconnect();
        fm.disconnect();
        fmDepth.disconnect();
        shape.disconnect();
      };
    }
    if (out !== master) setTimeout(() => out.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  }

  function playCue(g: Graph, kind: CueKind, t0: number): void {
    const { ctx, master } = g;
    for (const tone of CUES[kind]) {
      const start = t0 + tone.start;
      const stop = start + tone.duration;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain, start + CUE_ATTACK);
      gain.gain.exponentialRampToValueAtTime(CUE_FLOOR, stop);
      gain.connect(master);
      // Grundton plus leiser Oberton: weich, glockenähnlich.
      const partials: [number, number][] = [
        [tone.freq, 1],
        [tone.freq * 2, CUE_OVERTONE],
      ];
      for (const [freq, amount] of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const mix = ctx.createGain();
        mix.gain.value = amount;
        osc.connect(mix).connect(gain);
        osc.start(start);
        osc.stop(stop + 0.05);
        osc.onended = () => {
          osc.disconnect();
          mix.disconnect();
        };
      }
      setTimeout(() => gain.disconnect(), (stop - ctx.currentTime + 0.3) * 1000);
    }
  }

  publish();

  return {
    get state() {
      return currentState();
    },
    setLevel(next) {
      level = next;
      // Die Wahl in den Einstellungen ist selbst eine Nutzerinteraktion.
      if (level !== 'off') unlock();
      applyMaster();
      publish();
    },
    update(view, now) {
      const g = graph;
      if (!g || level === 'off' || hidden || g.ctx.state !== 'running') return;
      if (now - lastUpdate < UPDATE_EVERY) return;
      // Nach Pausen (verborgen, angehalten) zählt höchstens ein kurzer Schritt.
      const dt = Number.isFinite(lastUpdate) ? now - lastUpdate : 0;
      lastUpdate = now;
      try {
        const mix = ambienceMix(view.season, now, view.harmonyTier);
        const t = g.ctx.currentTime;
        glide(g.windGain.gain, mix.wind, t, SMOOTH);
        glide(g.windFilter.frequency, mix.cutoff, t, SMOOTH);
        setPad(g, view.harmonyTier, mix.pad);
        // Poisson-Ausdünnung: je Schritt neu würfeln, Rate der aktuellen Jahreszeit.
        if (env.random() < birdChance(mix.birdsPerMinute, dt) && t >= birdBusyUntil) playChirp(g);
      } catch {
        // ignorieren – ein ausgelassener Schritt fällt nicht auf
      }
    },
    cue(kind) {
      const g = graph;
      if (!g || level === 'off' || hidden || g.ctx.state !== 'running') return;
      const now = g.ctx.currentTime;
      if (!cueAllowed(lastCue[kind], now)) return;
      activeCues = activeCues.filter((c) => c.start + cueLength(c.kind) > now);
      // Treffen Ereignisse zusammen, rückt der spätere Klang nach hinten (Pegel-Haushalt).
      const start = planCueStart(activeCues, kind, now + 0.02);
      if (start === null) return;
      lastCue[kind] = now;
      activeCues.push({ kind, start });
      try {
        playCue(g, kind, start);
      } catch {
        // ignorieren
      }
    },
  };
}

/**
 * Rosa gefärbtes Rauschen (Paul Kellets „economy“-Filter) – weicher als weißes Rauschen,
 * klingt eher nach Wind in Blättern. Tiefes Brummen unter ≈ 90 Hz wird gleich hier
 * entfernt, danach auf die Spitze `NOISE_PEAK` normiert (der Wind-Tiefpass ist kritisch
 * gedämpft und hebt sie nicht an). Der Anfang wird mit dem Ende überblendet, damit die
 * Schleife nicht knackt: Gibt die Länge der nahtlosen Schleife zurück (≤ data.length).
 */
export function fillPinkNoise(data: Float32Array, random: () => number, sampleRate = 48000): number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  // Einpoliger Hochpass ≈ 90 Hz.
  const a = Math.exp((-2 * Math.PI * 90) / sampleRate);
  let prevIn = 0;
  let prevOut = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = b0 + b1 + b2 + white * 0.1848;
    const out = a * (prevOut + pink - prevIn);
    prevIn = pink;
    prevOut = out;
    data[i] = out;
    peak = Math.max(peak, Math.abs(out));
  }
  const scale = peak > 0 ? NOISE_PEAK / peak : 0;
  for (let i = 0; i < data.length; i++) data[i] = data[i]! * scale;
  // Überblenden: |f·x + (1−f)·y| ≤ max(|x|, |y|) – die Spitze bleibt.
  const fade = Math.min(Math.floor(data.length / 4), 4000);
  const loop = data.length - fade;
  for (let i = 0; i < fade; i++) {
    const f = i / fade;
    data[i] = data[i]! * f + data[loop + i]! * (1 - f);
  }
  return loop;
}
