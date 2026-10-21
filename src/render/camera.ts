/**
 * Kamera der Szene: Zoom und sichtbarer Ausschnitt – reine Logik ohne DOM (testbar).
 *
 * Koordinaten sind Anteile der Szene (0–1 je Achse), damit eine Größenänderung des
 * Canvas den Ausschnitt nicht verschiebt. `x`, `y` sind die Mitte des sichtbaren
 * Ausschnitts, `zoom` der Vergrößerungsfaktor (1 = ganze Szene wie ohne Kamera).
 * Der Ausschnitt ist je Achse 1/zoom breit und bleibt immer ganz in der Szene – es wird
 * also nie Leerraum außerhalb sichtbar; bei 1× ist keine Verschiebung möglich.
 *
 * `Camera` hält den gezeichneten Ausschnitt (`view`) und ein Ziel (`target`), dem er
 * weich folgt (exponentielles Gleiten; bei reduzierter Bewegung sofort). Ziehen und
 * Pinch setzen den Ausschnitt direkt; ein Wisch gleitet mit der Fingergeschwindigkeit
 * aus und bremst weich vor dem Rand ab, weil das Ziel schon begrenzt ist. Beim Pinch über
 * den Höchstzoom hinaus gibt die Kamera mit Widerstand nach und federt beim Loslassen
 * zurück; knapp über 1× rastet sie auf die ganze Szene ein.
 */

import { clamp } from './util';

/** Kleinster Zoom: die ganze Szene. */
export const MIN_ZOOM = 1;
/** Größter Zoom (Ziel); beim Pinch kurzzeitig bis `MAX_ZOOM · (1 + ZOOM_STRETCH)`. */
export const MAX_ZOOM = 4;
/** Nachgeben über den Höchstzoom hinaus (Gummiband beim Pinch), Anteil. */
export const ZOOM_STRETCH = 0.12;
/** Unter diesem Zoom rastet die Kamera nach einer Geste auf 1× ein. */
export const SNAP_ZOOM = 1.06;
/** Zoomfaktor je Knopfdruck, Taste und Doppelklick. */
export const ZOOM_STEP = 2;
/** Zeitkonstante (s) des Gleitens bei Knöpfen, Tasten und Mausrad. */
export const GLIDE_SECONDS = 0.09;
/** Zeitkonstante (s) des Ausgleitens nach einem Wisch. */
export const FLING_SECONDS = 0.28;

export interface CameraView {
  /** Vergrößerung, 1 = ganze Szene. */
  zoom: number;
  /** Mitte des sichtbaren Ausschnitts als Anteil der Szenenbreite bzw. -höhe (0–1). */
  x: number;
  y: number;
}

/** Ganze Szene (Standardansicht). */
export const HOME_VIEW: Readonly<CameraView> = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });

/** Zoom begrenzen; ungültige Werte → 1. */
export function clampZoom(zoom: number, max = MAX_ZOOM): number {
  return Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, Math.max(MIN_ZOOM, max)) : MIN_ZOOM;
}

/** Mitte einer Achse so begrenzen, dass der Ausschnitt (Breite 1/zoom) ganz in der Szene liegt. */
export function clampCenter(c: number, zoom: number): number {
  const half = 0.5 / zoom;
  if (!Number.isFinite(c)) return 0.5;
  return half >= 0.5 ? 0.5 : clamp(c, half, 1 - half);
}

/**
 * Ausschnitt begrenzen: Zoom in [1, max], Mitte so, dass kein Leerraum sichtbar wird.
 * Schreibt nach `out` (Standard: neues Objekt).
 */
export function clampView(v: Readonly<CameraView>, max = MAX_ZOOM, out: CameraView = { zoom: 1, x: 0.5, y: 0.5 }): CameraView {
  const zoom = clampZoom(v.zoom, max);
  out.zoom = zoom;
  out.x = clampCenter(v.x, zoom);
  out.y = clampCenter(v.y, zoom);
  return out;
}

/** Linker bzw. oberer Rand des Ausschnitts (Anteil der Szene). */
export function viewLeft(v: Readonly<CameraView>): number {
  return v.x - 0.5 / v.zoom;
}
export function viewTop(v: Readonly<CameraView>): number {
  return v.y - 0.5 / v.zoom;
}

