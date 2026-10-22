/**
 * Wetter in der Szene (DESIGN_V2.md 21.8): `SceneInput.weather` (heute), `weatherPrevious`
 * (Vortag) und `weatherBlend` 0–1 (Überblendung am Tageswechsel).
 *
 *   ⛅ mild      wie ohne Angabe (nichts wird zusätzlich gezeichnet)
 *   🌧️ rain      graue Wolkendecke, schräge Regenstriche, feucht glänzender Boden,
 *                Glühwürmchen-Schein aus
 *   ☀️ sun       kaum Wolken, kräftigerer Sonnenschein mit Strahlen
 *   🌫️ fog       blasser Hintergrund, drei langsam ziehende Nebelbänder in Bodennähe
 *   🌨️ snow      fallende Flocken, Schneehäubchen auf den Ästen, Schneedecke verstärkt
 *   🌡️ drought   warmer, gelblicher Ton, strohiges Gras, leises Hitzeflimmern am Horizont
 *   🌬️ storm     dunkle, schnell ziehende Wolken, Wind ×2–3, fliegende Blätter –
 *                keine Blitze, kein Flackern
 *   🧊 frost     Raureif (weißlicher Saum oben an Ästen und Gras), leises Glitzern
 *
 * Leistung: Alles Flächige wird in die getönten Kopien der Ebenen gebacken (tree.ts,
 * wie Tag und Nacht in daylight.ts) – Wolkendecke, Dunst, Sonnenstrahlen, Schneedecke,
 * Raureif und die Lichtfarbe. Neu getönt wird nur bei einer neuen Tönungsstufe (die
 * Überblendung läuft in WEATHER_TONE_STEPS Stufen). Pro Frame kommen nur Partikel aus
 * festen Pools (Regen als ein einziger Pfad, Flocken, Blätter, Glitzern als Sprites) und
 * drei vorgefertigte Nebelbänder dazu – keine Verläufe, keine Objekte, keine Strings.
 * „Weniger Bewegung“: ohne Überblendung, halb so viele Partikel, die stehen; kein
 * Wind-Ausschlag, kein Flimmern, kein Funkeln.
 *
 * Kein Import aus core/ oder content/: Die IDs sind dieselben wie in content/weather.ts
 * (`WeatherId`); unbekannte gelten als „ohne Angabe“.
 */

import { paintSnowCover } from './season';
import { clamp01, hash2 } from './util';

/** Wetterlagen der Szene – dieselben IDs wie `WeatherId` in src/content/weather.ts. */
export const SCENE_WEATHERS = ['mild', 'rain', 'sun', 'fog', 'snow', 'drought', 'storm', 'frost'] as const;
export type SceneWeatherId = (typeof SCENE_WEATHERS)[number];

/** Stufen der Überblendung für die gebackene Tönung (dazwischen wird nicht neu getönt). */
export const WEATHER_TONE_STEPS = 4;
/** Höchstzahl der Partikel je Art auf dem Desktop (mobil die Hälfte, „Weniger Bewegung“ halbiert). */
export const MAX_RAIN = 120;
export const MAX_SNOW = 120;
export const MAX_GUST_LEAVES = 20;
export const MAX_GLINTS = 14;
/** Breite, ab der die volle Partikelzahl gilt (darunter: mobil, die Hälfte). */
export const SMALL_SCENE_WIDTH = 600;
/** Zusätzlicher Wind-Ausschlag bei Sturm: Faktor 1 + STORM_WIND_GAIN, dazu kurze Böen. */
export const STORM_WIND_GAIN = 1.6;
export const STORM_GUST = 0.004;
/** Wolken ziehen bei Sturm so viel schneller (zusätzlich zur normalen Zeit). */
const STORM_CLOUD_SPEED = 3;

/** Stärken eines Wetters (je 0–1), aus denen Bild und Tönung entstehen. */
export interface WeatherLevels {
  /** Graue Wolkendecke: Himmel grau, Wolken dichter und dunkler, Sterne verdeckt. */
  overcast: number;
  rain: number;
  snow: number;
  fog: number;
  drought: number;
  storm: number;
  frost: number;
  /** Kräftiger Sonnenschein: Strahlen, wenige Wolken. */
  sun: number;
}

function levels(overcast: number, rain: number, snow: number, fog: number, drought: number, storm: number, frost: number, sun: number): WeatherLevels {
  return { overcast, rain, snow, fog, drought, storm, frost, sun };
}

