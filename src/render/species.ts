/**
 * Arten des Hauptbaums (ROADMAP Phase 4): Eiche (Standard), Buche, Kiefer.
 *
 *   Eiche   wie bisher
 *   Buche   glatter grauer Stamm, dichte ovale Krone in hellerem Grün; im Herbst
 *           kupferbraun, ein Teil des trockenen Laubs bleibt über den Winter hängen;
 *           Frucht: Buchecker
 *   Kiefer  schlanker, rötlicher Schaft mit Plattenborke, Nadelbüschel in Etagen,
 *           jung kegelig, alt schirmartig; Zapfen; das ganze Jahr grün;
 *           Frucht: geflügelter Samen bzw. Zapfen
 *   Tanne    Weißtanne, Schwarzerle: siehe species-fir-alder.ts (zunächst nur Demo)
 *   Erle
 *
 * Wuchsformen stehen in `plant.ts` (`TREE_FORMS`), hier nur Farben und Zeichnungen.
 * Alles wird beim Neuaufbau der Ebenen gezeichnet – keine Arbeit pro Frame.
 */

import type { LeafCluster, LeafPalette, PlantGeometry, TreeSpecies, WoodColors } from './plant';
import { seasonLeaves, type SeasonLook } from './season';
import { hash2, mix } from './util';
import {
  ALDER_AUTUMN,
  ALDER_LEAVES,
  ALDER_WOOD,
  FIR_NEEDLES,
  FIR_WOOD,
  firAlderLeafAmount,
  paintFirAlderCotyledons,
  paintFirAlderFruit,
  paintFirAlderSeed,
} from './species-fir-alder';

export type { TreeSpecies } from './plant';
export { normalizeSpecies } from './plant';

export const BEECH_WOOD: WoodColors = { base: '#8e8b85', shade: '#74716b', light: '#aeaba4' };
export const PINE_WOOD: WoodColors = { base: '#9a5636', shade: '#7a3f26', light: '#c4784c' };
export const BEECH_LEAVES: LeafPalette = { shadow: '#3a6a2c', tones: ['#4f8a36', '#66a243', '#82b955'], highlight: '#c2e08e' };
export const PINE_NEEDLES: LeafPalette = { shadow: '#22443a', tones: ['#2c5a46', '#3b6c52', '#4f7e60'], highlight: '#88ae94' };
/** Herbstlaub der Buche: Kupfer- und Rostbraun. */
const BEECH_AUTUMN: LeafPalette = { shadow: '#5a2e16', tones: ['#8f4320', '#ad5c2a', '#c97d3e'], highlight: '#e4a96a' };

/** Anteil trockenen Laubs, das an der Buche über den Winter hängen bleibt. */
export const BEECH_WINTER_LEAVES = 0.12;

/**
 * Laubmenge der Art in der Jahreszeit: Kiefer immer voll, Buche behält im Herbst und
 * Winter einen Teil ihres trockenen Laubs.
 */
export function speciesLeafAmount(species: TreeSpecies, look: SeasonLook | null): number {
  if (species === 'fir' || species === 'alder') return firAlderLeafAmount(species, look);
  if (!look) return 1;
  if (species === 'pine') return 1;
  if (species === 'beech') return Math.max(look.leaves, BEECH_WINTER_LEAVES * look.autumn);
  return look.leaves;
}

/** Laubfarben der Art in der Jahreszeit (Eiche: `oak`, die bisherige Palette). */
export function speciesLeaves(species: TreeSpecies, oak: LeafPalette, look: SeasonLook | null): LeafPalette {
  if (species === 'pine') return PINE_NEEDLES;
  if (species === 'fir') return FIR_NEEDLES;
  if (species === 'alder') return seasonLeaves(ALDER_LEAVES, look, ALDER_AUTUMN);
  if (species === 'beech') {
    const p = seasonLeaves(BEECH_LEAVES, look, BEECH_AUTUMN);
    // Im Winter (Schnee) bleicht das hängende Laub zu trockenem Beige aus.
    if (!look || look.snow <= 0) return p;
    const k = look.snow * 0.45;
    const f = (c: string) => mix(c, '#c9a77c', k);
    return { shadow: f(p.shadow), tones: [f(p.tones[0]), f(p.tones[1]), f(p.tones[2])], highlight: f(p.highlight) };
  }
  return seasonLeaves(oak, look);
}

