/**
 * Aussaat-Animation (DESIGN_V2.md 27.12, Phase 10 1b): Beim Setzen aus einer Aussaat
 * fliegen ein paar Samen – Ahornflügel und Pusteblumen-Schirmchen – vom Bildrand in den
 * Pflanzring, landen am Platz der neuen Pflanze und sinken in den Boden; ein sanfter
 * Lichtschein markiert den Platz. Erst danach erscheint die Pflanze
 * (`sowingPlantVisible`).
 *
 * Bei „Weniger Bewegung“ fliegt nichts: Die Pflanze erscheint sofort wie bisher.
 *
 * Das Bild hängt nur von der Eingabe ab (Startzeit, `time`, Ziel, Seed): gleiche Eingabe →
 * gleiches Bild, kein Math.random(). Teuer ist nur das Vorbereiten – die Bahnen werden
 * einmal je Aussaat berechnet (bzw. bei neuer Canvas-Größe), die Samen-Sprites einmal je
 * Größe und Auflösung gezeichnet. Pro Frame: wenige drawImage mit Transformation, keine
 * Allokation.
 *
 * Im Spiel (Phase 10, 4d) über `SceneInput.sowing` eingehängt: main.ts merkt den Platz
 * (`sowingSlot`) nach `chooseSowing` in einem `SowingCue` und startet, sobald die Szene zu
 * sehen ist; drawScene versteckt die Pflanze bis zur Landung
 * und zeichnet die Samen über der Szene. In der Render-Demo: `demo.html?demo=sowing`.
 */

import { ell, line, TAU } from './sprite-kit';
import { clamp01, hash2, lerp, mulberry32, smooth01 } from './util';

/** Anzahl der Samen je Aussaat. */
export const SOWING_SEEDS = 5;
/** Ab hier (s nach dem Start) sind alle Samen gelandet – die Pflanze erscheint. */
export const SOWING_LAND_SECONDS = 2.2;
/** Nach der Landung sinken die Samen noch so lange (s) in den Boden. */
export const SOWING_SETTLE_SECONDS = 0.5;
/** Gesamtdauer der Animation (s). */
export const SOWING_SECONDS = SOWING_LAND_SECONDS + SOWING_SETTLE_SECONDS;
/** So weit (s) darf der Start in der Zukunft liegen – er gilt dann als „jetzt“. */
export const SOWING_LEAD = 1;

/** Art eines Samens: 0 Ahornflügel, 1 Pusteblumen-Schirmchen. */
export type SeedKind = 0 | 1;
export const SEED_MAPLE: SeedKind = 0;
export const SEED_DANDELION: SeedKind = 1;
/** Feste Reihenfolge der Arten (gleich viele Ahornflügel wie Schirmchen, ±1). */
const KINDS: readonly SeedKind[] = [SEED_MAPLE, SEED_DANDELION, SEED_MAPLE, SEED_DANDELION, SEED_MAPLE];

/**
 * Zeit seit dem Start (s) oder NaN außerhalb des Zeitfensters (zu früh, vorbei, ungültig)
 * und immer NaN bei reduzierter Bewegung.
 */
export function sowingElapsed(time: number, startedAt: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(time) || !Number.isFinite(startedAt)) return Number.NaN;
  const d = time - startedAt;
  if (d < -SOWING_LEAD || d >= SOWING_SECONDS) return Number.NaN;
  return Math.max(0, d);
}

/**
 * Ist die neue Pflanze schon zu sehen? Nur während des Flugs (vor der Landung) nicht –
 * vorher, danach und bei reduzierter Bewegung immer.
 */
export function sowingPlantVisible(time: number, startedAt: number, reducedMotion: boolean): boolean {
  const u = sowingElapsed(time, startedAt, reducedMotion);
  return !(u < SOWING_LAND_SECONDS);
}

/**
 * Platz (Index im Pflanzring, = `ScenePlant.slot`) der Pflanze, die eine Aussaat gerade
 * gesetzt hat: der erste Platz, an dem nach dem Setzen `planted` steht und vorher etwas
 * anderes (frei oder ersetzt). -1, wenn nichts gesetzt wurde (kein `planted`, unverändert).
 */