const NONE: Readonly<WeatherLevels> = levels(0, 0, 0, 0, 0, 0, 0, 0);
const TABLE: Readonly<Record<SceneWeatherId, Readonly<WeatherLevels>>> = {
  mild: NONE,
  rain: levels(0.8, 1, 0, 0, 0, 0, 0, 0),
  sun: levels(0, 0, 0, 0, 0, 0, 0, 1),
  fog: levels(0.3, 0, 0, 1, 0, 0, 0, 0),
  snow: levels(0.5, 0, 1, 0, 0, 0, 0, 0),
  drought: levels(0, 0, 0, 0, 1, 0, 0, 0.45),
  storm: levels(0.95, 0, 0, 0, 0, 1, 0, 0),
  frost: levels(0, 0, 0, 0, 0, 0, 1, 0.25),
};
const KEYS = Object.keys(NONE) as (keyof WeatherLevels)[];

/** Bekannte Wetter-ID oder null (fehlend, unbekannt). */
export function normalizeWeather(id: unknown): SceneWeatherId | null {
  return typeof id === 'string' && (SCENE_WEATHERS as readonly string[]).includes(id) ? (id as SceneWeatherId) : null;
}

/**
 * Demo- und Testparameter `?weather=<id>` aus einem Query-String (z. B. `location.search`):
 * bekannte ID oder null.
 */
export function weatherParam(search: string): SceneWeatherId | null {
  try {
    return normalizeWeather(new URLSearchParams(search).get('weather'));
  } catch {
    return null;
  }
}

/** Überblendung 0–1: fehlend/ungültig → 1 (ganz heute), „Weniger Bewegung“ → 1 (ohne Überblendung). */
export function normalizeBlend(blend: number | undefined, reducedMotion = false): number {
  if (reducedMotion || blend === undefined || !Number.isFinite(blend)) return 1;
  return clamp01(blend);
}

/** Stärken eines Wetters (unbekannt → wie mild). */
export function weatherLevels(id: SceneWeatherId | null, out: WeatherLevels = { ...NONE }): WeatherLevels {
  const src = TABLE[id ?? 'mild'] ?? NONE;
  for (const k of KEYS) out[k] = src[k];
  return out;
}

