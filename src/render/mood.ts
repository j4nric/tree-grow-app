/**
 * Stimmung der Szene je Harmoniestufe (DESIGN_V2.md 9.1 und 11.3).
 *
 *   0 „Zarte Anfänge“       leicht grau verschleiert, kühles Licht
 *   1 „Lebendiges Gefüge“   nur noch ein Hauch Grau
 *   2 „Stimmiges Ökosystem“ neutral (wie ohne Angabe)
 *   3 „Blühender Mischwald“ warmes Licht, Sonnenstrahlen durch die Krone, Pollen und Blütenblätter
 *   4 „Urwald“              goldenes Licht, kräftigere Strahlen, dazu Glühwürmchen-Lichter
 *
 * Günstig pro Frame: Schleier, Sonnenschein und Strahlen liegen gemeinsam in einer
 * gecachten Licht-Ebene (halbe Auflösung, nur bei geänderter Stimmung neu gezeichnet);
 * dazu ab Stufe 3 ein Durchgang weiches Licht und einige kleine Partikel-Sprites.
 * Wechselt die Stufe, blendet die Stimmung in etwa zwei Sekunden über.
 */

import { clamp, clamp01, hash2, smooth01 } from './util';

/** Höchste Harmoniestufe. */
export const MAX_HARMONY_TIER = 4;
/** Neutrale Stufe: sieht aus wie ohne Angabe. */
export const NEUTRAL_HARMONY_TIER = 2;
/** Überblendgeschwindigkeit (Stufen pro Sekunde). */
const FADE_RATE = 0.5;

export interface MoodFrame {
  width: number;
  height: number;
  groundY: number;
  /** Höchster Punkt der Bäume (Partikel bleiben darunter). */
  top: number;
  dpr: number;
  sx: number;
  sy: number;
  time: number;
  reducedMotion: boolean;
  /**
   * Jahreszeit (phenology.ts): Anteil der Pollen und Blütenblätter bzw. der Glühwürmchen
   * 0–1 – im Herbst und Winter keine Blütenblätter, im Winter keine Glühwürmchen.
   * Ohne Angabe 1.
   */
  bloom?: number;
  fireflies?: number;
}

/** Normalisiert eine Harmoniestufe: undefiniert/ungültig → null, sonst 0–4. */
export function normalizeTier(tier: number | undefined): number | null {
  if (tier === undefined || tier === null || !Number.isFinite(tier)) return null;
  return clamp(tier, 0, MAX_HARMONY_TIER);
}

/** Stärke der einzelnen Effekte bei einer (stufenlosen) Stimmung 0–4. */
export function moodWeights(level: number): { veil: number; warm: number; rays: number; pollen: number; fireflies: number } {
  return {
    veil: 0.2 * clamp01((NEUTRAL_HARMONY_TIER - level) / 2) ** 0.8,
    warm: clamp01((level - NEUTRAL_HARMONY_TIER) / 2),
    rays: smooth01((level - 2.2) / 1.3),
    pollen: smooth01((level - 2.4) / 0.8),
    fireflies: smooth01((level - 3.2) / 0.7),
  };
}

interface Particle {
  kind: 0 | 1 | 2; // Pollen, Blütenblatt, Glühwürmchen
  /** Grundlage in Anteilen (x der Breite, y zwischen Baumspitze und Boden). */
  u: number;
  v: number;
  speed: number;
  phase: number;
  /** Ab dieser Stärke sichtbar (0–1): mehr Partikel bei höherer Stufe. */
  from: number;
}

/** Feste, per Seed bestimmte Partikel. */
function makeParticles(count: number, kind: 0 | 1 | 2, seed: number): Particle[] {
  const list: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash2(seed, i);
    const r = (k: number) => ((hash2(h, k) & 0xffff) / 0x10000);
    list.push({
      kind,
      u: r(1),
      v: kind === 2 ? 0.55 + r(2) * 0.43 : 0.15 + r(2) * 0.8,
      speed: 0.6 + r(3) * 0.8,
      phase: r(4) * 100,
      from: (i / count) * 0.7,
    });
  }
  return list;
}

