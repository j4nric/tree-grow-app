/**
 * Klangkulisse per Web Audio API – prozedural, ohne Audiodateien.
 *
 * Nur Oberfläche: liest die Szene (Jahreszeit, Harmoniestufe) und spielt kurze
 * Ereignis-Klänge, verändert nie den Spielstand. Was erklingt, rechnet `sound-plan.ts`
 * (rein, getestet); hier werden daraus Web-Audio-Knoten.
 *
 * - Standard „Aus“: Dann entsteht gar kein AudioContext.
 * - Autoplay-Regeln: Der AudioContext entsteht erst bei einer Nutzerinteraktion (Klick,
 *   Taste, Wahl in den Einstellungen) und wird bei der nächsten fortgesetzt, falls der
 *   Browser ihn angehalten hat.
 * - Verborgener Tab: ausblenden und anhalten; beim Zurückkehren weich wieder einblenden.
 * - Ohne Web Audio (alte Browser, Tests) bleibt alles still – nichts wirft.
 *
 * Signalweg: Stimmen → Master (≤ −12 dBFS) → Kompressor → Begrenzer → Ausgang.
 */
import type { SoundLevel } from './settings';
import {
  CUES,
  PAD_VOICES,
  ambienceMix,
  cueAllowed,
  masterGain,
  nextBirdDelay,
  padChord,
  planChirp,
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
  padOscs: OscillatorNode[];
  padVoices: GainNode[];
}

export function createSound(initial: SoundLevel, env: SoundEnv = defaultEnv()): SoundEngine {
  let level = initial;
  let graph: Graph | null = null;
  let failed = env.createContext === null;
  let hidden = env.doc.visibilityState === 'hidden';
  let lastUpdate = -Infinity;
  let nextBird = Infinity;
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
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.02;
      compressor.release.value = 0.3;
      // Begrenzer: hartes Knie, hohe Ratio – fängt seltene Spitzen ab.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master.connect(compressor).connect(limiter).connect(ctx.destination);

      // Wind: rosa gefärbtes Rauschen in Schleife → Tiefpass → Lautstärke.
      const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const loopLength = fillPinkNoise(noise.getChannelData(0), env.random);
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = loopLength / ctx.sampleRate;
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 90;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 600;
      windFilter.Q.value = 0.4;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      source.connect(highpass).connect(windFilter).connect(windGain).connect(master);
      source.start();

      // Pad: weiche Dreiecksstimmen, leicht verstimmt, durch einen dunklen Tiefpass.
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 800;
      const padGain = ctx.createGain();
      padGain.gain.value = 0;
      padFilter.connect(padGain).connect(master);
      const padOscs: OscillatorNode[] = [];
      const padVoices: GainNode[] = [];
      for (let i = 0; i < PAD_VOICES; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 146.83;
        osc.detune.value = (i % 2 === 0 ? 1 : -1) * (3 + i);
        const voice = ctx.createGain();
        voice.gain.value = 0;
        osc.connect(voice).connect(padFilter);
        osc.start();
        padOscs.push(osc);
        padVoices.push(voice);
      }
      graph = { ctx, master, windGain, windFilter, padGain, padOscs, padVoices };
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
      if (target > 0 && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      master.gain.cancelScheduledValues(ctx.currentTime);
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
    const g = graph ?? build();
    if (!g) {
      publish();
      return;
    }
    if (g.ctx.state !== 'running') applyMaster();
    else publish();
  }

  const onGesture = () => unlock();
  env.doc.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  env.doc.addEventListener('keydown', onGesture, { capture: true, passive: true });
  env.doc.addEventListener('visibilitychange', () => {
    hidden = env.doc.visibilityState === 'hidden';
    applyMaster();
    publish();
  });

  function setPad(g: Graph, harmonyTier: number, amount: number): void {
    const chord = padChord(harmonyTier);
    const t = g.ctx.currentTime;
    g.padGain.gain.setTargetAtTime(amount, t, SMOOTH * 3);
    for (let i = 0; i < PAD_VOICES; i++) {
      const freq = chord[i];
      if (freq !== undefined) g.padOscs[i]!.frequency.setTargetAtTime(freq, t, SMOOTH);
      // Je Stimme gleich laut; Summe bleibt ≤ 1.
      g.padVoices[i]!.gain.setTargetAtTime(freq === undefined ? 0 : 1 / PAD_VOICES, t, SMOOTH * 2);
    }
  }

  function playChirp(g: Graph): void {
    const { ctx, master } = g;
    const chirp = planChirp(env.random);
    const t0 = ctx.currentTime + 0.05;
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
      shape.gain.exponentialRampToValueAtTime(0.0001, stop);
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

  function playCue(g: Graph, kind: CueKind): void {
    const { ctx, master } = g;
    const t0 = ctx.currentTime + 0.02;
    for (const tone of CUES[kind]) {
      const start = t0 + tone.start;
      const stop = start + tone.duration;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      gain.connect(master);
      // Grundton plus leiser Oberton: weich, glockenähnlich.
      const partials: [number, number][] = [
        [tone.freq, 1],
        [tone.freq * 2, 0.18],
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
      lastUpdate = now;
      try {
        const mix = ambienceMix(view.season, now, view.harmonyTier);
        const t = g.ctx.currentTime;
        g.windGain.gain.setTargetAtTime(mix.wind, t, SMOOTH);
        g.windFilter.frequency.setTargetAtTime(mix.cutoff, t, SMOOTH);
        setPad(g, view.harmonyTier, mix.pad);
        if (!Number.isFinite(nextBird)) nextBird = now + nextBirdDelay(mix.birdsPerMinute, env.random());
        else if (now >= nextBird) {
          if (mix.birdsPerMinute > 0) playChirp(g);
          nextBird = now + nextBirdDelay(mix.birdsPerMinute, env.random());
        }
      } catch {
        // ignorieren – ein ausgelassener Schritt fällt nicht auf
      }
    },
    cue(kind) {
      const g = graph;
      if (!g || level === 'off' || hidden || g.ctx.state !== 'running') return;
      const now = g.ctx.currentTime;
      if (!cueAllowed(lastCue[kind], now)) return;
      lastCue[kind] = now;
      try {
        playCue(g, kind);
      } catch {
        // ignorieren
      }
    },
  };
}

/**
 * Rosa gefärbtes Rauschen (Paul Kellets „economy“-Filter) – weicher als weißes Rauschen,
 * klingt eher nach Wind in Blättern. Der Anfang wird mit dem Ende überblendet, damit die
 * Schleife nicht knackt: Gibt die Länge der nahtlosen Schleife zurück (≤ data.length).
 */
export function fillPinkNoise(data: Float32Array, random: () => number): number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = Math.max(-0.95, Math.min(0.95, (b0 + b1 + b2 + white * 0.1848) * 0.15));
  }
  const fade = Math.min(Math.floor(data.length / 4), 4000);
  const loop = data.length - fade;
  for (let i = 0; i < fade; i++) {
    const f = i / fade;
    data[i] = data[i]! * f + data[loop + i]! * (1 - f);
  }
  return loop;
}