/** Stärken der Überblendung vom Vortag (`previous`) zu heute (`current`) bei `blend` 0–1 (rein, linear). */
export function mixWeather(previous: SceneWeatherId | null, current: SceneWeatherId | null, blend: number, out: WeatherLevels = { ...NONE }): WeatherLevels {
  const a = TABLE[previous ?? current ?? 'mild'] ?? NONE;
  const b = TABLE[current ?? 'mild'] ?? NONE;
  const t = clamp01(Number.isFinite(blend) ? blend : 1);
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Ist nichts zu zeichnen (alle Stärken ~0)? */
export function isClearWeather(lv: WeatherLevels): boolean {
  for (const k of KEYS) if (lv[k] > 1e-4) return false;
  return true;
}

/** Stufe der Überblendung 0 … WEATHER_TONE_STEPS (gerundet). */
export function toneStep(blend: number): number {
  return Math.round(clamp01(Number.isFinite(blend) ? blend : 1) * WEATHER_TONE_STEPS);
}

/**
 * Schlüssel der gebackenen Wetter-Tönung: gleiche Wetter und gleiche Stufe → gleicher
 * Schlüssel; −1, wenn beide Wetter nichts backen (mild bzw. ohne Angabe).
 */
export function weatherToneKey(previous: SceneWeatherId | null, current: SceneWeatherId | null, blend: number): number {
  const cur = current ?? 'mild';
  let prev = previous ?? cur;
  let step = toneStep(blend);
  if (prev === cur || step >= WEATHER_TONE_STEPS) {
    prev = cur;
    step = WEATHER_TONE_STEPS;
  } else if (step <= 0) {
    // Ganz Vortag: gleicher Schlüssel wie ein voller Tag mit dem Vortagswetter.
    return weatherToneKey(prev, prev, 1);
  }
  if (prev === 'mild' && cur === 'mild') return -1;
  const n = SCENE_WEATHERS.length;
  return (SCENE_WEATHERS.indexOf(prev) * n + SCENE_WEATHERS.indexOf(cur)) * (WEATHER_TONE_STEPS + 1) + step;
}

/** Lichtfarben (multiply) der einzelnen Stärken – je voll ausgeprägt. */
const OVERCAST_LIGHT = [208, 214, 222] as const;
const STORM_LIGHT = [200, 204, 214] as const;
const DROUGHT_LIGHT = [255, 232, 178] as const;
const FROST_LIGHT = [230, 239, 255] as const;
const SNOW_LIGHT = [238, 243, 252] as const;
const FOG_LIGHT = [236, 238, 240] as const;

/** Lichtfarbe (multiply) des Wetters als [r, g, b] 0–255; [255, 255, 255] = keine Wirkung. */
export function weatherRgb(lv: WeatherLevels, out: number[] = [255, 255, 255]): number[] {
  for (let i = 0; i < 3; i++) {
    let v = 1;
    v *= 1 - (1 - OVERCAST_LIGHT[i]! / 255) * clamp01(lv.overcast);
    v *= 1 - (1 - STORM_LIGHT[i]! / 255) * clamp01(lv.storm);
    v *= 1 - (1 - DROUGHT_LIGHT[i]! / 255) * clamp01(lv.drought);
    v *= 1 - (1 - FROST_LIGHT[i]! / 255) * clamp01(lv.frost);
    v *= 1 - (1 - SNOW_LIGHT[i]! / 255) * clamp01(lv.snow);
    v *= 1 - (1 - FOG_LIGHT[i]! / 255) * clamp01(lv.fog);
    out[i] = Math.round(255 * v);
  }
  return out;
}

/** Scherfaktor des Winds mit Sturm: Grundwind × (1 + STORM_WIND_GAIN · Sturm) plus kurze Böen. */
export function stormSkew(base: number, time: number, storm: number): number {
  const s = clamp01(Number.isFinite(storm) ? storm : 0);
  if (s <= 0) return base;
  const t = Number.isFinite(time) ? time : 0;
  return base * (1 + STORM_WIND_GAIN * s) + s * STORM_GUST * (0.6 * Math.sin(t * 4.1) + 0.4 * Math.sin(t * 6.7 + 1.3));
}

/** Größter Betrag von `stormSkew` bei Grundwind `maxBase`. */
export function maxStormSkew(maxBase: number): number {
  return maxBase * (1 + STORM_WIND_GAIN) + STORM_GUST;
}

/** Anzahl sichtbarer Partikel: Höchstzahl × Stärke, mobil und bei „Weniger Bewegung“ je halbiert. */
export function particleCount(max: number, level: number, small: boolean, reducedMotion: boolean): number {
  const l = clamp01(Number.isFinite(level) ? level : 0);
  if (l <= 0.005) return 0;
  return Math.min(max, Math.round(max * (small ? 0.5 : 1) * (reducedMotion ? 0.5 : 1) * l));
}

/**
 * Fester Partikel-Pool: Startwerte je Partikel (Lage, Tempo, Größe, Phase) per Seed,
 * einmal angelegt. Pro Frame wird nur aus der Zeit gerechnet – keine Allokation, gleiche
 * Zeit → gleiches Bild.
 */
export class ParticlePool {
  readonly capacity: number;
  /** Lage als Anteil (x der Breite, y der Fallstrecke) 0–1. */
  readonly u: Float32Array;
  readonly v: Float32Array;
  /** Tempo 0,6–1,4, Größe 0,6–1,4, Schaukeln 0,5–1,5, Phase 0–2π, Ton 0–2. */
  readonly speed: Float32Array;
  readonly size: Float32Array;
  readonly sway: Float32Array;
  readonly phase: Float32Array;
  readonly tone: Uint8Array;

  constructor(capacity: number, seed: number) {
    const n = Math.max(0, Math.floor(capacity));
    this.capacity = n;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.size = new Float32Array(n);
    this.sway = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.tone = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const h = hash2(seed, i);
      const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
      this.u[i] = r(1);
      this.v[i] = r(2);
      this.speed[i] = 0.6 + r(3) * 0.8;
      this.size[i] = 0.6 + r(4) * 0.8;
      this.sway[i] = 0.5 + r(5);
      this.phase[i] = r(6) * Math.PI * 2;
      this.tone[i] = Math.floor(r(7) * 3);
    }
  }
}

/** Nachkommaanteil 0 ≤ v < 1 (auch negativ). */
function frac(v: number): number {
  return v - Math.floor(v);
}

/** Fallanteil 0–1 eines Partikels zur Zeit `t` (Tempo in Fallstrecken je Sekunde). */
export function fallProgress(v: number, t: number, rate: number): number {
  return frac(v + t * rate);
}

/** Maße und Abbildung eines Frames (wie SeasonFrame). */
export interface WeatherFrame {
  width: number;
  height: number;
  groundY: number;
  /** Höchster Punkt der Bäume. */
  top: number;
  dpr: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  time: number;
  reducedMotion: boolean;
  /** Nacht 0–1 (daylight.ts): Regen kaum sichtbar, Nebel gedämpft, Schnee bleibt hell. */
  night: number;
  /** Krone des Hauptbaums (Mitte x, y, Radien in CSS-Pixeln) für das Glitzern, oder null. */
  crown: readonly [number, number, number, number] | null;
}

