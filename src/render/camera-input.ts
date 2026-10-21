/**
 * Eingaben für die Kamera der Szene – dünne DOM-Schicht über `Camera` (camera.ts):
 *  - Mausrad zoomt zum Zeiger (auf scrollbaren Seiten nur mit Strg bzw. Trackpad-Pinch,
 *    damit das Rad dort die Seite scrollt), Trackpad-Pinch kommt als Strg+Rad.
 *  - Ziehen mit Maus, Stift oder Finger verschiebt (Pointer Events mit Capture), ein Wisch
 *    gleitet aus; zwei Finger zoomen zum Mittelpunkt (Pinch) und verschieben dabei.
 *  - Doppelklick/Doppeltipp zoomt zum Punkt hinein, beim Höchstzoom zurück zur ganzen Szene.
 *  - Tastatur bei fokussierter Szene: + / − zoomen, Pfeile verschieben, 0 setzt zurück.
 *  - Klick/Tippen ohne Ziehen (< 6 px) auf ein Tier meldet den Treffer (`onAnimalTap`).
 * Bei 1× bleibt senkrechtes Seiten-Scrollen über der Szene möglich (`touch-action: pan-y`),
 * vergrößert gehören alle Gesten der Szene (`none`).
 *
 * Dazu eine kleine Bedienleiste (+, −, Ansicht zurücksetzen) und das Merken der Ansicht
 * für die Sitzung (sessionStorage – kein Teil des Spielstands).
 */

import type { AnimalHit } from './animals';
import { anchoredView, Camera, MAX_ZOOM, STRETCH_MAX_ZOOM, stretchZoom, viewLeft, viewTop, type CameraView } from './camera';

/** Zoomfaktor je Knopfdruck und Taste. */
export const BUTTON_ZOOM_STEP = 1.5;
/** Zoomfaktor beim Doppelklick/Doppeltipp. */
export const DOUBLE_TAP_ZOOM = 2;
/** Ab so viel Bewegung (CSS-Pixel) ist es Ziehen statt Tippen. */
export const TAP_SLOP = 6;
/** Höchstabstand (ms) und -entfernung (px) zweier Tipps für einen Doppeltipp. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 30;
/** Längerer Druck ist kein Tippen mehr (ms). */
const TAP_MAX_MS = 600;
/** Verschiebung je Pfeiltaste (Anteil des sichtbaren Ausschnitts). */
const KEY_PAN = 0.15;
/** Speicherort der Ansicht in der Sitzung. */
export const CAMERA_SESSION_KEY = 'tree-grow-camera';

export interface CameraInputOptions {
  camera: Camera;
  /** Treffer-Test für Tiere am Bildschirmpunkt (CSS-Pixel im Canvas). */
  hitTest?: (x: number, y: number) => AnimalHit | null;
  /** Tippen/Klicken auf ein Tier. */
  onAnimalTap?: (hit: AnimalHit) => void;
}

export interface CameraInput {
  /** Je Frame nach `camera.step` aufrufen: Gesten-Modus (touch-action), Zeiger, Sitzung. */
  update(): void;
  dispose(): void;
}

interface Pt {
  x: number;
  y: number;
}