export function sowingSlot(before: readonly string[], after: readonly string[], planted: string | undefined): number {
  if (!planted) return -1;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === planted && before[i] !== planted) return i;
  }
  return -1;
}

/** So lange (s) wartet eine gesetzte Aussaat darauf, dass die Szene zu sehen ist. */
export const SOWING_CUE_WAIT = 8;

/**
 * Auslöser für `SceneInput.sowing`: merkt sich nach dem Setzen aus einer Aussaat den Platz
 * und gibt die Aussaat erst heraus, wenn die Szene zu sehen ist (mobil liegt nach dem Setzen
 * oft eine Seite darüber) – spätestens SOWING_CUE_WAIT s nach dem Setzen, sonst verfällt sie
 * und die Pflanze steht einfach da. Allokation nur beim Herausgeben.
 */
export class SowingCue {
  private slot = -1;
  private at = Number.NaN;

  /** Wartet eine Aussaat? */
  get pending(): boolean {
    return this.slot >= 0;
  }

  /** Nach dem Setzen: Platz (`sowingSlot`, −1 = nichts gesetzt) und Zeit (s, Takt wie `time`). */
  plant(slot: number, time: number): void {
    if (Number.isFinite(slot) && slot >= 0 && Number.isFinite(time)) {
      this.slot = Math.floor(slot);
      this.at = time;
    }
  }

  /** Je Frame: die Aussaat für die Szene, sobald sie zu sehen ist (einmal), sonst undefined. */
  take(time: number, visible: boolean): { startedAt: number; slot: number } | undefined {
    if (this.slot < 0) return undefined;
    if (!(time - this.at <= SOWING_CUE_WAIT)) {
      this.clear();
      return undefined;
    }
    if (!visible) return undefined;
    const sowing = { startedAt: time, slot: this.slot };
    this.clear();
    return sowing;
  }

  /** Verwerfen (Neuer Zyklus, anderer Spielstand). */
  clear(): void {
    this.slot = -1;
    this.at = Number.NaN;
  }
}

/** Bahn eines Samens: kubische Bézierkurve vom Rand zum Ziel plus Pendeln quer dazu. */
export interface SeedPath {
  kind: SeedKind;
  /** Start (s nach Beginn) und Flugdauer (s); Landung = delay + flight ≤ SOWING_LAND_SECONDS. */
  delay: number;
  flight: number;
  /** Kontrollpunkte in CSS-Pixeln der Szene. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  /** Pendeln: Weite (px), Anzahl der Schwünge, Phase. */
  sway: number;
  swings: number;
  phase: number;
  /** Ahorn: Drehzahl (rad/s); Schirmchen: Schaukeln (rad/s). */
  spin: number;
  /** Größe relativ zur Grundgröße. */
  size: number;
}

/** Ziel und Bühne einer Aussaat (CSS-Pixel der Szene). */
export interface SowingStage {
  width: number;
  groundY: number;
  /** Fuß der neuen Pflanze. */
  targetX: number;
  targetY: number;
  /** Grundgröße der Samen (≈ Tiergröße, `animalSize`). */
  unit: number;
  /** Seed der Aussaat (z. B. Platz im Pflanzring) – gleiche Zahl, gleiche Bahnen. */
  seed: number;
}

function emptyPath(): SeedPath {
  return { kind: 0, delay: 0, flight: 1, x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0, sway: 0, swings: 1, phase: 0, spin: 0, size: 1 };
}

/**
 * Berechnet die Bahnen aller Samen (schreibt in `out`, legt fehlende Einträge an).
 * Alle Samen kommen vom näheren Rand – wie mit einem Windstoß –, steigen erst etwas auf
 * und sinken dann in einem Bogen auf den Platz; die Landepunkte liegen eng um das Ziel.
 */