/** Auflösung der Partikel-Sprites (Gerätepixel) – einmal gezeichnet, beim Zeichnen skaliert. */
const FLAKE_PX = 24;
const LEAF_PX = 40;
const GLINT_PX = 32;
/** Nebelbänder in niedriger Auflösung (Nebel ist weich): Pixel je CSS-Pixel. */
const FOG_RES = 0.5;
/** Blatttöne der Sturmböen: frisches Grün, Olivgrün, Braun. */
const GUST_TONES = ['#6f9a45', '#8f8a3c', '#9a6a3a'] as const;

/**
 * Wetter einer Szene: Überblendung, Tönungsstufe, Partikel-Pools und Sprites.
 * `update` einmal je Frame; `levels` sind die stufenlosen Stärken dieses Frames, `baked`
 * die auf die Tönungsstufe gerundeten (für die gebackenen Kopien).
 */
export class WeatherLayer {
  readonly levels: WeatherLevels = { ...NONE };
  readonly baked: WeatherLevels = { ...NONE };
  /** Schlüssel der gebackenen Tönung (−1 = keine). */
  toneKey = -1;
  /** Lichtfarbe der gebackenen Stärken. */
  readonly toneRgb: number[] = [255, 255, 255];
  private extraCloud = 0;
  private lastTime = Number.NaN;
  private rain = new ParticlePool(MAX_RAIN, 7001);
  private snow = new ParticlePool(MAX_SNOW, 7002);
  private gust = new ParticlePool(MAX_GUST_LEAVES, 7003);
  private glints = new ParticlePool(MAX_GLINTS, 7004);
  private flake: HTMLCanvasElement | null = null;
  private leaves: HTMLCanvasElement[] | null = null;
  private glint: HTMLCanvasElement | null = null;
  private fog: HTMLCanvasElement[] = [];
  private fogKey = '';
  private fogW = 0;
  private fogH = 0;

  /**
   * Führt das Wetter dieses Frames nach; gibt die Stärken zurück oder null, wenn nichts zu
   * zeichnen ist (ohne Angabe, mild).
   */
  update(current: unknown, previous: unknown, blend: number | undefined, time: number, reducedMotion: boolean): WeatherLevels | null {
    const cur = normalizeWeather(current);
    if (cur === null) {
      this.reset(time);
      return null;
    }
    const prev = normalizeWeather(previous) ?? cur;
    const b = normalizeBlend(blend, reducedMotion);
    mixWeather(prev, cur, b, this.levels);
    const step = toneStep(b);
    mixWeather(prev, cur, step / WEATHER_TONE_STEPS, this.baked);
    const key = weatherToneKey(prev, cur, b);
    if (key !== this.toneKey) {
      weatherRgb(this.baked, this.toneRgb);
      this.toneKey = key;
    }
    // Wolken ziehen bei Sturm schneller: Vorsprung stetig aufsummiert (kein Sprung).
    const dt = time - this.lastTime;
    if (Number.isFinite(dt) && dt > 0 && dt < 0.5) this.extraCloud += dt * STORM_CLOUD_SPEED * this.levels.storm;
    this.lastTime = time;
    return isClearWeather(this.levels) && key < 0 ? null : this.levels;
  }

  private reset(time: number): void {
    for (const k of KEYS) {
      this.levels[k] = 0;
      this.baked[k] = 0;
    }
    this.toneKey = -1;
    this.lastTime = time;
  }

  /** Zeit für die ziehenden Wolken (bei Sturm voraus). */
  cloudTime(time: number): number {
    return time + this.extraCloud;
  }

  /**
   * Nebelbänder über den Bäumen, aber hinter den Tieren (die bleiben gut erkennbar).
   */
  drawGround(ctx: CanvasRenderingContext2D, lv: WeatherLevels, f: WeatherFrame): void {
    if (lv.fog > 0.01) this.drawFog(ctx, lv.fog, f, f.reducedMotion ? 0 : f.time);
    ctx.globalAlpha = 1;
  }

  /**
   * Über Tieren und Bäumen: Raureif-Glitzern, Sturmblätter, Schnee und Regen. Nur
   * drawImage und ein Pfad für den Regen.
   */
  draw(ctx: CanvasRenderingContext2D, lv: WeatherLevels, f: WeatherFrame): void {
    const small = f.width < SMALL_SCENE_WIDTH;
    const t = f.reducedMotion ? 0 : f.time;
    if (lv.frost > 0.01) this.drawGlints(ctx, lv.frost, f, small);
    if (lv.storm > 0.01) this.drawGust(ctx, lv.storm, f, t, small);
    if (lv.snow > 0.01) this.drawSnow(ctx, lv.snow, f, t, small);
    if (lv.rain > 0.01) this.drawRain(ctx, lv.rain, f, t, small);
    ctx.globalAlpha = 1;
  }

