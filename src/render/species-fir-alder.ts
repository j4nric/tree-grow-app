/**
 * Weißtanne und Schwarzerle (DESIGN_V2.md 25): Farben und Zeichnungen. Die Wuchsformen
 * stehen in `plant.ts` (`TREE_FORMS.fir` / `.alder`), die Auswahl je Art in `species.ts`.
 *
 *   Weißtanne    silbergraue, glatte Rinde mit Flechten; dunkle, blaugrüne Nadeletagen
 *                (flach und breit), im Winter Schnee auf den Etagen; ab Alter Baum
 *                aufrechte Zapfen in der oberen Krone, die im Winter zerfallen.
 *                Immer grün. Frucht: geflügelter Tannensamen.
 *   Schwarzerle  dunkle, rissige Rinde; rundliche, dunkelgrüne Blätter, die im Herbst
 *                kaum färben; kahl im Winter mit schwarzen Zäpfchen und Kätzchen, die im
 *                Vorfrühling gelb stäuben; Stelzwurzeln am Stammfuß. Frucht: Zäpfchen.
 *
 * Alles wird beim Neuaufbau der Ebenen gezeichnet – keine Arbeit pro Frame. Zufall nur
 * über Hashes fester Indizes: gleiche Eingabe → gleiches Bild.
 */

import type { LeafPalette, PlantGeometry, WoodColors } from './plant';
import type { SeasonLook } from './season';
import { clamp01, hash2, mix, smooth01 } from './util';

const TAU = Math.PI * 2;

export const FIR_WOOD: WoodColors = { base: '#9c9f9b', shade: '#787c79', light: '#c8cac5' };
export const FIR_NEEDLES: LeafPalette = { shadow: '#18332e', tones: ['#22443a', '#2c5446', '#3c6656'], highlight: '#a4c2b6' };
export const ALDER_WOOD: WoodColors = { base: '#4f4943', shade: '#37322e', light: '#6f675f' };
export const ALDER_LEAVES: LeafPalette = { shadow: '#29482a', tones: ['#345c30', '#41703a', '#55844a'], highlight: '#9cc07c' };
/** Herbst der Schwarzerle: Die Blätter fallen fast grün, nur stumpf oliv bis braun. */
export const ALDER_AUTUMN: LeafPalette = { shadow: '#383a22', tones: ['#53582c', '#676a34', '#80793f'], highlight: '#b2a866' };

/** Fester Zufallswert 0–1 aus Index und Salz. */
function rnd(i: number, salt: number): number {
  return (hash2(i, salt) & 1023) / 1023;
}

/** Oberes und unteres Ende aller Blattbüschel (Baum-Einheiten). */
function leafSpan(geo: PlantGeometry): [number, number] {
  let top = Infinity;
  let bottom = -Infinity;
  for (const l of geo.leaves) {
    if (l.y < top) top = l.y;
    if (l.y > bottom) bottom = l.y;
  }
  return [top, Math.max(bottom, top + 1e-6)];
}

// ---------------------------------------------------------------------------
// Weißtanne
// ---------------------------------------------------------------------------

/** Ein Nadelzweig (Fächer) in Zeichenpixeln: obere Kante, fransige Unterkante, Astarm. */
interface Spray {
  /** Punkte der Oberkante (x, y) vom Ansatz bis zur Spitze. */
  top: number[];
  /** Fransen der Unterkante (x, y), von der Spitze zurück zum Ansatz. */
  fringe: number[];
  /** Mittellinie (Astarm) x, y. */
  arm: number[];
  /** Dicke des Fächers (px). */
  w: number;
  /** Farbstreuung 0–2 und fester Zufallswert 0–1. */
  tone: number;
  r: number;
}

/** Stützpunkte je Fächer (mehr = feinere Fransen). */
const SPRAY_STEPS = 7;

/**
 * Nadelzweige der Weißtanne: Jedes Aststück ab dem ersten Seitenast trägt einen flachen,
 * gefiederten Fächer – oben eine glatte, bläulich-silbrige Kante, unten fransig und leicht
 * hängend, die Spitze leicht aufgebogen. Seitenzweige setzen eigene Fächer an, so entsteht
 * das gefiederte Bild mit sichtbarem Astarm. Kahle Aststummel (`Branch.bare`) tragen keine
 * Nadeln. `dense` > 1 macht die Fächer voller (junger Baum). Mit `snow` > 0 liegt Schnee
 * auf der Oberkante. Alles in wenigen Füllaufrufen je Farbe (beim Neuaufbau der Ebene).
 */
