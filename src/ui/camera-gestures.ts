/**
 * Gesten der Szenen-Kamera als Zustandsmaschine – ohne DOM, mit einfachen Zeiger-Daten
 * testbar (camera-input.ts übersetzt die echten Ereignisse):
 *  - ein Zeiger: Tippen (< `TAP_SLOP` px, < `TAP_MAX_MS`) oder Ziehen; Doppeltipp zoomt
 *  - zwei Zeiger: Pinch zum Mittelpunkt (verschiebt dabei mit)
 *  - Tasten: + / − / Pfeile / 0
 * Ein laufendes Gleiten wird erst angehalten, wenn wirklich gezogen oder gepincht wird –
 * ein bloßer Tipp lässt es weiterlaufen. Jedes Ende einer Geste (auch Tipp, Abbruch,
 * verlorenes Capture, Maus ohne gedrückte Taste) ruft `camera.settle`, damit kein Zoom
 * über 4× oder knapp über 1× hängen bleibt.
 */

import type { AnimalHit } from '../render/animals';
import { anchoredView, Camera, MAX_ZOOM, STRETCH_MAX_ZOOM, stretchZoom, viewLeft, viewTop } from '../render/camera';

/** Zoomfaktor je Knopfdruck und Taste. */
export const BUTTON_ZOOM_STEP = 1.5;
/** Zoomfaktor beim Doppelklick/Doppeltipp. */
export const DOUBLE_TAP_ZOOM = 2;
/** Ab so viel Bewegung (CSS-Pixel) ist es Ziehen statt Tippen. */
export const TAP_SLOP = 6;
/** Höchstabstand (ms) und -entfernung (px) zweier Tipps für einen Doppeltipp. */
export const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 30;
/** Längerer Druck ist kein Tippen mehr (ms). */
export const TAP_MAX_MS = 600;
/** Verschiebung je Pfeiltaste (Anteil des sichtbaren Ausschnitts). */
const KEY_PAN = 0.15;

/** Ein Zeiger-Ereignis in Canvas-Koordinaten (CSS-Pixel), Zeit in ms. */
export interface GesturePointer {
  id: number;
  /** 'mouse' | 'touch' | 'pen' */
  type: string;
  x: number;
  y: number;
  t: number;
  /** Gedrückte Taste (pointerdown) bzw. gedrückte Tasten als Bitmaske (pointermove). */
  button?: number;
  buttons?: number;
}

export interface CameraGestureOptions {
  /** Treffer-Test für Tiere am Canvas-Punkt (CSS-Pixel). */
  hitTest?: (x: number, y: number) => AnimalHit | null;
  /** Tippen/Klicken auf ein Tier. */
  onAnimalTap?: (hit: AnimalHit) => void;
}

interface Pt {
  x: number;
  y: number;
}

export class CameraGestures {
  /** Größe des Canvas in CSS-Pixeln (setzt die DOM-Schicht). */
  width = 1;
  height = 1;
  private readonly pointers = new Map<number, Pt>();
  /** Szenenpunkt (Anteile) unter dem Finger/Mittelpunkt beim Start der Geste. */
  private anchor: Pt = { x: 0.5, y: 0.5 };
  private pinchDist = 0;
  private pinchZoom = 1;
  private down: { x: number; y: number; t: number } | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  /** Letzte Positionen (für die Geschwindigkeit beim Loslassen). */
  private readonly trail: { x: number; y: number; t: number }[] = [];
  /** Es wird gezogen bzw. gepincht (kein Tippen mehr). */
  dragging = false;
  pinched = false;

  constructor(
    readonly camera: Camera,
    private readonly options: CameraGestureOptions = {},
  ) {}

  /** Läuft gerade eine Geste (mindestens ein Zeiger unten)? */
  get active(): boolean {
    return this.pointers.size > 0;
  }

  /** Zeiger gedrückt. Gibt zurück, ob die Geste ihn übernimmt (dann Capture setzen). */
  pointerDown(p: GesturePointer): boolean {
    if (p.type === 'mouse' && (p.button ?? 0) !== 0) return false;
    this.pointers.set(p.id, { x: p.x, y: p.y });
    if (this.pointers.size === 1) {
      this.down = { x: p.x, y: p.y, t: p.t };
      this.dragging = false;
      this.pinched = false;
    } else {
      // Zweiter Finger: Pinch – kein Tippen mehr; laufendes Gleiten anhalten.
      this.down = null;
      this.pinched = true;
      this.camera.stop();
    }
    this.rebase();
    return true;
  }