  /** Schräge Regenstriche als ein Pfad (ein stroke je Frame). */
  private drawRain(ctx: CanvasRenderingContext2D, rain: number, f: WeatherFrame, t: number, small: boolean): void {
    const n = particleCount(MAX_RAIN, rain, small, f.reducedMotion);
    if (n <= 0) return;
    const p = this.rain;
    const k = f.dpr;
    const fall = f.groundY;
    const len = Math.max(6, Math.min(26, fall * 0.04));
    const slant = len * 0.28;
    ctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.tx, f.ty);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = fallProgress(p.v[i]!, t, 0.95 * p.speed[i]!) * (fall + len) - len;
      const x = p.u[i]! * (f.width + slant * 4) - slant * 2 - slant * (y / len) * 0.2;
      const l = len * (0.7 + 0.5 * p.size[i]!);
      ctx.moveTo(x, y);
      ctx.lineTo(x - slant * (l / len), y + l);
    }
    // Nachts kaum sichtbar.
    ctx.globalAlpha = 0.5 * clamp01(rain) * (1 - 0.65 * clamp01(f.night));
    ctx.strokeStyle = 'rgb(206, 218, 234)';
    ctx.lineWidth = Math.max(1 / (k * f.sx), 1.1);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /** Fallende Flocken (wie Schneefall im Winter, dichter); nachts hell. */
  private drawSnow(ctx: CanvasRenderingContext2D, snow: number, f: WeatherFrame, t: number, small: boolean): void {
    const n = particleCount(MAX_SNOW, snow, small, f.reducedMotion);
    if (n <= 0) return;
    const p = this.snow;
    const k = f.dpr;
    const base = Math.max(3, Math.min(f.width, f.groundY) * 0.011);
    const sprite = this.flakeSprite();
    ctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.tx, f.ty);
    const top = -base;
    const span = f.groundY + base * 2;
    for (let i = 0; i < n; i++) {
      const fallen = fallProgress(p.v[i]!, t, 0.07 * p.speed[i]!);
      const x = (p.u[i]! + 0.014 * Math.sin(t * 0.8 * p.sway[i]! + p.phase[i]!)) * f.width;
      const y = top + span * fallen;
      const size = base * p.size[i]!;
      ctx.globalAlpha = 0.9 * clamp01(snow) * clamp01((1 - fallen) * 12);
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }
  }

  /** Vom Sturm verwehte Blätter: schnell waagerecht, taumelnd. */
  private drawGust(ctx: CanvasRenderingContext2D, storm: number, f: WeatherFrame, t: number, small: boolean): void {
    const n = particleCount(MAX_GUST_LEAVES, storm, small, f.reducedMotion);
    if (n <= 0) return;
    const p = this.gust;
    const k = f.dpr;
    const span = Math.max(1, f.groundY - f.top * 0.5);
    const base = Math.max(4, Math.min(f.width, span) * 0.014);
    const sprites = this.leafSprites();
    for (let i = 0; i < n; i++) {
      const run = fallProgress(p.u[i]!, t, (0.18 * p.speed[i]! * 600) / Math.max(300, f.width));
      const x = run * f.width * 1.2 - f.width * 0.1;
      const y = f.top * 0.5 + span * (0.1 + 0.8 * p.v[i]!) + span * 0.05 * Math.sin(t * 2.2 * p.sway[i]! + p.phase[i]!);
      const rot = f.reducedMotion ? p.phase[i]! : t * 5 * p.sway[i]! + p.phase[i]!;
      const size = base * p.size[i]!;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      ctx.globalAlpha = 0.9 * clamp01(storm) * clamp01(Math.min(run, 1 - run) * 12);
      ctx.setTransform(f.sx * k * c, f.sy * k * s, -f.sx * k * s, f.sy * k * c, f.sx * k * x + f.tx, f.sy * k * y + f.ty);
      ctx.drawImage(sprites[p.tone[i]! % 3]!, -size / 2, -size / 4, size, size / 2);
    }
  }

  /** Raureif: wenige Funken in der Krone und am Boden, die leise aufglitzern. */
  private drawGlints(ctx: CanvasRenderingContext2D, frost: number, f: WeatherFrame, small: boolean): void {
    const n = Math.min(MAX_GLINTS, Math.round(MAX_GLINTS * (small ? 0.6 : 1)));
    const p = this.glints;
    const k = f.dpr;
    const sprite = this.glintSprite();
    const base = Math.max(4, Math.min(f.width, f.groundY) * 0.012);
    ctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.tx, f.ty);
    const cr = f.crown;
    for (let i = 0; i < n; i++) {
      let x: number;
      let y: number;
      if (cr && i % 2 === 0) {
        const a = p.u[i]! * Math.PI * 2;
        const r = 0.35 + 0.6 * p.v[i]!;
        x = cr[0] + Math.cos(a) * cr[2] * r;
        y = cr[1] + Math.sin(a) * cr[3] * r;
      } else {
        x = p.u[i]! * f.width;
        y = f.groundY - 2 - p.v[i]! * f.height * 0.02;
      }
      // Kurzes Aufglitzern (bei weniger Bewegung ruhig und schwach).
      const tw = f.reducedMotion ? 0.35 : Math.max(0, Math.sin(f.time * 0.9 * p.speed[i]! + p.phase[i]!)) ** 8;
      if (tw < 0.02) continue;
      const size = base * (0.8 + 0.6 * p.size[i]!);
      ctx.globalAlpha = clamp01(frost) * tw * (1 - 0.3 * clamp01(f.night));
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }
  }

  /** Drei vorgefertigte Nebelbänder in Bodennähe, die langsam ziehen. */
  private drawFog(ctx: CanvasRenderingContext2D, fog: number, f: WeatherFrame, t: number): void {
    const bands = this.fogBands(f.width, f.groundY);
    const k = f.dpr;
    ctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.tx, f.ty);
    const w = this.fogW;
    const h = this.fogH;
    for (let i = 0; i < bands.length; i++) {
      const speed = (4 + 3 * i) * (i % 2 === 0 ? 1 : -1);
      const x = -frac((i * 0.37 * w + t * speed) / w) * w;
      // Bänder liegen über der Bodenlinie (der Erdschnitt bleibt klar).
      const y = f.groundY - h * (i === 0 ? 0.78 : i === 1 ? 1.25 : 0.62);
      ctx.globalAlpha = clamp01(fog) * (i === 1 ? 0.6 : 0.85) * (1 - 0.5 * clamp01(f.night));
      ctx.drawImage(bands[i]!, x, y, w, h);
      ctx.drawImage(bands[i]!, x + w, y, w, h);
    }
  }

  private fogBands(width: number, groundY: number): HTMLCanvasElement[] {
    const key = `${Math.round(width)}x${Math.round(groundY)}`;
    if (this.fogKey === key && this.fog.length === 3) return this.fog;
    this.fogKey = key;
    this.fogW = Math.max(200, width);
    this.fogH = Math.max(24, groundY * 0.2);
    for (let i = 0; i < 3; i++) this.fog[i] = paintFogBand(this.fog[i] ?? null, this.fogW, this.fogH, 811 + i);
    return this.fog;
  }

  private flakeSprite(): HTMLCanvasElement {
    if (!this.flake) {
      const c = document.createElement('canvas');
      c.width = FLAKE_PX;
      c.height = FLAKE_PX;
      const g = c.getContext('2d')!;
      const r = FLAKE_PX / 2;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.45, 'rgba(250, 252, 255, 0.85)');
      grad.addColorStop(1, 'rgba(245, 250, 255, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, FLAKE_PX, FLAKE_PX);
      this.flake = c;
    }
    return this.flake;
  }

  private leafSprites(): HTMLCanvasElement[] {
    if (!this.leaves) {
      this.leaves = GUST_TONES.map((tone) => {
        const c = document.createElement('canvas');
        c.width = LEAF_PX;
        c.height = LEAF_PX / 2;
        const g = c.getContext('2d')!;
        const r = LEAF_PX / 2;
        g.translate(r, r / 2);
        g.fillStyle = tone;
        g.beginPath();
        g.ellipse(0, 0, r * 0.92, r * 0.42, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(60, 45, 25, 0.5)';
        g.lineWidth = LEAF_PX * 0.05;
        g.beginPath();
        g.moveTo(-r * 0.85, 0);
        g.lineTo(r * 0.85, 0);
        g.stroke();
        return c;
      });
    }
    return this.leaves;
  }

  private glintSprite(): HTMLCanvasElement {
    if (!this.glint) {
      const c = document.createElement('canvas');
      c.width = GLINT_PX;
      c.height = GLINT_PX;
      const g = c.getContext('2d')!;
      const r = GLINT_PX / 2;
      const halo = g.createRadialGradient(r, r, 0, r, r, r * 0.5);
      halo.addColorStop(0, 'rgba(240, 248, 255, 0.7)');
      halo.addColorStop(1, 'rgba(240, 248, 255, 0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, GLINT_PX, GLINT_PX);
      g.fillStyle = '#f6fbff';
      g.beginPath();
      g.moveTo(r, 0);
      g.quadraticCurveTo(r + 1.5, r - 1.5, GLINT_PX, r);
      g.quadraticCurveTo(r + 1.5, r + 1.5, r, GLINT_PX);
      g.quadraticCurveTo(r - 1.5, r + 1.5, 0, r);
      g.quadraticCurveTo(r - 1.5, r - 1.5, r, 0);
      g.fill();
      this.glint = c;
    }
    return this.glint;
  }
}

/** Ein Nebelband: weiche, überlappende Schwaden (Seed), oben und unten auslaufend. */
function paintFogBand(old: HTMLCanvasElement | null, w: number, h: number, seed: number): HTMLCanvasElement {
  const c = old ?? document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * FOG_RES));
  c.height = Math.max(1, Math.ceil(h * FOG_RES));
  const g = c.getContext('2d')!;
  g.setTransform(FOG_RES, 0, 0, FOG_RES, 0, 0);
  g.clearRect(0, 0, w, h);
  const puffs = 9;
  for (let i = 0; i < puffs; i++) {
    const hh = hash2(seed, i);
    const r = (k: number) => (hash2(hh, k) & 0xffff) / 0x10000;
    // Gleichmäßig über die Breite (nahtlos: die Ränder bekommen je eine halbe Schwade).
    const cx = ((i + 0.5 * r(1)) / puffs) * w;
    const cy = h * (0.45 + 0.15 * (r(2) - 0.5));
    const rx = w * (0.1 + 0.06 * r(3));
    const ry = h * (0.32 + 0.12 * r(4));
    for (const dx of [-w, 0, w]) {
      const x = cx + dx;
      if (x + rx < 0 || x - rx > w) continue;
      g.save();
      g.translate(x, cy);
      g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, 'rgba(234, 238, 240, 0.55)');
      grad.addColorStop(0.6, 'rgba(230, 235, 238, 0.28)');
      grad.addColorStop(1, 'rgba(228, 233, 236, 0)');
      g.fillStyle = grad;
      g.fillRect(-ry, -ry, ry * 2, ry * 2);
      g.restore();
    }
  }
  // Durchgehender, sehr leichter Schleier, damit zwischen den Schwaden kein Loch bleibt.
  const veil = g.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(232, 236, 238, 0)');
  veil.addColorStop(0.5, 'rgba(232, 236, 238, 0.22)');
  veil.addColorStop(1, 'rgba(232, 236, 238, 0)');
  g.fillStyle = veil;
  g.fillRect(0, 0, w, h);
  return c;
}