/** Holz der Art: junger, grüner Trieb (`stem`) verholzt mit `lignin` zur Rinde der Art. */
export function speciesWood(species: TreeSpecies, stem: WoodColors, oak: WoodColors, lignin: number): WoodColors {
  const w = species === 'beech' ? BEECH_WOOD : species === 'pine' ? PINE_WOOD : species === 'fir' ? FIR_WOOD : species === 'alder' ? ALDER_WOOD : oak;
  return { base: mix(stem.base, w.base, lignin), shade: mix(stem.shade, w.shade, lignin), light: mix(stem.light, w.light, lignin) };
}

/**
 * Kiefernborke: unregelmäßige, längliche Plättchen zwischen dunklen, senkrechten Rissen
 * auf Stamm und dicken Ästen – erst am verholzten Baum (ab Wachstum ~2), mit dem Alter
 * deutlicher. Lage und Länge der Risse sind per Seed fest.
 */
export function paintPineBark(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number): void {
  const strength = Math.min(1, Math.max(0, (g - 2) / 1.5));
  if (strength <= 0) return;
  ctx.lineCap = 'round';
  // Zwei Durchgänge: dunkle Risse, dann helle Plättchen-Kanten (Licht von links).
  for (const pass of [0, 1] as const) {
    ctx.strokeStyle = pass === 0 ? '#5a2a16' : '#d08a5c';
    ctx.globalAlpha = (pass === 0 ? 0.85 : 0.5) * strength;
    let i = 0;
    for (const s of geo.segments) {
      i++;
      const hw = (s.w1 * scale) / 2;
      if (hw < 2.2) continue;
      const x1 = ox + s.x1 * scale;
      const y1 = oy + s.y1 * scale;
      const x2 = ox + s.x2 * scale;
      const y2 = oy + s.y2 * scale;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 2) continue;
      // Einheitsvektor längs (t) und quer (n) zum Ast.
      const tx = (x2 - x1) / len;
      const ty = (y2 - y1) / len;
      const nx = -ty;
      const ny = tx;
      const hw2 = (s.w2 * scale) / 2;
      // Risse in Spalten quer über den Ast, Plättchen etwa so lang wie 0,6 Stammbreiten.
      const cols = Math.max(2, Math.min(7, Math.round(hw / 3.2)));
      const plate = Math.max(4, hw * 0.75);
      const rows = Math.max(1, Math.floor(len / plate));
      ctx.lineWidth = pass === 0 ? Math.max(0.8, Math.min(2.6, hw * 0.09)) : Math.max(0.6, Math.min(1.4, hw * 0.05));
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const h = hash2(hash2(i, r * 16 + c), 71);
          // Nicht jede Zelle bekommt einen Riss – so entstehen unregelmäßige Plättchen.
          if ((h & 7) < 2) continue;
          const u0 = (r + ((h >>> 3) & 255) / 255 * 0.45) / rows;
          const u1 = Math.min(1, u0 + (0.45 + ((h >>> 11) & 255) / 255 * 0.6) / rows);
          const half = hw + (hw2 - hw) * (u0 + u1) * 0.5;
          // Querlage −0,8..0,8 der halben Breite, Spalte für Spalte versetzt.
          const q = ((c + 0.5) / cols) * 2 - 1 + ((((h >>> 19) & 255) / 255) - 0.5) * (1.2 / cols);
          const off = Math.max(-0.82, Math.min(0.82, q)) * half;
          const dx = pass === 0 ? 0 : -Math.max(0.8, half * 0.05);
          const wob = (((h >>> 27) & 15) / 15 - 0.5) * half * 0.08;
          const ax = x1 + tx * len * u0 + nx * (off + dx);
          const ay = y1 + ty * len * u0 + ny * (off + dx);
          ctx.moveTo(ax, ay);
          ctx.lineTo(x1 + tx * len * u1 + nx * (off + dx + wob), y1 + ty * len * u1 + ny * (off + dx + wob));
          // Ab und zu ein kurzer Querriss: schließt ein Plättchen ab.
          if (pass === 0 && (h & 7) === 7 && c < cols - 1) {
            const w = (2 / cols) * half * 0.9;
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax + nx * w, ay + ny * w);
          }
        }
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Zapfen: hängen unter einigen äußeren Nadelbüscheln (per Seed), erst am älteren Baum
 * und nur wenige (höchstens etwa ein Dutzend).
 */