export function sowingPaths(stage: SowingStage, out: SeedPath[] = []): SeedPath[] {
  const { width, groundY, unit } = stage;
  const tx = Number.isFinite(stage.targetX) ? stage.targetX : width / 2;
  const ty = Number.isFinite(stage.targetY) ? stage.targetY : groundY;
  // Vom näheren Rand her (bei der Mitte: von rechts, wie der Häher).
  const dir = tx < width / 2 ? -1 : 1;
  const edgeX = dir < 0 ? -unit * 1.5 : width + unit * 1.5;
  const rand = mulberry32(hash2(stage.seed | 0, 0x5eed));
  out.length = SOWING_SEEDS;
  for (let i = 0; i < SOWING_SEEDS; i++) {
    const p = (out[i] ??= emptyPath());
    const kind = KINDS[i % KINDS.length]!;
    p.kind = kind;
    // Schirmchen schweben langsamer als die Ahornflügel.
    p.delay = i * 0.11 + rand() * 0.07;
    const want = kind === SEED_MAPLE ? 1.45 + rand() * 0.2 : 1.6 + rand() * 0.2;
    p.flight = Math.min(want, SOWING_LAND_SECONDS - p.delay);
    p.x0 = edgeX + dir * rand() * unit;
    p.y0 = groundY * (0.12 + 0.34 * rand());
    // Erst ein Stück hinein und leicht hinauf, dann im Bogen über dem Ziel hinab.
    p.x1 = lerp(p.x0, tx, 0.42 + 0.12 * rand());
    p.y1 = p.y0 - groundY * (0.04 + 0.08 * rand());
    const spread = (rand() - 0.5) * unit * 1.6;
    p.size = kind === SEED_MAPLE ? 1.0 + 0.25 * rand() : 0.95 + 0.25 * rand();
    p.x3 = tx + spread;
    // Ahorn: Nuss am Boden; Schirmchen: der Same darunter berührt den Boden.
    p.y3 = ty - unit * (kind === SEED_MAPLE ? 0.06 : 0.46 * p.size) - unit * 0.05 * rand();
    p.x2 = p.x3 + dir * unit * (0.6 + 1.2 * rand());
    p.y2 = ty - groundY * (0.2 + 0.12 * rand());
    p.sway = unit * (kind === SEED_MAPLE ? 0.35 : 0.7) * (0.7 + 0.6 * rand());
    p.swings = kind === SEED_MAPLE ? 2 + rand() : 1.2 + rand() * 0.8;
    p.phase = rand() * TAU;
    p.spin = kind === SEED_MAPLE ? (13 + 5 * rand()) * (rand() < 0.5 ? -1 : 1) : 1.8 + rand();
  }
  return out;
}

/** Lage eines Samens in einem Frame. */
export interface SeedPose {
  x: number;
  y: number;
  /** Drehung (rad). */
  rot: number;
  /** Stauchung quer (Ahorn: Drehung um die Längsachse), 0–1. */
  squash: number;
  /** Größe (×Grundgröße × size). */
  scale: number;
  alpha: number;
}

/** Fortschritt entlang der Bahn: zügig hinein, sanft gebremst auf den Platz. */
export function pathProgress(t: number): number {
  const c = clamp01(t);
  return 0.35 * c + 0.65 * (1 - (1 - c) * (1 - c));
}

/**
 * Lage des Samens `p` zum Zeitpunkt `u` (s seit Beginn). Schreibt in `out` (keine
 * Allokation). Vor dem eigenen Start: unsichtbar; nach der Landung liegt er am Ziel und
 * sinkt (kleiner, blasser) in den Boden.
 */