/**
 * Gebackener Himmel und Boden des Wetters in die getönte Kulisse (Kontext in CSS-Pixeln
 * der Szene, vor der Lichtfarbe): Wolkendecke, Nebeldunst, Hitzedunst, Sonnenstrahlen,
 * strohiges bzw. bereiftes Gras, nasser Boden, Neuschnee. `night` dämpft die Wolkendecke.
 */
export function paintWeatherSky(c: CanvasRenderingContext2D, lv: WeatherLevels, w: number, h: number, groundY: number, night: number): void {
  const n = clamp01(night);
  if (lv.overcast > 0.005) {
    const g = c.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, 'rgba(132, 142, 156, 0.85)');
    g.addColorStop(0.6, 'rgba(160, 168, 178, 0.7)');
    g.addColorStop(1, 'rgba(184, 190, 196, 0.5)');
    c.globalAlpha = clamp01(lv.overcast) * (1 - 0.5 * n);
    c.fillStyle = g;
    c.fillRect(0, 0, w, groundY + 1);
  }
  if (lv.fog > 0.005) {
    // Blasser Hintergrund: Dunst zum Horizont dichter, Hügel verschwimmen.
    const g = c.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, 'rgba(222, 228, 230, 0.3)');
    g.addColorStop(0.7, 'rgba(226, 230, 232, 0.6)');
    g.addColorStop(1, 'rgba(230, 234, 236, 0.78)');
    c.globalAlpha = clamp01(lv.fog);
    c.fillStyle = g;
    c.fillRect(0, 0, w, groundY + 1);
  }
  if (lv.drought > 0.005) {
    const g = c.createLinearGradient(0, groundY * 0.3, 0, groundY);
    g.addColorStop(0, 'rgba(242, 214, 150, 0)');
    g.addColorStop(1, 'rgba(242, 210, 140, 0.45)');
    c.globalAlpha = clamp01(lv.drought);
    c.fillStyle = g;
    c.fillRect(0, groundY * 0.3, w, groundY * 0.7 + 1);
  }
  if (lv.sun > 0.005) paintSunRays(c, lv.sun * (1 - n), w, groundY);
  // Grasnarbe: strohig (Dürre) bzw. Raureif (Frost).
  // Höhe wie die Grasnarbe in tree.ts (`paintStatic`): Halme bis 1,2 × bladeH.
  const band = Math.max(4, h * 0.016) * 1.2 + 2;
  if (lv.drought > 0.005) {
    c.globalAlpha = clamp01(lv.drought) * 0.55;
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = 'rgb(236, 210, 138)';
    c.fillRect(0, groundY - band, w, band + 3);
    c.globalCompositeOperation = 'source-over';
  }
  if (lv.frost > 0.005) {
    const g = c.createLinearGradient(0, groundY - band, 0, groundY + 3);
    g.addColorStop(0, 'rgba(238, 245, 252, 0)');
    g.addColorStop(0.6, 'rgba(238, 245, 252, 0.4)');
    g.addColorStop(1, 'rgba(244, 248, 252, 0.6)');
    c.globalAlpha = clamp01(lv.frost);
    c.fillStyle = g;
    c.fillRect(0, groundY - band, w, band + 3);
  }
  if (lv.rain > 0.005) {
    // Feucht glänzender Boden: heller Schimmer unter der Grasnarbe.
    const soil = h - groundY;
    const g = c.createLinearGradient(0, groundY, 0, groundY + soil * 0.16);
    g.addColorStop(0, 'rgba(196, 210, 228, 0.32)');
    g.addColorStop(1, 'rgba(196, 210, 228, 0)');
    c.globalAlpha = clamp01(lv.rain);
    c.fillStyle = g;
    c.fillRect(0, groundY, w, soil * 0.16);
  }
  c.globalAlpha = 1;
  if (lv.snow > 0.005) paintSnowCover(c, w, h, groundY, clamp01(lv.snow) * 0.9);
}