/** Stimmungs-Ebene einer Szene (Zustand der Überblendung und gecachte Sprites). */
export class MoodLayer {
  /** Aktuell gezeigte, stufenlose Stimmung (NaN = keine). */
  level = Number.NaN;
  private lastTime = Number.NaN;
  private light: HTMLCanvasElement | null = null;
  private lightKey = '';
  private lightLevel = Number.NaN;
  /** Wie oft die Licht-Ebene gezeichnet wurde (für Tests). */
  lightBuilds = 0;
  private warmGrad: CanvasGradient | null = null;
  private warmKey = -1;
  private dots = new Map<string, HTMLCanvasElement>();
  private dotsDpr = 0;
  private particles: Particle[] = [
    ...makeParticles(16, 0, 11),
    ...makeParticles(8, 1, 23),
    ...makeParticles(14, 2, 37),
  ];

  /** Führt die Stimmung zur Zielstufe; gibt die aktuelle Stufe oder null (aus) zurück. */
  update(tier: number | undefined, time: number, reducedMotion: boolean): number | null {
    const target = normalizeTier(tier);
    if (target === null) {
      this.level = Number.NaN;
      this.lastTime = Number.NaN;
      return null;
    }
    if (Number.isNaN(this.level) || reducedMotion) {
      this.level = target;
    } else {
      const dt = time - this.lastTime;
      // Steht die Zeit (Pause, feste Demo-Zeit) oder springt sie, je Frame ein kleiner Schritt.
      const step = Number.isFinite(dt) && dt > 0 && dt < 0.5 ? dt * FADE_RATE : FADE_RATE / 60;
      const d = target - this.level;
      this.level = Math.abs(d) <= step ? target : this.level + Math.sign(d) * step;
    }
    this.lastTime = time;
    return this.level;
  }