export function seedPose(p: SeedPath, u: number, out: SeedPose): SeedPose {
  const tau = (Number.isFinite(u) ? u : 0) - p.delay;
  if (tau < 0) {
    out.x = p.x0;
    out.y = p.y0;
    out.rot = 0;
    out.squash = 1;
    out.scale = p.size;
    out.alpha = 0;
    return out;
  }
  const t = Math.min(1, tau / p.flight);
  const s = pathProgress(t);
  const m = 1 - s;
  const b0 = m * m * m;
  const b1 = 3 * m * m * s;
  const b2 = 3 * m * s * s;
  const b3 = s * s * s;
  // Pendeln quer zur Bahn – an Start und Ziel null, so landet der Samen genau.
  const swing = Math.sin(p.phase + s * p.swings * TAU) * p.sway * 4 * s * (1 - s);
  out.x = b0 * p.x0 + b1 * p.x1 + b2 * p.x2 + b3 * p.x3 + swing;
  out.y = b0 * p.y0 + b1 * p.y1 + b2 * p.y2 + b3 * p.y3 + Math.abs(swing) * 0.25;
  const landed = Math.max(0, tau - p.flight);
  // Absinken nach der Landung (kleiner und blasser), Einblenden am Anfang.
  const sink = smooth01(landed / SOWING_SETTLE_SECONDS);
  out.alpha = smooth01(tau / 0.2) * (1 - sink);
  out.scale = p.size * (1 - 0.45 * sink);
  // Gebremste Drehung: Winkel ∝ zurückgelegter Weg, nach der Landung steht er still.
  const travelled = s * p.flight;
  if (p.kind === SEED_MAPLE) {
    const a = p.spin * travelled;
    // Drehung um die eigene Achse als Stauchung, leicht geneigt; gelandet liegt er flach.
    out.squash = lerp(0.4 + 0.6 * Math.abs(Math.cos(a)), 1, smooth01(landed / 0.15));
    out.rot = lerp(0.2 + 0.45 * Math.sin(a * 0.13 + p.phase), -0.15, smooth01(landed / 0.15));
  } else {
    out.squash = 1;
    out.rot = Math.sin(p.phase + p.spin * travelled) * 0.3 * (1 - s * 0.7);
  }
  return out;
}

/** Lichtschein am Platz: 0–1, am stärksten kurz nach der Landung, am Ende aus. */
export function sowingGlow(u: number): number {
  if (!Number.isFinite(u) || u < 0) return 0;
  const rise = smooth01((u - (SOWING_LAND_SECONDS - 0.7)) / 0.7);
  const fall = 1 - smooth01((u - SOWING_LAND_SECONDS) / SOWING_SETTLE_SECONDS);
  return rise * fall;
}

// ---------------------------------------------------------------------------
// Zeichnung
// ---------------------------------------------------------------------------

const NUT = '#8a6236';
const NUT_DARK = '#5e4126';
const WING = '#d2b47a';
const WING_EDGE = '#b98a55';
const VEIN = 'rgba(110, 78, 44, 0.55)';
const PAPPUS = '#fbf8ef';
const PAPPUS_SHADOW = 'rgba(80, 72, 56, 0.28)';
const ACHENE = '#7a5a34';

/** Ahornflügel (Flügelnuss), Drehpunkt = Nuss; Flügel nach rechts. */
export function paintMapleSeed(c: CanvasRenderingContext2D): void {
  // Samara: am Nuss schmal, zur Spitze breit und rund; oben eine kräftige, fast gerade Kante.
  const wing = () => {
    c.moveTo(0.04, -0.07);
    c.bezierCurveTo(0.3, -0.13, 0.6, -0.17, 0.8, -0.13);
    c.bezierCurveTo(0.93, -0.1, 0.93, 0.08, 0.8, 0.13);
    c.bezierCurveTo(0.62, 0.18, 0.42, 0.12, 0.26, 0.04);
    c.quadraticCurveTo(0.14, 0.0, 0.04, 0.06);
    c.closePath();
  };
  c.strokeStyle = 'rgba(70, 50, 30, 0.4)';
  c.lineWidth = 0.045;
  c.lineJoin = 'round';
  c.beginPath();
  wing();
  c.stroke();
  c.fillStyle = WING;
  c.beginPath();
  wing();
  c.fill();
  // Leicht rötlicher Hauch zur Spitze hin
  ell(c, 0.72, 0.0, 0.14, 0.1, 0, 'rgba(196, 128, 84, 0.28)');
  // Kräftigere Oberkante und feine, aufgefächerte Adern
  line(c, [0.05, -0.065, 0.3, -0.12, 0.6, -0.16, 0.8, -0.13], WING_EDGE, 0.035);
  for (const [x, y] of [
    [0.84, 0.0],
    [0.78, 0.08],
    [0.62, 0.12],
    [0.82, -0.08],
  ] as const)
    line(c, [0.08, -0.04, x, y], VEIN, 0.012);
  // Nuss mit Glanzpunkt
  ell(c, 0, 0, 0.13, 0.1, 0.2, NUT_DARK);
  ell(c, -0.005, -0.005, 0.105, 0.08, 0.2, NUT);
  ell(c, -0.03, -0.03, 0.035, 0.022, 0.2, 'rgba(255, 236, 200, 0.45)');
}