/** Kräftiger Sonnenschein: heller Hof um die Sonne (wie in paintSky) und weiche Strahlen. */
function paintSunRays(c: CanvasRenderingContext2D, sun: number, w: number, groundY: number): void {
  if (sun <= 0.005) return;
  c.save();
  // Nur über dem Boden (der Erdschnitt bleibt unberührt).
  c.beginPath();
  c.rect(0, 0, w, groundY + 1);
  c.clip();
  const sx = w * 0.84;
  const sy = groundY * 0.16;
  const r = Math.max(w, groundY) * 0.5;
  const glow = c.createRadialGradient(sx, sy, 0, sx, sy, r);
  glow.addColorStop(0, 'rgba(255, 250, 222, 0.7)');
  glow.addColorStop(0.2, 'rgba(255, 246, 210, 0.3)');
  glow.addColorStop(1, 'rgba(255, 246, 210, 0)');
  c.globalAlpha = clamp01(sun);
  c.fillStyle = glow;
  c.fillRect(0, 0, w, groundY + 1);
  // Strahlen: schmale Keile von der Sonne nach links unten.
  c.fillStyle = 'rgba(255, 248, 220, 0.12)';
  c.beginPath();
  const len = Math.hypot(w, groundY) * 1.1;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (0.58 + i * 0.075) + ((hash2(53, i) & 255) / 255 - 0.5) * 0.05;
    const spread = 0.018 + ((hash2(59, i) & 255) / 255) * 0.02;
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(a - spread) * len, sy + Math.sin(a - spread) * len);
    c.lineTo(sx + Math.cos(a + spread) * len, sy + Math.sin(a + spread) * len);
    c.closePath();
  }
  c.fill();
  c.restore();
  c.globalAlpha = 1;
}