  /** Pollen, Blütenblätter und Glühwürmchen – ganz oben (nach der Lichtfarbe). */
  drawParticles(ctx: CanvasRenderingContext2D, level: number, f: MoodFrame): void {
    const mw = moodWeights(level);
    const pollen = mw.pollen * (f.bloom === undefined ? 1 : clamp01(f.bloom));
    const fireflies = mw.fireflies * (f.fireflies === undefined ? 1 : clamp01(f.fireflies));
    if (pollen <= 0.01 && fireflies <= 0.01) return;
    const t = f.reducedMotion ? 0 : f.time;
    const span = f.groundY - f.top;
    const small = f.width < 600;
    const base = Math.max(2.2, Math.min(f.width, f.height) * 0.006);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      // Auf schmalen Bildschirmen jedes zweite Partikel weglassen.
      if (small && i % 2 === 1) continue;
      const strength = p.kind === 2 ? fireflies : pollen;
      const a = clamp01((strength - p.from) / 0.3);
      if (a <= 0.01) continue;
      let x: number;
      let y: number;
      let alpha = a;
      let rot = 0;
      let size = base;
      if (p.kind === 2) {
        // Glühwürmchen: langsames Umherschweben, sanftes Pulsieren.
        x = (p.u + 0.04 * Math.sin(t * 0.23 * p.speed + p.phase)) * f.width;
        y = f.top + span * p.v + span * 0.03 * Math.sin(t * 0.37 * p.speed + p.phase * 1.3);
        alpha *= f.reducedMotion ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.9 * p.speed + p.phase)) ** 2;
        size = base * 5;
      } else {
        // Pollen und Blütenblätter treiben langsam mit dem Wind nach rechts.
        const drift = t * 0.012 * p.speed;
        const u = (((p.u + drift) % 1.1) + 1.1) % 1.1 - 0.05;
        x = u * f.width;
        y = f.top + span * p.v + span * 0.04 * Math.sin(t * 0.5 * p.speed + p.phase);
        if (p.kind === 1) {
          rot = f.reducedMotion ? p.phase : t * 0.8 * p.speed + p.phase;
          size = base * 2.8;
          alpha *= 0.9;
        } else {
          size = base * 1.7;
          alpha *= 0.85;
        }
      }
      const s = this.dot(p.kind, size, f.dpr);
      const k = f.dpr;
      const c = rot === 0 ? 1 : Math.cos(rot);
      const sn = rot === 0 ? 0 : Math.sin(rot);
      ctx.globalAlpha = alpha;
      // Glühwürmchen leuchten additiv.
      ctx.globalCompositeOperation = p.kind === 2 ? 'lighter' : 'source-over';
      ctx.setTransform(f.sx * k * c, f.sy * k * sn, -f.sx * k * sn, f.sy * k * c, f.sx * k * x, f.sy * k * y);
      ctx.drawImage(s, -size / 2, -size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /**
   * Licht über allem: bei hoher Stufe ein Durchgang weiches Licht (wärmer, kräftiger),
   * dann die gecachte Licht-Ebene (Schleier bzw. Sonnenschein und Strahlen) – pro Frame
   * also höchstens zwei Flächen-Zeichnungen.
   */
  drawLight(ctx: CanvasRenderingContext2D, level: number, f: MoodFrame): void {
    const mw = moodWeights(level);
    if (mw.veil <= 0.004 && mw.warm <= 0.004) return;
    ctx.setTransform(f.sx * f.dpr, 0, 0, f.sy * f.dpr, 0, 0);
    if (mw.warm > 0.004) {
      // Weiches Licht in sattem Gold: Grün wird wärmer und kräftiger, der Himmel bleibt blau.
      if (!this.warmGrad || this.warmKey !== f.height) {
        const g = ctx.createLinearGradient(0, 0, 0, f.height);
        g.addColorStop(0.2, 'rgba(255, 190, 90, 0)');
        g.addColorStop(0.45, 'rgba(255, 184, 80, 0.4)');
        g.addColorStop(0.8, 'rgba(255, 176, 76, 0.42)');
        g.addColorStop(1, 'rgba(255, 170, 70, 0.22)');
        this.warmGrad = g;
        this.warmKey = f.height;
      }
      // Oben (Himmel) ist der Verlauf durchsichtig – erst ab einem Fünftel zeichnen.
      const y0 = Math.floor(f.height * 0.2);
      ctx.globalAlpha = mw.warm;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = this.warmGrad;
      ctx.fillRect(0, y0, f.width, f.height - y0);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.lightLayer(level, f), 0, 0, f.width, f.height);
  }

  /**
   * Licht-Ebene in halber Auflösung: grauer Schleier, warmer Hauch, Sonnenschein und
   * Strahlenfächer. Neu gezeichnet nur bei neuer Größe oder merklich anderer Stimmung
   * (beim Überblenden etwa zwanzigmal, sonst nie).
   */
  private lightLayer(level: number, f: MoodFrame): HTMLCanvasElement {
    const key = `${f.width}x${f.height}/${f.groundY}`;
    const q = Math.round(level * 20) / 20;
    if (this.light && this.lightKey === key && this.lightLevel === q) return this.light;
    const scale = 0.5;
    const canvas = this.light ?? document.createElement('canvas');
    const cw = Math.max(1, Math.ceil(f.width * scale));
    const ch = Math.max(1, Math.ceil(f.height * scale));
    // Größe nur bei Änderung setzen (das leert und belegt den Speicher neu), sonst nur leeren.
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const c = canvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    const mw = moodWeights(q);
    if (mw.veil > 0.004) {
      // Kühler, grauer Schleier – oben (Himmel) etwas heller als in der Erde.
      const g = c.createLinearGradient(0, 0, 0, f.height);
      g.addColorStop(0, 'rgb(176, 181, 184)');
      g.addColorStop(0.8, 'rgb(150, 152, 150)');
      g.addColorStop(1, 'rgb(120, 118, 114)');
      c.globalAlpha = mw.veil;
      c.fillStyle = g;
      c.fillRect(0, 0, f.width, f.height);
    }
    if (mw.warm > 0.004) {
      // Ein Hauch Gold über allem und ein goldener Schein um die Sonne.
      c.globalAlpha = mw.warm * 0.1;
      c.fillStyle = 'rgb(255, 200, 120)';
      c.fillRect(0, 0, f.width, f.height);
      const sunX = f.width * 0.84;
      const sunY = f.groundY * 0.16;
      const r = Math.max(f.width, f.groundY) * 0.55;
      const sun = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, r);
      sun.addColorStop(0, 'rgba(255, 226, 160, 0.4)');
      sun.addColorStop(1, 'rgba(255, 226, 160, 0)');
      c.globalAlpha = mw.warm;
      c.fillStyle = sun;
      c.fillRect(0, 0, f.width, f.height);
    }
    if (mw.rays > 0.01) {
      c.globalAlpha = mw.rays;
      paintRays(c, f);
    }
    c.globalAlpha = 1;
    this.light = canvas;
    this.lightKey = key;
    this.lightLevel = q;
    this.lightBuilds++;
    return canvas;
  }

  /** Kleine Partikel-Sprites (Pollen, Blütenblatt, Glühwürmchen) je Größe und Pixeldichte. */
  private dot(kind: 0 | 1 | 2, size: number, dpr: number): HTMLCanvasElement {
    if (this.dotsDpr !== dpr) {
      this.dots.clear();
      this.dotsDpr = dpr;
    }
    const px = Math.max(2, Math.round(size * dpr));
    const key = `${kind}/${px}`;
    let s = this.dots.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = px;
    s.height = px;
    const c = s.getContext('2d')!;
    const r = px / 2;
    c.translate(r, r);
    if (kind === 0) {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 244, 190, 1)');
      g.addColorStop(0.45, 'rgba(250, 226, 140, 0.8)');
      g.addColorStop(1, 'rgba(250, 226, 140, 0)');
      c.fillStyle = g;
      c.fillRect(-r, -r, px, px);
    } else if (kind === 1) {
      // Blütenblatt: zartes Rosa mit hellerer Mitte.
      c.fillStyle = '#f2c9d4';
      c.beginPath();
      c.ellipse(0, 0, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fbe6ec';
      c.beginPath();
      c.ellipse(-r * 0.15, -r * 0.08, r * 0.45, r * 0.18, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 255, 220, 1)');
      g.addColorStop(0.12, 'rgba(240, 250, 150, 0.95)');
      g.addColorStop(0.35, 'rgba(214, 240, 110, 0.35)');
      g.addColorStop(1, 'rgba(200, 235, 100, 0)');
      c.fillStyle = g;
      c.fillRect(-r, -r, px, px);
    }
    if (this.dots.size > 64) this.dots.clear();
    this.dots.set(key, s);
    return s;
  }
}