/** Pusteblumen-Schirmchen, Drehpunkt = Mitte des Schirms; Same hängt darunter. */
export function paintDandelionSeed(c: CanvasRenderingContext2D): void {
  const rays = 15;
  const spoke = (color: string, w: number) => {
    c.strokeStyle = color;
    c.lineWidth = w;
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < rays; i++) {
      // Fächer nach oben, leicht gewölbt (wie ein offener Schirm)
      const a = Math.PI * (1.08 + (0.84 * i) / (rays - 1));
      const r = 0.36 + 0.03 * Math.sin(i * 2.3);
      c.moveTo(0, 0);
      c.quadraticCurveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.75, Math.cos(a) * r, Math.sin(a) * r);
    }
    c.stroke();
  };
  spoke(PAPPUS_SHADOW, 0.05);
  spoke(PAPPUS, 0.022);
  // Feine Spitzen
  for (let i = 0; i < rays; i++) {
    const a = Math.PI * (1.08 + (0.84 * i) / (rays - 1));
    const r = 0.36 + 0.03 * Math.sin(i * 2.3);
    ell(c, Math.cos(a) * r, Math.sin(a) * r, 0.022, 0.022, 0, 'rgba(255, 253, 245, 0.9)');
  }
  // Schnabel (Stiel) und Achäne
  line(c, [0, 0, 0, 0.3], 'rgba(120, 104, 80, 0.75)', 0.022);
  ell(c, 0, 0.38, 0.035, 0.1, 0, ACHENE);
  ell(c, 0, 0.0, 0.03, 0.03, 0, '#e9e1cc');
}

/** Begrenzung der Sprites in Zeicheneinheiten. */
const BOUNDS: readonly { x0: number; y0: number; x1: number; y1: number }[] = [
  { x0: -0.18, y0: -0.24, x1: 0.98, y1: 0.24 },
  { x0: -0.44, y0: -0.44, x1: 0.44, y1: 0.52 },
];
/** Halbmesser des Lichtscheins in Zeicheneinheiten (Sprite: Kreis, flach gezeichnet). */
const GLOW_R = 1.6;

/** Zustand je Canvas: Bahnen (je Aussaat) und Sprites (je Größe und Auflösung). */
export class Sowing {
  private readonly paths: SeedPath[] = [];
  private readonly pose: SeedPose = { x: 0, y: 0, rot: 0, squash: 1, scale: 1, alpha: 0 };
  private sprites: (HTMLCanvasElement | null)[] = [null, null, null];
  private key: number[] = [];
  private unit = 0;
  private res = 0;
  /** Wie oft Bahnen bzw. Sprites erzeugt wurden (für Tests). */
  pathBuilds = 0;
  spriteBuilds = 0;

  get prepared(): boolean {
    return this.sprites[0] !== null || this.sprites[1] !== null;
  }

  /** Sprites freigeben (nach der Aussaat). Die Bahnen sind klein und bleiben. */
  release(): void {
    for (const s of this.sprites) {
      if (s) {
        s.width = 0;
        s.height = 0;
      }
    }
    this.sprites[0] = this.sprites[1] = this.sprites[2] = null;
  }