/** Gleiche Ansicht (bis auf `eps`)? */
export function sameView(a: Readonly<CameraView>, b: Readonly<CameraView>, eps = 1e-9): boolean {
  return Math.abs(a.zoom - b.zoom) <= eps && Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/**
 * Bildschirmpunkt (CSS-Pixel im Canvas, Breite `width`, Höhe `height`) → Szenenpunkt
 * (CSS-Pixel der ungezoomten Szene). Schreibt nach `out`.
 */
export function screenToScene(
  v: Readonly<CameraView>,
  width: number,
  height: number,
  px: number,
  py: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = viewLeft(v) * width + px / v.zoom;
  out.y = viewTop(v) * height + py / v.zoom;
  return out;
}

/** Szenenpunkt (CSS-Pixel der ungezoomten Szene) → Bildschirmpunkt im Canvas. */
export function sceneToScreen(
  v: Readonly<CameraView>,
  width: number,
  height: number,
  sx: number,
  sy: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = (sx - viewLeft(v) * width) * v.zoom;
  out.y = (sy - viewTop(v) * height) * v.zoom;
  return out;
}

/**
 * Ansicht mit Zoom `zoom`, bei der der Szenenpunkt (`sx`, `sy`, Anteile) unter dem
 * Bildschirmpunkt (`fx`, `fy`, Anteile des Canvas) liegt – begrenzt.
 */
export function anchoredView(zoom: number, fx: number, fy: number, sx: number, sy: number, max = MAX_ZOOM): CameraView {
  const z = clampZoom(zoom, max);
  return { zoom: z, x: clampCenter(sx - fx / z + 0.5 / z, z), y: clampCenter(sy - fy / z + 0.5 / z, z) };
}

/**
 * Zoom zum Punkt: neuer Zoom `zoom`, der Szenenpunkt unter (`fx`, `fy`) (Anteile des
 * Canvas) bleibt an seiner Stelle – soweit die Grenzen es erlauben.
 */
export function zoomAt(v: Readonly<CameraView>, zoom: number, fx: number, fy: number, max = MAX_ZOOM): CameraView {
  return anchoredView(zoom, fx, fy, viewLeft(v) + fx / v.zoom, viewTop(v) + fy / v.zoom, max);
}

/** Verschiebt den Inhalt um (`dx`, `dy`) Anteile der Canvas-Größe (Ziehen nach rechts = Inhalt nach rechts). */
export function panView(v: Readonly<CameraView>, dx: number, dy: number): CameraView {
  return { zoom: v.zoom, x: clampCenter(v.x - dx / v.zoom, v.zoom), y: clampCenter(v.y - dy / v.zoom, v.zoom) };
}

/**
 * Weiches Nachgeben über den Höchstzoom hinaus: bis `MAX_ZOOM` unverändert, darüber
 * mit wachsendem Widerstand bis höchstens `MAX_ZOOM · (1 + ZOOM_STRETCH)` (stetig, ohne Knick).
 */
export function stretchZoom(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_ZOOM;
  if (raw <= MAX_ZOOM) return Math.max(MIN_ZOOM, raw);
  const over = raw / MAX_ZOOM - 1;
  return MAX_ZOOM * (1 + ZOOM_STRETCH * (1 - Math.exp(-over / ZOOM_STRETCH)));
}

/** Zoom während einer Geste höchstens so weit (Gummiband). */
export const STRETCH_MAX_ZOOM = MAX_ZOOM * (1 + ZOOM_STRETCH);

/** Anker eines gleitenden Zooms: Szenenpunkt (s) bleibt unter dem Bildschirmpunkt (f). */
interface GlideAnchor {
  fx: number;
  fy: number;
  sx: number;
  sy: number;
}

/**
 * Kamera mit weichem Gleiten. `view` ist der in diesem Frame gezeichnete Ausschnitt
 * (immer begrenzt), `target` das Ziel. `step(dt)` je Frame aufrufen.
 */
export class Camera {
  readonly view: CameraView = { ...HOME_VIEW };
  readonly target: CameraView = { ...HOME_VIEW };
  /** Bewegung reduzieren: Ziele werden sofort übernommen, kein Ausgleiten. */
  reducedMotion = false;
  /** Zählt jede Änderung von `view` (für Beobachter, z. B. Bedienleiste). */
  revision = 0;
  private anchor: GlideAnchor | null = null;
  private tau = GLIDE_SECONDS;

  constructor(initial?: Readonly<CameraView> | null) {
    if (initial) this.jump(initial);
  }

  /** Gleitet gerade (Ziel noch nicht erreicht)? */
  get moving(): boolean {
    return !sameView(this.view, this.target);
  }

  /** Vergrößert (Ansicht nicht ganz)? */
  get zoomed(): boolean {
    return this.view.zoom > MIN_ZOOM + 1e-6;
  }

  /** Setzt Ansicht und Ziel sofort (begrenzt; beim Pinch darf der Zoom kurz über MAX_ZOOM). */
  jump(v: Readonly<CameraView>, max = MAX_ZOOM): void {
    clampView(v, max, this.view);
    clampView(this.view, max, this.target);
    this.anchor = null;
    this.revision++;
  }

  /** Gleitet zu `v` (begrenzt); `anchor` hält beim Zoomen den Punkt unter dem Zeiger fest. */
  glideTo(v: Readonly<CameraView>, anchor: GlideAnchor | null = null, tau = GLIDE_SECONDS): void {
    clampView(v, MAX_ZOOM, this.target);
    this.anchor = anchor;
    this.tau = tau;
    if (this.reducedMotion) this.finish();
  }

  /**
   * Zoomt um `factor` zum Punkt (`fx`, `fy`, Anteile des Canvas; Standard: Mitte).
   * Mehrere Schritte hintereinander (Mausrad) summieren sich auf das Ziel; der Punkt unter
   * dem Zeiger bleibt dabei auch während des Gleitens stehen.
   */
  zoomBy(factor: number, fx = 0.5, fy = 0.5): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const zoom = clampZoom(this.target.zoom * factor);
    // Der Punkt, der jetzt (im gezeichneten Bild) unter dem Zeiger liegt.
    const sx = viewLeft(this.view) + fx / this.view.zoom;
    const sy = viewTop(this.view) + fy / this.view.zoom;
    this.glideTo(anchoredView(zoom, fx, fy, sx, sy), { fx, fy, sx, sy });
  }

  /** Verschiebt das Ziel um (`dx`, `dy`) Anteile des Canvas (Tastatur). */
  panBy(dx: number, dy: number): void {
    const t = panView(this.target, dx, dy);
    this.glideTo(t);
  }

  /** Zurück zur ganzen Szene (gleitend). */
  reset(): void {
    this.glideTo(HOME_VIEW);
  }

  /**
   * Ausgleiten nach einem Wisch: Geschwindigkeit (`vx`, `vy`) in Canvas-Anteilen je
   * Sekunde. Das Ziel liegt dort, wo die Bewegung von selbst ausliefe – begrenzt, so
   * bremst die Kamera vor dem Rand weich ab. Bei reduzierter Bewegung: kein Ausgleiten.
   */
  fling(vx: number, vy: number): void {
    if (this.reducedMotion || !Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const t = panView(this.view, vx * FLING_SECONDS, vy * FLING_SECONDS);
    this.glideTo(t, null, FLING_SECONDS);
  }

  /**
   * Ende einer Geste: über den Höchstzoom gedehnt → zurückfedern (Punkt `fx`, `fy` bleibt
   * stehen); knapp über 1× → auf die ganze Szene einrasten.
   */
  settle(fx = 0.5, fy = 0.5): void {
    const v = this.view;
    if (v.zoom > MAX_ZOOM) {
      const sx = viewLeft(v) + fx / v.zoom;
      const sy = viewTop(v) + fy / v.zoom;
      this.glideTo(anchoredView(MAX_ZOOM, fx, fy, sx, sy), { fx, fy, sx, sy });
    } else if (v.zoom < SNAP_ZOOM && v.zoom > MIN_ZOOM) {
      this.glideTo(HOME_VIEW);
    }
  }

  /** Schritt um `dt` Sekunden; gibt zurück, ob sich die Ansicht geändert hat. */
  step(dt: number): boolean {
    if (!this.moving) return false;
    if (this.reducedMotion) {
      this.finish();
      return true;
    }
    if (!(dt > 0) || !Number.isFinite(dt)) return false;
    const a = 1 - Math.exp(-dt / this.tau);
    const v = this.view;
    const t = this.target;
    // Zoom logarithmisch: jeder Faktor fühlt sich gleich schnell an.
    const lz = Math.log(v.zoom) + (Math.log(t.zoom) - Math.log(v.zoom)) * a;
    const zoom = Math.exp(lz);
    const an = this.anchor;
    let x: number;
    let y: number;
    if (an) {
      x = an.sx - an.fx / zoom + 0.5 / zoom;
      y = an.sy - an.fy / zoom + 0.5 / zoom;
    } else {
      x = v.x + (t.x - v.x) * a;
      y = v.y + (t.y - v.y) * a;
    }
    v.zoom = clampZoom(zoom, STRETCH_MAX_ZOOM);
    v.x = clampCenter(x, v.zoom);
    v.y = clampCenter(y, v.zoom);
    // Nah genug: einrasten, damit die Ansicht wirklich stillsteht (scharfer Neuaufbau).
    if (Math.abs(lz - Math.log(t.zoom)) < 2e-4 && Math.abs(v.x - t.x) < 2e-5 && Math.abs(v.y - t.y) < 2e-5) this.finish();
    this.revision++;
    return true;
  }

  private finish(): void {
    if (!sameView(this.view, this.target)) this.revision++;
    this.view.zoom = this.target.zoom;
    this.view.x = this.target.x;
    this.view.y = this.target.y;
    this.anchor = null;
  }
}
