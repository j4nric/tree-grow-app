/**
 * Eingaben für die Kamera der Szene – dünne DOM-Schicht über `CameraGestures`
 * (camera-gestures.ts) und `Camera` (render/camera.ts):
 *  - Pointer Events mit Capture (Maus, Stift, Finger); verlorenes Capture und eine Maus
 *    ohne gedrückte Taste beenden die Geste wie ein Abbruch.
 *  - Mausrad zoomt zum Zeiger (auf scrollbaren Seiten nur mit Strg bzw. Trackpad-Pinch,
 *    damit das Rad dort die Seite scrollt).
 *  - Tastatur bei fokussierter Szene: + / − / Pfeile / 0.
 * Bei 1× bleibt senkrechtes Seiten-Scrollen über der Szene möglich (`touch-action: pan-y`),
 * vergrößert gehören alle Gesten der Szene (`none`).
 *
 * Dazu die Bedienleiste (+, −, Ansicht zurücksetzen) und das Merken der Ansicht für die
 * Sitzung (sessionStorage – kein Teil des Spielstands).
 */

import type { AnimalHit } from '../render/animals';
import { Camera, MAX_ZOOM, type CameraView } from '../render/camera';
import { BUTTON_ZOOM_STEP, CameraGestures, type GesturePointer } from './camera-gestures';

/** Speicherort der Ansicht in der Sitzung. */
export const CAMERA_SESSION_KEY = 'tree-grow-camera';
/** Treffer-Test unter der ruhenden Maus höchstens so oft (ms). */
const HOVER_INTERVAL_MS = 100;
/** Ob die Seite scrollt, höchstens so oft neu messen (ms) – nicht bei jedem Rad-Ereignis. */
const PAGE_SCROLL_RECHECK_MS = 1000;

export interface CameraInputOptions {
  camera: Camera;
  /** Treffer-Test für Tiere am Bildschirmpunkt (CSS-Pixel im Canvas). */
  hitTest?: (x: number, y: number) => AnimalHit | null;
  /** Tippen/Klicken auf ein Tier. */
  onAnimalTap?: (hit: AnimalHit) => void;
}

export interface CameraInput {
  /** Je Frame nach `camera.step` aufrufen: Gesten-Modus (touch-action), Zeiger, Sitzung. */
  update(now: number): void;
  dispose(): void;
  /** Die Zustandsmaschine (für Tests/Fehlersuche). */
  readonly gestures: CameraGestures;
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
  const gestures = new CameraGestures(camera, { hitTest: options.hitTest, onAnimalTap: options.onAnimalTap });
  /** Lage des Canvas (gemerkt; neu gemessen nach Größenänderung oder Scrollen). */
  let rect = { left: 0, top: 0 };
  let rectDirty = true;
  let hover: { x: number; y: number } | null = null;
  let hoverHit = false;
  let hoverAt = -Infinity;
  let pageScrolls = false;
  let pageScrollsAt = -Infinity;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let savedRevision = camera.revision;
  let cursor = '';

  canvas.tabIndex = 0;
  const label = canvas.getAttribute('aria-label') ?? '';
  canvas.setAttribute('aria-label', `${label}. Zoomen mit Plus und Minus, verschieben mit den Pfeiltasten, 0 zeigt wieder alles.`);

  const measure = () => {
    if (!rectDirty) return;
    const r = canvas.getBoundingClientRect();
    rect = { left: r.left, top: r.top };
    gestures.width = Math.max(1, r.width);
    gestures.height = Math.max(1, r.height);
    rectDirty = false;
  };
  const invalidate = () => {
    rectDirty = true;
    pageScrollsAt = -Infinity;
  };
  const pointer = (e: PointerEvent): GesturePointer => {
    measure();
    return { id: e.pointerId, type: e.pointerType, x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp, button: e.button, buttons: e.buttons };
  };