export function paintCones(ctx: CanvasRenderingContext2D, geo: PlantGeometry, ox: number, oy: number, scale: number, g: number): void {
  if (g < 3.5) return;
  let outer = 0;
  for (const l of geo.leaves) if (l.level >= 2 && l.level >= geo.maxLevel - 1) outer++;
  const want = Math.min(12, Math.round((g - 3.5) * 4));
  const share = outer > 0 ? Math.min(1, want / outer) : 0;
  let i = 0;
  ctx.fillStyle = '#b5824c';
  ctx.beginPath();
  const marks: number[] = [];
  for (const l of geo.leaves as LeafCluster[]) {
    i++;
    if (l.level < 2 || l.level < geo.maxLevel - 1) continue;
    if ((hash2(i, 53) & 1023) / 1024 > share) continue;
    const R = l.r * scale;
    const r = Math.max(3.6, R * 0.5);
    const x = ox + l.x * scale + R * (((hash2(i, 54) & 255) / 255 - 0.5) * 0.8);
    const y = oy + l.y * scale + R * 0.3;
    ctx.moveTo(x + r * 0.6, y);
    ctx.ellipse(x, y, r * 0.6, r, 0, 0, Math.PI * 2);
    marks.push(x, y, r);
  }
  ctx.fill();
  // Schuppen andeuten.
  ctx.strokeStyle = '#74482a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < marks.length; k += 3) {
    const x = marks[k]!;
    const y = marks[k + 1]!;
    const r = marks[k + 2]!;
    for (const dy of [-0.4, 0, 0.4]) {
      ctx.moveTo(x - r * 0.45, y + dy * r);
      ctx.lineTo(x + r * 0.45, y + dy * r - r * 0.15);
    }
  }
  ctx.stroke();
}