/** Strahlenfächer von der Sonne nach links unten durch die Krone (Breite/Helligkeit per Seed). */
function paintRays(c: CanvasRenderingContext2D, f: MoodFrame): void {
  const sx = f.width * 0.84;
  const sy = f.groundY * 0.16;
  const len = Math.hypot(f.width, f.groundY) * 1.1;
  c.save();
  c.beginPath();
  c.rect(0, 0, f.width, f.groundY);
  c.clip();
  const beams = 6;
  for (let i = 0; i < beams; i++) {
    const h = hash2(97, i);
    const r = (k: number) => (hash2(h, k) & 0xffff) / 0x10000;
    const ang = Math.PI * (0.6 + (i / (beams - 1)) * 0.2) + (r(1) - 0.5) * 0.04;
    const spread = 0.016 + r(2) * 0.024;
    const g = c.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    const a = 0.22 + r(3) * 0.14;
    // Am Himmel zart, über der Krone (Mitte bis unten) am hellsten.
    g.addColorStop(0, 'rgba(255, 246, 214, 0)');
    g.addColorStop(0.2, `rgba(255, 244, 205, ${(a * 0.35).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(255, 240, 196, ${a.toFixed(3)})`);
    g.addColorStop(0.85, `rgba(255, 238, 190, ${(a * 0.6).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 236, 180, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(ang - spread) * len, sy + Math.sin(ang - spread) * len);
    c.lineTo(sx + Math.cos(ang + spread) * len, sy + Math.sin(ang + spread) * len);
    c.closePath();
    c.fill();
  }
  c.restore();
}