export function paintFirTiers(
  ctx: CanvasRenderingContext2D,
  geo: PlantGeometry,
  ox: number,
  oy: number,
  scale: number,
  palette: LeafPalette,
  snow: number,
  dense = 1,
  arm = '#5a5a52',
): void {
  const sprays: Spray[] = [];
  geo.branches.forEach((b, i) => {
    if ((b.order ?? 0) < 1) return;
    const foliage = 1 - (b.bare ?? 0);
    if (foliage < 0.05) return;
    const x0 = ox + b.x1 * scale;
    const y0 = oy + b.y1 * scale;
    const x1 = ox + b.mx * scale;
    const y1 = oy + b.my * scale;
    const x2 = ox + b.x2 * scale;
    const y2 = oy + b.y2 * scale;
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const L = l1 + l2;
    if (L < 1.2) return;
    const r = rnd(i, 31);
    // Dicke nach dem Baum (nicht nach dem Aststück): auch die äußeren Zweige tragen volle
    // Fächer; Seitenzweige etwas schmaler.
    const w = Math.min(L * 1.4, scale * ((b.order ?? 1) >= 2 ? 0.17 : 0.24)) * foliage * dense * (0.85 + 0.3 * r);
    // Richtung an der Spitze (für die Verlängerung über das Astende hinaus).
    const dx = (x2 - x1) / (l2 || 1);
    const dy = (y2 - y1) / (l2 || 1);
    const ext = Math.min(w * 0.6, L * 0.25);
    const top: number[] = [];
    const fringe: number[] = [];
    const armPts: number[] = [];
    for (let k = 0; k <= SPRAY_STEPS; k++) {
      const t = k / SPRAY_STEPS;
      // Punkt auf dem Astarm (zwei Teilstücke) bzw. hinter der Spitze.
      const d = t * (L + ext);
      let px: number;
      let py: number;
      if (d <= l1) {
        const u = d / (l1 || 1);
        px = x0 + (x1 - x0) * u;
        py = y0 + (y1 - y0) * u;
      } else if (d <= L) {
        const u = (d - l1) / (l2 || 1);
        px = x1 + (x2 - x1) * u;
        py = y1 + (y2 - y1) * u;
      } else {
        px = x2 + dx * (d - L);
        py = y2 + dy * (d - L);
      }
      // Aufgebogene Spitze, am Ansatz schmal, in der Mitte am breitesten.
      const lift = w * 0.3 * t * t;
      const body = Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.9)) * (1 - 0.35 * t);
      top.push(px, py - lift - w * 0.2 * body);
      armPts.push(px, py - lift);
      // Fransen: abwechselnd lang und kurz, nach außen hängend.
      const long = k % 2 === 1 ? 1 : 0.55;
      const hang = w * (0.55 + 0.15 * rnd(i * 16 + k, 32)) * body * long;
      fringe.push(px - dx * w * 0.12 * long, py - lift + hang);
    }
    // Unterkante rückwärts (Spitze → Ansatz).
    const back: number[] = [];
    for (let k = fringe.length - 2; k >= 0; k -= 2) back.push(fringe[k]!, fringe[k + 1]!);
    sprays.push({ top, fringe: back, arm: armPts, w, tone: Math.floor(rnd(i, 33) * 2.999), r });
  });
  if (sprays.length === 0) return;

  /** Umriss eines Fächers – verschoben um dy; mit `down` > 0 nur ein Band unter der Oberkante. */
  const outline = (sp: Spray, dy: number, down = 0) => {
    const t = sp.top;
    ctx.moveTo(t[0]!, t[1]! + dy);
    for (let k = 2; k < t.length; k += 2) ctx.lineTo(t[k]!, t[k + 1]! + dy);
    const f = down > 0 ? null : sp.fringe;
    if (f) {
      for (let k = 0; k < f.length; k += 2) ctx.lineTo(f[k]!, f[k + 1]! + dy);
    } else {
      // Nur ein Band unter der Oberkante (für Licht und Schnee).
      for (let k = t.length - 2; k >= 0; k -= 2) ctx.lineTo(t[k]!, t[k + 1]! + dy + sp.w * down);
    }
    ctx.closePath();
  };
  const fill = (color: string, filter: (sp: Spray) => boolean, dy: (sp: Spray) => number, down = 0) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    let n = 0;
    for (const sp of sprays) {
      if (!filter(sp)) continue;
      outline(sp, dy(sp), down);
      if (++n >= 64) {
        ctx.fill();
        ctx.beginPath();
        n = 0;
      }
    }
    ctx.fill();
  };
  const all = () => true;
  // Schatten unter dem Fächer, dann der Körper in drei leicht gestreuten Tönen (dunkel).
  fill(palette.shadow, all, (sp) => sp.w * 0.14);
  const body = [mix(palette.shadow, palette.tones[0], 0.55), palette.tones[0], mix(palette.tones[0], palette.tones[1], 0.6)];
  for (let t = 0; t < 3; t++) fill(body[t]!, (sp) => sp.tone === t, () => 0);
  // Gefiedert: dunkle Nadelstriche vom Astarm in die Fransen.
  ctx.lineCap = 'round';
  ctx.strokeStyle = palette.shadow;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.6, scale * 0.0035);
  ctx.beginPath();
  for (const sp of sprays) {
    if (sp.w < 3) continue;
    const a = sp.arm;
    const f = sp.fringe;
    const n = a.length / 2;
    for (let k = 1; k < n; k++) {
      const fi = (n - 1 - k) * 2;
      ctx.moveTo(a[(k - 1) * 2]!, a[(k - 1) * 2 + 1]!);
      ctx.lineTo(f[fi]!, f[fi + 1]!);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Oberseite heller, bläulich-silbrig; Streuung je Ast.
  const upper = [mix(palette.tones[1], '#7fa3a6', 0.3), mix(palette.tones[2], '#8fb2b2', 0.35), mix(palette.tones[1], palette.tones[2], 0.5)];
  for (let t = 0; t < 3; t++) fill(upper[t]!, (sp) => sp.tone === t, () => 0, 0.22);
  // Astarm sichtbar (nur bei kräftigen Fächern).
  ctx.strokeStyle = arm;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(0.7, scale * 0.004);
  ctx.beginPath();
  for (const sp of sprays) {
    if (sp.w < 4) continue;
    const a = sp.arm;
    ctx.moveTo(a[0]!, a[1]!);
    for (let k = 2; k < a.length - 2; k += 2) ctx.lineTo(a[k]!, a[k + 1]!);
  }
  ctx.stroke();
  // Silbrige Lichter auf einigen Oberkanten.
  ctx.globalAlpha = 0.5;
  fill(palette.highlight, (sp) => sp.r > 0.6, () => 0, 0.07);
  ctx.globalAlpha = 1;
  if (snow <= 0.02) return;
  // Schnee auf der Oberkante: mehr Schnee → mehr und dickere Hauben.
  const covered = (sp: Spray) => sp.r < 0.2 + 0.8 * snow;
  ctx.globalAlpha = 0.5 * snow;
  fill('#c3ced8', covered, (sp) => -sp.w * 0.02, 0.2 + 0.1 * snow);
  ctx.globalAlpha = Math.min(1, 0.4 + 0.6 * snow);
  fill('#f2f5f7', covered, (sp) => -sp.w * 0.08, 0.12 + 0.1 * snow);
  ctx.globalAlpha = 1;
}

/** Glatte, silbergraue Rinde mit feinen Querstrichen und hellen Flechten (ab Wachstum ~2,5). */
export function paintFirBark(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number): void {
  const strength = smooth01((g - 2.5) / 2);
  if (strength <= 0) return;
  const marks: number[] = [];
  const lichen: number[] = [];
  let i = 0;
  for (const s of geo.segments) {
    i++;
    const hw = (s.w1 * scale) / 2;
    if (hw < 2.4) continue;
    const x1 = ox + s.x1 * scale;
    const y1 = oy + s.y1 * scale;
    const x2 = ox + s.x2 * scale;
    const y2 = oy + s.y2 * scale;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 3) continue;
    const tx = (x2 - x1) / len;
    const ty = (y2 - y1) / len;
    const n = Math.min(40, Math.floor(len / Math.max(3, hw * 0.55)));
    for (let k = 0; k < n; k++) {
      const u = (k + rnd(i * 64 + k, 81)) / Math.max(n, 1);
      const q = (rnd(i * 64 + k, 82) * 2 - 1) * 0.7;
      const half = hw * (1 - u * 0.25);
      const cx = x1 + tx * len * u - ty * q * half;
      const cy = y1 + ty * len * u + tx * q * half;
      // Kurzer Strich quer zum Stamm (Korkporen), im Alter etwas länger.
      const w = half * (0.18 + 0.2 * rnd(i * 64 + k, 83)) * (0.7 + 0.3 * strength);
      marks.push(cx - ty * -w, cy + tx * -w, cx - ty * w, cy + tx * w);
      if (rnd(i * 64 + k, 84) < 0.22) lichen.push(cx, cy, Math.max(1, half * (0.07 + 0.08 * rnd(i * 64 + k, 85))));
    }
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5f625f';
  ctx.globalAlpha = 0.45 * strength;
  ctx.lineWidth = Math.max(0.7, Math.min(1.6, scale * 0.004));
  ctx.beginPath();
  for (let k = 0; k < marks.length; k += 4) {
    ctx.moveTo(marks[k]!, marks[k + 1]!);
    ctx.lineTo(marks[k + 2]!, marks[k + 3]!);
  }
  ctx.stroke();
  ctx.fillStyle = '#c9d1b8';
  ctx.globalAlpha = 0.55 * strength;
  ctx.beginPath();
  for (let k = 0; k < lichen.length; k += 3) {
    const r = lichen[k + 2]!;
    ctx.moveTo(lichen[k]! + r * 1.4, lichen[k + 1]!);
    ctx.ellipse(lichen[k]!, lichen[k + 1]!, r * 1.4, r, 0, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Aufrechte Tannenzapfen auf den Etagen der oberen Krone, erst ab Alter Baum (g ≥ 4).
 * Im Sommer grünlich-violett, im Herbst braun; im Winter zerfallen die meisten (nur
 * noch wenige Spindeln).
 */
export function paintFirCones(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number, look: SeasonLook | null): void {
  const want = Math.min(14, (g - 4) * 6);
  if (want <= 0) return;
  const [top, bottom] = leafSpan(geo);
  const line = top + (bottom - top) * 0.32;
  const upper: number[] = [];
  geo.leaves.forEach((l, i) => {
    if (l.level >= 2 && l.y <= line) upper.push(i);
  });
  if (upper.length === 0) return;
  const winter = look ? look.snow : 0;
  const share = Math.min(1, (want * (1 - 0.75 * winter)) / upper.length);
  const color = mix('#6c6a48', '#8a5c38', look ? Math.max(look.autumn, winter) : 0);
  const cones: number[] = [];
  for (const i of upper) {
    if (rnd(i, 91) > share) continue;
    const l = geo.leaves[i]!;
    const R = l.r * scale * 0.8;
    const h = Math.max(6, R * 0.8);
    const w = Math.max(2.6, h * 0.36);
    const x = ox + l.x * scale + (rnd(i, 92) - 0.5) * R * 1.4;
    const y = oy + l.y * scale - R * 0.22;
    cones.push(x, y, w, h);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < cones.length; k += 4) {
    const [x, y, w, h] = [cones[k]!, cones[k + 1]!, cones[k + 2]!, cones[k + 3]!];
    // Walze mit gerundeter Spitze, steht auf der Etage.
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 2, y - h + w / 2);
    ctx.arc(x, y - h + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = mix(color, '#e6dcc0', 0.35);
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let k = 0; k < cones.length; k += 4) {
    const [x, y, w, h] = [cones[k]!, cones[k + 1]!, cones[k + 2]!, cones[k + 3]!];
    ctx.rect(x - w * 0.32, y - h + w * 0.6, Math.max(0.6, w * 0.22), h - w * 0.9);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Schwarzerle
// ---------------------------------------------------------------------------

/**
 * Rissige Borke: dunkle Längsrisse mit kurzen Querrissen, kleine, fast quadratische
 * Schuppen. Ab Wachstum ~2,5, mit dem Alter deutlicher.
 */
export function paintAlderBark(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number): void {
  const strength = smooth01((g - 2.5) / 2);
  if (strength <= 0) return;
  ctx.lineCap = 'round';
  for (const pass of [0, 1] as const) {
    ctx.strokeStyle = pass === 0 ? '#211b18' : '#857b70';
    ctx.globalAlpha = (pass === 0 ? 0.8 : 0.45) * strength;
    ctx.beginPath();
    let i = 0;
    for (const s of geo.segments) {
      i++;
      const hw = (s.w1 * scale) / 2;
      if (hw < 2.4) continue;
      const x1 = ox + s.x1 * scale;
      const y1 = oy + s.y1 * scale;
      const x2 = ox + s.x2 * scale;
      const y2 = oy + s.y2 * scale;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 3) continue;
      const tx = (x2 - x1) / len;
      const ty = (y2 - y1) / len;
      const hw2 = (s.w2 * scale) / 2;
      const cols = Math.max(2, Math.min(8, Math.round(hw / 2.4)));
      const plate = Math.max(3, hw * 0.42);
      const rows = Math.min(60, Math.max(1, Math.floor(len / plate)));
      if (pass === 0) ctx.lineWidth = Math.max(0.7, Math.min(2, hw * 0.07));
      else ctx.lineWidth = Math.max(0.5, Math.min(1.1, hw * 0.04));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const h = hash2(hash2(i, r * 16 + c), 37);
          if ((h & 7) < 2) continue;
          const u0 = (r + (((h >>> 3) & 255) / 255) * 0.4) / rows;
          const u1 = Math.min(1, u0 + (0.5 + (((h >>> 11) & 255) / 255) * 0.5) / rows);
          const half = hw + (hw2 - hw) * (u0 + u1) * 0.5;
          const q = ((c + 0.5) / cols) * 2 - 1 + ((((h >>> 19) & 255) / 255) - 0.5) * (1 / cols);
          const off = Math.max(-0.85, Math.min(0.85, q)) * half;
          const dx = pass === 0 ? 0 : -Math.max(0.7, half * 0.05);
          const ax = x1 + tx * len * u0 - ty * (off + dx);
          const ay = y1 + ty * len * u0 + tx * (off + dx);
          ctx.moveTo(ax, ay);
          ctx.lineTo(x1 + tx * len * u1 - ty * (off + dx), y1 + ty * len * u1 + tx * (off + dx));
          // Häufige Querrisse: kleine, eckige Schuppen.
          if (pass === 0 && (h & 3) === 3 && c < cols - 1) {
            const w = (2 / cols) * half;
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - ty * w, ay + tx * w);
          }
        }
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Stelzwurzeln: Bögen aus dem Stammfuß, die über dem Boden ins nasse Erdreich greifen
 * (ab Wachstum ~2,5, mit dem Alter weiter). Vor dem Holz zeichnen – der Stamm deckt
 * die Ansätze ab.
 */
export function paintStiltRoots(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number, wood: WoodColors): void {
  const grow = smooth01((g - 2.5) / 2.5);
  const foot = geo.segments[0];
  if (grow <= 0 || !foot) return;
  const half = (foot.w1 * scale) / 2;
  if (half < 1.5) return;
  // Je Seite zwei Wurzeln: eine kräftige, hoch ansetzende und eine flachere davor.
  const roots: { pts: number[]; side: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const k = i >> 1;
    const reach = half * (1.1 + 0.55 * k + 0.35 * rnd(i, 61)) * grow;
    const rise = half * (0.95 - 0.35 * k + 0.25 * rnd(i, 62)) * (0.45 + 0.55 * grow);
    const w0 = half * (0.55 - 0.12 * k);
    const x0 = ox + side * half * 0.35;
    const y0 = oy - rise;
    const x1 = ox + side * (half + reach);
    // Knie: die Wurzel tritt fast waagrecht aus dem Stamm und biegt dann zum Boden.
    const cx = x0 + (x1 - x0) * 0.62;
    const cy = y0 - rise * 0.12;
    const pts: number[] = [];
    const N = 8;
    for (let n = 0; n <= N; n++) {
      const t = n / N;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * (oy + 2);
      const w = w0 * (1 - 0.6 * t);
      pts.push(x, y, w);
    }
    roots.push({ pts, side });
  }
  const shape = (dy: number, k: number) => {
    for (const { pts } of roots) {
      const n = pts.length / 3;
      ctx.moveTo(pts[0]!, pts[1]! - pts[2]! * k + dy);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 3]!, pts[i * 3 + 1]! - pts[i * 3 + 2]! * k + dy);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(pts[i * 3]!, pts[i * 3 + 1]! + pts[i * 3 + 2]! * k + dy);
      ctx.closePath();
    }
  };
  ctx.fillStyle = wood.shade;
  ctx.beginPath();
  shape(0.6, 0.6);
  ctx.fill();
  ctx.fillStyle = wood.base;
  ctx.beginPath();
  shape(0, 0.5);
  ctx.fill();
  // Licht von oben: helle Kante auf den Bögen.
  ctx.strokeStyle = wood.light;
  ctx.globalAlpha = 0.55;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, half * 0.08);
  ctx.beginPath();
  for (const { pts } of roots) {
    const n = pts.length / 3;
    ctx.moveTo(pts[0]!, pts[1]! - pts[2]! * 0.3);
    for (let i = 1; i < n - 1; i++) ctx.lineTo(pts[i * 3]!, pts[i * 3 + 1]! - pts[i * 3 + 2]! * 0.3);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Kätzchen und Zäpfchen an den Zweigspitzen der kahlen Erle (Winter und Vorfrühling).
 * Männliche Kätzchen hängen violettbraun, im Vorfrühling länger und gelb stäubend;
 * daneben die schwarzen, verholzten Zäpfchen vom Vorjahr. Erst am älteren Baum (g ≥ 3).
 */
export function paintAlderCatkins(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number, look: SeasonLook | null): void {
  if (!look) return;
  const bare = smooth01((0.55 - look.leaves) / 0.45);
  const age = smooth01((g - 3) / 1.2);
  if (bare <= 0 || age <= 0) return;
  const spring = look.spring;
  const tips: number[] = [];
  const outer = Math.max(2, geo.maxLevel - 1);
  // Höchstens etwa 70 Zweigspitzen, gleich verteilt (per Seed fest).
  let count = 0;
  for (const l of geo.leaves) if (l.level >= outer) count++;
  const share = Math.min(0.5, (70 * age) / Math.max(count, 1));
  geo.leaves.forEach((l, i) => {
    if (l.level >= outer && rnd(i, 71) < share) tips.push(i);
  });
  if (tips.length === 0) return;
  const catkin = mix('#6b4339', '#c5a03e', spring);
  const catkins: number[] = [];
  const cones: number[] = [];
  for (const i of tips) {
    const l = geo.leaves[i]!;
    const R = l.r * scale;
    const x = ox + l.x * scale + (rnd(i, 72) - 0.5) * R * 0.6;
    const y = oy + l.y * scale + (rnd(i, 73) - 0.5) * R * 0.4;
    if (rnd(i, 74) < 0.62) {
      const len = Math.max(6, R * 0.6) * (1 + 0.5 * spring);
      const n = 2 + (hash2(i, 75) % 2);
      for (let k = 0; k < n; k++) {
        const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.28 + (rnd(i * 4 + k, 76) - 0.5) * 0.2;
        catkins.push(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
      }
    } else {
      const r = Math.max(1.8, R * 0.09);
      for (let k = 0; k < 3; k++) cones.push(x + (k - 1) * r * 2.1, y - Math.abs(k - 1) * r * 0.8 + r, r);
    }
  }
  ctx.globalAlpha = bare;
  ctx.lineCap = 'round';
  ctx.strokeStyle = catkin;
  ctx.lineWidth = Math.max(1.8, scale * 0.006);
  ctx.beginPath();
  for (let k = 0; k < catkins.length; k += 4) {
    ctx.moveTo(catkins[k]!, catkins[k + 1]!);
    ctx.lineTo(catkins[k + 2]!, catkins[k + 3]!);
  }
  ctx.stroke();
  ctx.fillStyle = '#2a221e';
  ctx.beginPath();
  for (let k = 0; k < cones.length; k += 3) {
    const r = cones[k + 2]!;
    ctx.moveTo(cones[k]! + r * 0.85, cones[k + 1]!);
    ctx.ellipse(cones[k]!, cones[k + 1]!, r * 0.85, r * 1.15, 0, 0, TAU);
  }
  ctx.fill();
  // Schuppen-Glanz auf den Zäpfchen.
  ctx.fillStyle = '#5c4d42';
  ctx.beginPath();
  for (let k = 0; k < cones.length; k += 3) {
    const r = cones[k + 2]!;
    ctx.moveTo(cones[k]! - r * 0.25 + r * 0.3, cones[k + 1]! - r * 0.35);
    ctx.arc(cones[k]! - r * 0.25, cones[k + 1]! - r * 0.35, r * 0.3, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Samen, Keimblätter, Frucht
// ---------------------------------------------------------------------------

/** Tannensamen (dreikantiges Korn mit breitem Flügel) bzw. Erlensamen (flach, schmaler Rand). */
export function paintFirAlderSeed(ctx: CanvasRenderingContext2D, species: 'fir' | 'alder', cx: number, cy: number, r: number): void {
  if (species === 'fir') {
    ctx.fillStyle = 'rgba(206, 168, 118, 0.82)';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.3, cy + r * 0.2);
    ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 2, cy - r * 0.75);
    ctx.quadraticCurveTo(cx + r * 1.2, cy + r * 0.25, cx - r * 0.3, cy + r * 0.2);
    ctx.fill();
    ctx.fillStyle = '#6a4226';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.95, cy + r * 0.45);
    ctx.lineTo(cx + r * 0.25, cy - r * 0.4);
    ctx.lineTo(cx + r * 0.2, cy + r * 0.55);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.fillStyle = 'rgba(176, 134, 92, 0.75)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.05, r * 0.85, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#5e3c24';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.62, r * 0.55, -0.2, 0, TAU);
  ctx.fill();
}

/** Keimblätter: Tanne ein flacher Stern aus fünf breiten Nadeln, Erle zwei kleine runde. */
export function paintFirAlderCotyledons(ctx: CanvasRenderingContext2D, species: 'fir' | 'alder', x: number, y: number, size: number): void {
  if (size < 0.5) return;
  if (species === 'fir') {
    ctx.lineCap = 'round';
    ctx.strokeStyle = FIR_NEEDLES.tones[1];
    ctx.lineWidth = Math.max(1, size * 0.11);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.62;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * size * 0.62, y + Math.sin(a) * size * 0.42);
    }
    ctx.stroke();
    ctx.strokeStyle = FIR_NEEDLES.highlight;
    ctx.lineWidth = Math.max(0.5, size * 0.03);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.62;
      ctx.moveTo(x + Math.cos(a) * size * 0.12, y + Math.sin(a) * size * 0.08 + size * 0.02);
      ctx.lineTo(x + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.34 + size * 0.02);
    }
    ctx.stroke();
    return;
  }
  for (const side of [-1, 1]) {
    const angle = side * 0.4 - (side < 0 ? Math.PI : 0);
    const cx = x + Math.cos(angle) * size * 0.42;
    const cy = y + Math.sin(angle) * size * 0.42 - size * 0.06;
    ctx.fillStyle = ALDER_LEAVES.tones[1];
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.42, size * 0.34, angle, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ALDER_LEAVES.tones[2];
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.05, cy - size * 0.06, size * 0.24, size * 0.16, angle, 0, TAU);
    ctx.fill();
  }
}

/** Fallende Frucht im Zyklus-Übergang (Einheiten wie `paintFruit`: Breite 1, Höhe 1,25). */
export function paintFirAlderFruit(g: CanvasRenderingContext2D, species: 'fir' | 'alder'): void {
  if (species === 'fir') {
    // Geflügelter Tannensamen, Flügel nach oben.
    g.fillStyle = 'rgba(206, 168, 118, 0.9)';
    g.beginPath();
    g.moveTo(0.42, 1.0);
    g.quadraticCurveTo(0.12, 0.45, 0.42, 0.1);
    g.quadraticCurveTo(0.86, 0.4, 0.62, 0.95);
    g.closePath();
    g.fill();
    g.fillStyle = '#6a4226';
    g.beginPath();
    g.ellipse(0.52, 1.0, 0.16, 0.2, 0.2, 0, TAU);
    g.fill();
    return;
  }
  // Erlen-Zäpfchen am Stiel.
  g.strokeStyle = '#4a3a2e';
  g.lineWidth = 0.06;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0.5, 0.32);
  g.lineTo(0.55, 0.06);
  g.stroke();
  g.fillStyle = '#2e2420';
  g.beginPath();
  g.ellipse(0.5, 0.72, 0.3, 0.42, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#5c4b3e';
  g.lineWidth = 0.05;
  g.beginPath();
  for (const y of [0.5, 0.68, 0.86]) {
    g.moveTo(0.28, y);
    g.lineTo(0.72, y - 0.06);
  }
  g.stroke();
}

/** Laubmenge: Tanne immer voll (winterfest), Erle wie die Jahreszeit. */
export function firAlderLeafAmount(species: 'fir' | 'alder', look: SeasonLook | null): number {
  if (!look || species === 'fir') return 1;
  return clamp01(look.leaves);
}