  /** Bahnen für diese Bühne (nur bei Änderung neu berechnet). */
  pathsFor(stage: SowingStage): readonly SeedPath[] {
    const k = this.key;
    if (
      k.length !== 6 ||
      k[0] !== stage.width ||
      k[1] !== stage.groundY ||
      k[2] !== stage.targetX ||
      k[3] !== stage.targetY ||
      k[4] !== stage.unit ||
      k[5] !== stage.seed
    ) {
      sowingPaths(stage, this.paths);
      k.length = 0;
      k.push(stage.width, stage.groundY, stage.targetX, stage.targetY, stage.unit, stage.seed);
      this.pathBuilds++;
    }
    return this.paths;
  }

  private sprite(index: number, unit: number, res: number): HTMLCanvasElement {
    if (this.unit !== unit || this.res !== res) {
      this.release();
      this.unit = unit;
      this.res = res;
    }
    let s = this.sprites[index];
    if (!s) {
      s = document.createElement('canvas');
      const px = unit * res;
      const c = s.getContext('2d')!;
      if (index < 2) {
        const b = BOUNDS[index]!;
        s.width = Math.max(1, Math.ceil((b.x1 - b.x0) * px));
        s.height = Math.max(1, Math.ceil((b.y1 - b.y0) * px));
        c.setTransform(px, 0, 0, px, -b.x0 * px, -b.y0 * px);
        if (index === SEED_MAPLE) paintMapleSeed(c);
        else paintDandelionSeed(c);
      } else {
        // Lichtschein: weicher, warmer Kreis (wird beim Zeichnen flach gestaucht).
        const r = GLOW_R * px;
        s.width = s.height = Math.max(2, Math.ceil(2 * r));
        const g = c.createRadialGradient(r, r, 0, r, r, r);
        g.addColorStop(0, 'rgba(255, 244, 196, 0.85)');
        g.addColorStop(0.45, 'rgba(226, 236, 170, 0.4)');
        g.addColorStop(1, 'rgba(200, 225, 150, 0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s.width, s.height);
      }
      this.sprites[index] = s;
      this.spriteBuilds++;
    }
    return s;
  }

  /**
   * Zeichnet die Aussaat zum Zeitpunkt `u` (s seit Beginn, NaN = nichts). `dpr`: Auflösung
   * des Ziel-Canvas; `spriteDpr`: Auflösung der Sprites; `sx`, `sy`, `tx`, `ty` bilden die
   * Szene (CSS-Pixel × dpr) auf das Canvas ab (ohne Kamera: 1, 1, 0, 0).
   */
  draw(ctx: CanvasRenderingContext2D, u: number, stage: SowingStage, dpr: number, spriteDpr = dpr, sx = 1, sy = 1, tx = 0, ty = 0): void {
    if (!Number.isFinite(u)) return;
    const unit = stage.unit;
    const paths = this.pathsFor(stage);
    const k = dpr / spriteDpr;
    // Lichtschein unter den Samen
    const glow = sowingGlow(u);
    if (glow > 0.01) {
      const s = this.sprite(2, unit, spriteDpr);
      const r = GLOW_R * unit * spriteDpr;
      ctx.globalAlpha = glow;
      ctx.setTransform(sx * k, 0, 0, sy * k * 0.32, tx + sx * stage.targetX * dpr, ty + sy * (stage.targetY - unit * 0.1) * dpr);
      ctx.drawImage(s, -r, -r);
    }
    const pose = this.pose;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]!;
      seedPose(p, u, pose);
      if (pose.alpha <= 0.01) continue;
      const s = this.sprite(p.kind, unit, spriteDpr);
      const b = BOUNDS[p.kind]!;
      const cos = Math.cos(pose.rot) * pose.scale * k;
      const sin = Math.sin(pose.rot) * pose.scale * k;
      const q = pose.squash;
      ctx.globalAlpha = pose.alpha;
      // Drehen um den Drehpunkt, dann quer stauchen (Ahorn: Drehung um die Längsachse).
      ctx.setTransform(sx * cos, sy * sin, -sx * sin * q, sy * cos * q, tx + sx * pose.x * dpr, ty + sy * pose.y * dpr);
      ctx.drawImage(s, b.x0 * unit * spriteDpr, b.y0 * unit * spriteDpr);
    }
    ctx.globalAlpha = 1;
  }
}