/** Wiederverwendetes Hilfs-Canvas für den Raureif (nur beim Tönen gebraucht). */
let rimeScratch: HTMLCanvasElement | null = null;

/**
 * Raureif bzw. Schneehäubchen: heller Saum an den Oberkanten aller Formen eines Canvas
 * (Pixel mit Inhalt, über denen `offset` Pixel weiter oben nichts ist). Nur beim Tönen –
 * nie pro Frame.
 */
export function rimeInPlace(canvas: HTMLCanvasElement, color: string, alpha: number, offset: number): void {
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0 || !(alpha > 0.005)) return;
  const s = rimeScratch ?? document.createElement('canvas');
  rimeScratch = s;
  if (s.width < w || s.height < h) {
    s.width = Math.max(s.width, w);
    s.height = Math.max(s.height, h);
  }
  const g = s.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'copy';
  g.drawImage(canvas, 0, 0);
  // Form in der Farbe des Reifs …
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  // … ohne alles, was unter einer anderen Stelle der Form liegt: Es bleiben die Oberkanten.
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(canvas, 0, Math.max(1, Math.round(offset)));
  g.globalCompositeOperation = 'source-over';
  const c = canvas.getContext('2d')!;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = clamp01(alpha);
  c.drawImage(s, 0, 0, w, h, 0, 0, w, h);
  c.restore();
}

/** Gibt das Hilfs-Canvas des Raureifs frei (nach dem Tönen; Safari: Größe 0). */
export function releaseRimeScratch(): void {
  if (!rimeScratch) return;
  rimeScratch.width = 0;
  rimeScratch.height = 0;
  rimeScratch = null;
}