/** Samen im Boden (Keimung): Eichel, Buchecker oder geflügelter Kiefernsamen. */
export function paintSeed(ctx: CanvasRenderingContext2D, species: TreeSpecies, cx: number, cy: number, r: number): void {
  if (species === 'fir' || species === 'alder') {
    paintFirAlderSeed(ctx, species, cx, cy, r);
    return;
  }
  if (species === 'beech') {
    // Buchecker: dreikantige, glänzend braune Nuss.
    ctx.fillStyle = '#7a4a26';
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.1, cy + r * 0.7);
    ctx.quadraticCurveTo(cx, cy + r * 1.05, cx + r * 1.1, cy + r * 0.7);
    ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 0.2, cx, cy - r * 1.3);
    ctx.quadraticCurveTo(cx - r * 0.5, cy - r * 0.2, cx - r * 1.1, cy + r * 0.7);
    ctx.fill();
    ctx.fillStyle = '#a5703e';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.25, cy - r * 0.05, r * 0.18, r * 0.55, 0.35, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (species === 'pine') {
    // Kiefernsamen: kleines dunkles Korn mit hellem, durchscheinendem Flügel.
    ctx.fillStyle = 'rgba(214, 186, 140, 0.8)';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.9, cy - r * 0.35, r * 1.2, r * 0.48, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3020';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.25, cy + r * 0.05, r * 0.6, r * 0.45, -0.35, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Eiche: wie bisher.
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.4, r, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b07a44';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.4, cy - r * 0.35, r * 0.55, r * 0.25, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Keimblätter: Eiche zwei schmale, Buche zwei breite, nierenförmige, Kiefer ein Nadelkranz. */
export function paintCotyledons(ctx: CanvasRenderingContext2D, species: TreeSpecies, x: number, y: number, size: number, palette: LeafPalette): void {
  if (size < 0.5) return;
  if (species === 'fir' || species === 'alder') {
    paintFirAlderCotyledons(ctx, species, x, y, size);
    return;
  }
  if (species === 'pine') {
    ctx.strokeStyle = PINE_NEEDLES.tones[1];
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, size * 0.07);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * size * 0.75, y + Math.sin(a) * size * 0.62);
    }
    ctx.stroke();
    return;
  }
  const broad = species === 'beech';
  for (const side of [-1, 1]) {
    const angle = side * 0.45 - (side < 0 ? Math.PI : 0);
    const cx = x + Math.cos(angle) * size * 0.5;
    const cy = y + Math.sin(angle) * size * 0.5 - size * 0.08;
    ctx.fillStyle = palette.tones[1];
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.55, size * (broad ? 0.4 : 0.26), angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.tones[2];
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.05, cy - size * 0.06, size * 0.35, size * (broad ? 0.2 : 0.12), angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Fallende Frucht im Zyklus-Übergang (Sprite, Ursprung unten Mitte, Breite × 1,25 Höhe):
 * Eichel, Buchecker oder Kiefernzapfen.
 */
export function paintFruit(g: CanvasRenderingContext2D, species: TreeSpecies): void {
  // Zeicheneinheiten: Breite 1, Höhe 1,25 (wie die Eichel).
  if (species === 'fir' || species === 'alder') {
    paintFirAlderFruit(g, species);
    return;
  }
  if (species === 'beech') {
    g.fillStyle = '#7a4a26';
    g.beginPath();
    g.moveTo(0.18, 1.05);
    g.quadraticCurveTo(0.5, 1.2, 0.82, 1.05);
    g.quadraticCurveTo(0.66, 0.5, 0.5, 0.15);
    g.quadraticCurveTo(0.34, 0.5, 0.18, 1.05);
    g.fill();
    g.fillStyle = '#a5703e';
    g.beginPath();
    g.ellipse(0.42, 0.7, 0.06, 0.22, 0.25, 0, Math.PI * 2);
    g.fill();
    return;
  }
  if (species === 'pine') {
    g.fillStyle = '#7a4a2a';
    g.beginPath();
    g.ellipse(0.5, 0.7, 0.28, 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4e2c18';
    g.lineWidth = 0.05;
    g.beginPath();
    for (const y of [0.4, 0.58, 0.76, 0.94]) {
      g.moveTo(0.28, y);
      g.lineTo(0.72, y - 0.08);
    }
    g.stroke();
    g.strokeStyle = '#5a4128';
    g.lineWidth = 0.06;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0.5, 0.2);
    g.lineTo(0.52, 0.06);
    g.stroke();
    return;
  }
  // Eichel (wie bisher)
  g.fillStyle = '#9a6a35';
  g.beginPath();
  g.ellipse(0.5, 0.72, 0.3, 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c08a4c';
  g.beginPath();
  g.ellipse(0.42, 0.66, 0.1, 0.22, -0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6e5232';
  g.beginPath();
  g.ellipse(0.5, 0.36, 0.36, 0.2, 0, Math.PI, 0);
  g.lineTo(0.86, 0.42);
  g.lineTo(0.14, 0.42);
  g.closePath();
  g.fill();
  g.fillStyle = '#856540';
  for (const x of [0.28, 0.44, 0.6, 0.74]) {
    g.beginPath();
    g.arc(x, 0.36, 0.05, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#5a4128';
  g.lineWidth = 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0.5, 0.18);
  g.lineTo(0.56, 0.04);
  g.stroke();
}