/** Ansicht aus der Sitzung (oder null). */
export function loadCameraView(storage: Pick<Storage, 'getItem'> | null = safeSession()): CameraView | null {
  try {
    const raw = storage?.getItem(CAMERA_SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CameraView>;
    if (typeof v.zoom !== 'number' || typeof v.x !== 'number' || typeof v.y !== 'number') return null;
    return { zoom: v.zoom, x: v.x, y: v.y };
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function attachCameraInput(canvas: HTMLCanvasElement, options: CameraInputOptions): CameraInput {
  const { camera } = options;
  const pointers = new Map<number, Pt>();
  /** Größe des Canvas beim Start der Geste (CSS-Pixel). */
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  /** Szenenpunkt (Anteile) unter dem Finger/Mittelpunkt beim Start der Geste. */
  let anchor: Pt = { x: 0.5, y: 0.5 };
  let pinchDist = 0;
  let pinchZoom = 1;
  let pinched = false;
  let dragging = false;
  let down: { x: number; y: number; t: number } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  /** Letzte Positionen (für die Geschwindigkeit beim Loslassen). */
  const trail: { x: number; y: number; t: number }[] = [];
  let hover: Pt | null = null;
  let hoverHit = false;
  /** Treffer-Test unter der ruhenden Maus nur alle paar Frames (Tiere bewegen sich langsam). */
  let hoverFrames = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let savedRevision = camera.revision;
  let mode = '';

  canvas.tabIndex = 0;
  const label = canvas.getAttribute('aria-label') ?? '';
  canvas.setAttribute('aria-label', `${label}. Zoomen mit Plus und Minus, verschieben mit den Pfeiltasten, 0 zeigt wieder alles.`);
  canvas.classList.add('scene-camera-target');

  const local = (e: { clientX: number; clientY: number }): Pt => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    rect = { left: r.left, top: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  };
  /** Szenenpunkt (Anteile) unter dem Bildschirmpunkt in der aktuellen Ansicht. */
  const sceneAt = (p: Pt): Pt => {
    const v = camera.view;
    return { x: viewLeft(v) + p.x / rect.width / v.zoom, y: viewTop(v) + p.y / rect.height / v.zoom };
  };
  const centroid = (): Pt => {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  };
  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  /** Neuer Bezugspunkt, wenn Finger dazukommen oder gehen (kein Springen). */
  const rebase = () => {
    const c = centroid();
    anchor = sceneAt(c);
    pinchDist = spread();
    pinchZoom = camera.view.zoom;
    trail.length = 0;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.size === 0) measure();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ohne Capture (z. B. synthetische Ereignisse) geht es trotzdem.
    }
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      const p = pointers.get(e.pointerId)!;
      down = { x: p.x, y: p.y, t: e.timeStamp };
      dragging = false;
      pinched = false;
    } else {
      // Zweiter Finger: Pinch – kein Tippen mehr.
      down = null;
      pinched = true;
    }
    rebase();
    // Laufendes Gleiten anhalten: der Finger „greift“ das Bild.
    camera.jump(camera.view, STRETCH_MAX_ZOOM);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) {
      // Maus ohne gedrückte Taste: Zeiger über Tieren.
      if (e.pointerType === 'mouse') {
        measure();
        hover = local(e);
        hoverFrames = 0;
      }
      return;
    }
    pointers.set(e.pointerId, local(e));
    const c = centroid();
    if (down && !dragging && Math.hypot(c.x - down.x, c.y - down.y) > TAP_SLOP) dragging = true;
    if (!dragging && !pinched) return;
    trail.push({ x: c.x, y: c.y, t: e.timeStamp });
    while (trail.length > 2 && e.timeStamp - trail[0]!.t > 100) trail.shift();
    let zoom = camera.view.zoom;
    if (pointers.size >= 2 && pinchDist > 0) zoom = stretchZoom(pinchZoom * (spread() / pinchDist));
    if (zoom <= 1 && !camera.zoomed) return;
    camera.jump(anchoredView(zoom, c.x / rect.width, c.y / rect.height, anchor.x, anchor.y, STRETCH_MAX_ZOOM), STRETCH_MAX_ZOOM);
    e.preventDefault();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const c = centroid();
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      // Ein Finger bleibt: weiter verschieben, ab seiner Lage.
      rebase();
      return;
    }
    const cancelled = e.type === 'pointercancel';
    const fx = c.x / rect.width;
    const fy = c.y / rect.height;
    if (dragging || pinched) {
      // Wisch: mit der Fingergeschwindigkeit ausgleiten; dann Grenzen/Einrasten.
      const first = trail[0];
      const last = trail[trail.length - 1];
      if (!pinched && !cancelled && first && last && last.t - first.t > 0 && e.timeStamp - last.t < 80 && camera.zoomed) {
        const dt = (last.t - first.t) / 1000;
        camera.fling((last.x - first.x) / rect.width / dt, (last.y - first.y) / rect.height / dt);
      }
      camera.settle(fx, fy);
    } else if (!cancelled && down && e.timeStamp - down.t < TAP_MAX_MS) {
      tap(c, e.timeStamp);
    }
    down = null;
    dragging = false;
    pinched = false;
    trail.length = 0;
  };

  const tap = (p: Pt, t: number) => {
    const hit = options.hitTest?.(p.x, p.y) ?? null;
    if (hit) {
      lastTap = null;
      options.onAnimalTap?.(hit);
      return;
    }
    if (lastTap && t - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_SLOP) {
      lastTap = null;
      if (camera.target.zoom >= MAX_ZOOM - 1e-3) camera.reset();
      else camera.zoomBy(DOUBLE_TAP_ZOOM, p.x / rect.width, p.y / rect.height);
      return;
    }
    lastTap = { x: p.x, y: p.y, t };
  };

  const onWheel = (e: WheelEvent) => {
    // Auf scrollbaren Seiten (einspaltig, mobil) gehört das Rad der Seite – außer mit Strg
    // (Trackpad-Pinch meldet sich als Strg+Rad).
    const doc = document.documentElement;
    const pageScrolls = doc.scrollHeight > window.innerHeight + 1;
    if (!e.ctrlKey && pageScrolls) return;
    e.preventDefault();
    measure();
    const p = local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const delta = e.deltaY * unit;
    const factor = Math.min(2, Math.max(0.5, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002))));
    camera.zoomBy(factor, p.x / rect.width, p.y / rect.height);
    // Nach dem Pinch auf dem Trackpad: knapp über 1× einrasten.
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => camera.settle(), 250);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const pan = KEY_PAN;
    switch (e.key) {
      case '+':
      case '=':
        camera.zoomBy(BUTTON_ZOOM_STEP);
        break;
      case '-':
      case '−':
      case '_':
        camera.zoomBy(1 / BUTTON_ZOOM_STEP);
        break;
      case '0':
      case 'Home':
        camera.reset();
        break;
      case 'ArrowLeft':
        if (!camera.zoomed) return;
        camera.panBy(pan, 0);
        break;
      case 'ArrowRight':
        if (!camera.zoomed) return;
        camera.panBy(-pan, 0);
        break;
      case 'ArrowUp':
        if (!camera.zoomed) return;
        camera.panBy(0, pan);
        break;
      case 'ArrowDown':
        if (!camera.zoomed) return;
        camera.panBy(0, -pan);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onLeave = () => {
    hover = null;
  };
  // Safari: eigene Pinch-Gesten der Seite über der Szene unterdrücken.
  const onGesture = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('gesturestart', onGesture);

  return {
    update() {
      // Gesten-Modus: bei 1× darf die Seite senkrecht scrollen, vergrößert nicht.
      const zoomed = camera.zoomed || camera.target.zoom > 1;
      const touch = zoomed ? 'none' : 'pan-y';
      if (canvas.style.touchAction !== touch) canvas.style.touchAction = touch;
      // Zeiger: Hand über Tieren, Greifhand beim Ziehen bzw. vergrößert.
      if (hover && pointers.size === 0) {
        if (hoverFrames-- <= 0) {
          hoverHit = !!options.hitTest?.(hover.x, hover.y);
          hoverFrames = 8;
        }
      } else if (!hover) hoverHit = false;
      const cursor = dragging || pinched ? 'grabbing' : hoverHit ? 'pointer' : zoomed ? 'grab' : '';
      if (mode !== cursor) {
        canvas.style.cursor = cursor;
        mode = cursor;
      }
      // Ansicht für die Sitzung merken, sobald sie ruht.
      if (camera.revision !== savedRevision && !camera.moving && pointers.size === 0) {
        savedRevision = camera.revision;
        try {
          const v = camera.view;
          safeSession()?.setItem(CAMERA_SESSION_KEY, JSON.stringify({ zoom: v.zoom, x: v.x, y: v.y }));
        } catch {
          // Ohne Speicher (privater Modus) bleibt die Ansicht nur bis zum Neuladen.
        }
      }
    },
    dispose() {
      clearTimeout(wheelTimer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('gesturestart', onGesture);
    },
  };
}

export interface CameraControls {
  /** Je Frame aufrufen: Zustand der Knöpfe (nur bei Änderung angefasst). */
  update(): void;
  readonly element: HTMLElement;
}

/**
 * Bedienleiste in der Ecke der Szene: hineinzoomen, herauszoomen, Ansicht zurücksetzen.
 * Knöpfe mindestens 44 px; nicht verfügbare Knöpfe bleiben fokussierbar (aria-disabled).
 */
export function createCameraControls(container: HTMLElement, camera: Camera): CameraControls {
  const bar = document.createElement('div');
  bar.className = 'scene-camera';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Ansicht der Szene');
  const make = (text: string, label: string, ref: string, action: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-camera-button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.dataset.ref = ref;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      action();
    });
    bar.append(b);
    return b;
  };
  const zoomIn = make('+', 'Hineinzoomen', 'zoom-in', () => camera.zoomBy(BUTTON_ZOOM_STEP));
  const zoomOut = make('−', 'Herauszoomen', 'zoom-out', () => camera.zoomBy(1 / BUTTON_ZOOM_STEP));
  const reset = make('⟲', 'Ansicht zurücksetzen', 'zoom-reset', () => camera.reset());
  container.append(bar);

  let shown = '';
  const setDisabled = (b: HTMLButtonElement, off: boolean) => b.setAttribute('aria-disabled', off ? 'true' : 'false');
  return {
    element: bar,
    update() {
      const t = camera.target.zoom;
      const atMax = t >= MAX_ZOOM - 1e-3;
      const atHome = t <= 1 + 1e-6 && !camera.zoomed;
      const key = `${atMax}|${atHome}`;
      if (key === shown) return;
      shown = key;
      setDisabled(zoomIn, atMax);
      setDisabled(zoomOut, atHome);
      setDisabled(reset, atHome);
      bar.classList.toggle('zoomed', !atHome);
    },
  };
}