  /**
   * Zeiger bewegt. Gibt zurück, ob die Bewegung der Kamera gehört (dann `preventDefault`).
   * Nicht gedrückte Zeiger (Maus-Hover) liefern false.
   */
  pointerMove(p: GesturePointer): boolean {
    if (!this.pointers.has(p.id)) return false;
    // Maus ohne gedrückte Taste: Das Loslassen ging verloren (außerhalb, Kontextmenü …).
    if (p.type === 'mouse' && p.buttons === 0) {
      this.pointerUp(p, true);
      return false;
    }
    this.pointers.set(p.id, { x: p.x, y: p.y });
    const c = this.centroid();
    const down = this.down;
    if (down && !this.dragging && Math.hypot(c.x - down.x, c.y - down.y) > TAP_SLOP) {
      // Jetzt erst greifen: Gleiten anhalten und den Punkt unter dem Druckpunkt festhalten.
      this.dragging = true;
      this.camera.stop();
      this.anchor = this.sceneAt(down);
    }
    if (!this.dragging && !this.pinched) return false;
    const trail = this.trail;
    trail.push({ x: c.x, y: c.y, t: p.t });
    while (trail.length > 2 && p.t - trail[0]!.t > 100) trail.shift();
    let zoom = this.camera.view.zoom;
    if (this.pointers.size >= 2 && this.pinchDist > 0) zoom = stretchZoom(this.pinchZoom * (this.spread() / this.pinchDist));
    // Bei 1× gibt es nichts zu verschieben – die Seite darf scrollen.
    if (zoom <= 1 && !this.camera.zoomed) return false;
    this.camera.jump(anchoredView(zoom, c.x / this.width, c.y / this.height, this.anchor.x, this.anchor.y, STRETCH_MAX_ZOOM), STRETCH_MAX_ZOOM);
    return true;
  }

  /**
   * Zeiger losgelassen bzw. abgebrochen (`cancelled`: pointercancel, verlorenes Capture,
   * Maus ohne Taste). Beendet die Geste, wenn es der letzte Zeiger war.
   */
  pointerUp(p: GesturePointer, cancelled = false): void {
    if (!this.pointers.has(p.id)) return;
    const c = this.centroid();
    this.pointers.delete(p.id);
    if (this.pointers.size > 0) {
      // Ein Finger bleibt: weiter verschieben, ab seiner Lage.
      this.rebase();
      return;
    }
    const fx = c.x / this.width;
    const fy = c.y / this.height;
    if (this.dragging || this.pinched) {
      // Wisch: mit der Fingergeschwindigkeit ausgleiten.
      const trail = this.trail;
      const first = trail[0];
      const last = trail[trail.length - 1];
      if (!this.pinched && !cancelled && first && last && last.t - first.t > 0 && p.t - last.t < 80 && this.camera.zoomed) {
        const dt = (last.t - first.t) / 1000;
        this.camera.fling((last.x - first.x) / this.width / dt, (last.y - first.y) / this.height / dt);
      }
    } else if (!cancelled && this.down && p.t - this.down.t < TAP_MAX_MS) {
      this.tap(c, p.t);
    }
    // Immer: Grenzen/Einrasten (gedehnter Zoom federt zurück, knapp über 1× rastet ein).
    this.camera.settle(fx, fy);
    this.down = null;
    this.dragging = false;
    this.pinched = false;
    this.trail.length = 0;
  }

  /** Taste bei fokussierter Szene; gibt zurück, ob sie verarbeitet wurde. */
  key(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): boolean {
    if (mods.ctrl || mods.meta || mods.alt) return false;
    const cam = this.camera;
    switch (key) {
      case '+':
      case '=':
        cam.zoomBy(BUTTON_ZOOM_STEP);
        return true;
      case '-':
      case '−':
      case '_':
        cam.zoomBy(1 / BUTTON_ZOOM_STEP);
        return true;
      case '0':
      case 'Home':
        cam.reset();
        return true;
    }
    // Pfeile nur vergrößert – bei 1× scrollen sie wie gewohnt die Seite.
    if (!cam.zoomed) return false;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    const d = pan[key];
    if (!d) return false;
    cam.panBy(d[0], d[1]);
    return true;
  }

  /** Mausrad bzw. Trackpad-Pinch (`pinch` = Strg+Rad) am Canvas-Punkt (x, y); `delta` in Pixeln. */
  wheel(delta: number, x: number, y: number, pinch: boolean): void {
    const factor = Math.min(2, Math.max(0.5, Math.exp(-delta * (pinch ? 0.01 : 0.002))));
    this.camera.zoomBy(factor, x / this.width, y / this.height);
  }

  private tap(p: Pt, t: number): void {
    const hit = this.options.hitTest?.(p.x, p.y) ?? null;
    if (hit) {
      this.lastTap = null;
      this.options.onAnimalTap?.(hit);
      return;
    }
    const last = this.lastTap;
    if (last && t - last.t < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_TAP_SLOP) {
      this.lastTap = null;
      if (this.camera.target.zoom >= MAX_ZOOM - 1e-3) this.camera.reset();
      else this.camera.zoomBy(DOUBLE_TAP_ZOOM, p.x / this.width, p.y / this.height);
      return;
    }
    this.lastTap = { x: p.x, y: p.y, t };
  }

  /** Szenenpunkt (Anteile) unter dem Canvas-Punkt in der aktuellen Ansicht. */
  private sceneAt(p: Pt): Pt {
    const v = this.camera.view;
    return { x: viewLeft(v) + p.x / this.width / v.zoom, y: viewTop(v) + p.y / this.height / v.zoom };
  }

  private centroid(): Pt {
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = Math.max(1, this.pointers.size);
    return { x: x / n, y: y / n };
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Neuer Bezugspunkt, wenn Finger dazukommen oder gehen (kein Springen). */
  private rebase(): void {
    this.anchor = this.sceneAt(this.centroid());
    this.pinchDist = this.spread();
    this.pinchZoom = this.camera.view.zoom;
    this.trail.length = 0;
  }
}