  const onPointerDown = (e: PointerEvent) => {
    // Vor einer Geste einmal frisch messen (Layout kann sich ohne Scrollen geändert haben).
    if (!gestures.active) rectDirty = true;
    if (!gestures.pointerDown(pointer(e))) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ohne Capture (z. B. synthetische Ereignisse) geht es trotzdem.
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = pointer(e);
    if (gestures.pointerMove(p)) {
      e.preventDefault();
      return;
    }
    if (e.pointerType === 'mouse' && !gestures.active) {
      hover = { x: p.x, y: p.y };
    }
  };
  const onPointerUp = (e: PointerEvent) => gestures.pointerUp(pointer(e), e.type !== 'pointerup');
  const onLeave = () => {
    hover = null;
  };

  const onWheel = (e: WheelEvent) => {
    // Auf scrollbaren Seiten (einspaltig, mobil) gehört das Rad der Seite – außer mit Strg
    // (Trackpad-Pinch meldet sich als Strg+Rad).
    if (e.timeStamp - pageScrollsAt > PAGE_SCROLL_RECHECK_MS) {
      pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 1;
      pageScrollsAt = e.timeStamp;
    }
    if (!e.ctrlKey && pageScrolls) return;
    e.preventDefault();
    measure();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    gestures.wheel(e.deltaY * unit, e.clientX - rect.left, e.clientY - rect.top, e.ctrlKey);
    // Nach dem Pinch auf dem Trackpad: knapp über 1× einrasten.
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => camera.settle(), 250);
  };

  const onKey = (e: KeyboardEvent) => {
    if (gestures.key(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey })) e.preventDefault();
  };
  // Safari: eigene Pinch-Gesten der Seite über der Szene unterdrücken.
  const onGesture = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('gesturestart', onGesture);
  window.addEventListener('resize', invalidate, { passive: true });
  window.addEventListener('scroll', invalidate, { passive: true });

  return {
    gestures,
    update(now: number) {
      // Gesten-Modus: bei 1× darf die Seite senkrecht scrollen, vergrößert nicht.
      const zoomed = camera.zoomed || camera.target.zoom > 1;
      const touch = zoomed ? 'none' : 'pan-y';
      if (canvas.style.touchAction !== touch) canvas.style.touchAction = touch;
      // Zeiger: Hand über Tieren (gedrosselt), Greifhand beim Ziehen bzw. vergrößert.
      if (!hover) hoverHit = false;
      else if (!gestures.active && now - hoverAt >= HOVER_INTERVAL_MS) {
        hoverHit = !!options.hitTest?.(hover.x, hover.y);
        hoverAt = now;
      }
      const next = gestures.dragging || gestures.pinched ? 'grabbing' : hoverHit ? 'pointer' : zoomed ? 'grab' : '';
      if (cursor !== next) {
        canvas.style.cursor = next;
        cursor = next;
      }
      // Zustand am Canvas (nur bei Änderung): Tests und Hilfsmittel können darauf warten.
      const state = camera.moving || gestures.active ? 'moving' : 'still';
      if (canvas.dataset.camera !== state) canvas.dataset.camera = state;
      // Ansicht für die Sitzung merken, sobald sie ruht.
      if (camera.revision !== savedRevision && !camera.moving && !gestures.active) {
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
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('scroll', invalidate);
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

  /** Gezeigter Zustand als Bits (1 = Höchstzoom, 2 = ganze Szene); −1 = noch keiner. */
  let shown = -1;
  const setDisabled = (b: HTMLButtonElement, off: boolean) => b.setAttribute('aria-disabled', off ? 'true' : 'false');
  return {
    element: bar,
    update() {
      const t = camera.target.zoom;
      const atMax = t >= MAX_ZOOM - 1e-3;
      const atHome = t <= 1 + 1e-6 && !camera.zoomed;
      const state = (atMax ? 1 : 0) | (atHome ? 2 : 0);
      if (state === shown) return;
      shown = state;
      setDisabled(zoomIn, atMax);
      setDisabled(zoomOut, atHome);
      setDisabled(reset, atHome);
      bar.classList.toggle('zoomed', !atHome);
    },
  };
}
