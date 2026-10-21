import { describe, expect, it, vi } from 'vitest';
import { Camera, HOME_VIEW, MAX_ZOOM, SNAP_ZOOM, STRETCH_MAX_ZOOM } from '../src/render/camera';
import type { AnimalHit } from '../src/render/animals';
import { CameraGestures, DOUBLE_TAP_ZOOM, TAP_SLOP, type GesturePointer } from '../src/ui/camera-gestures';

/** Kamera-Gesten mit Fake-Zeigern (ohne DOM). Canvas 400 × 300 CSS-Pixel. */

const W = 400;
const H = 300;

function setup(hit: AnimalHit | null = null) {
  const camera = new Camera();
  const onAnimalTap = vi.fn();
  const g = new CameraGestures(camera, { hitTest: () => hit, onAnimalTap });
  g.width = W;
  g.height = H;
  let t = 1000;
  const p = (id: number, x: number, y: number, extra: Partial<GesturePointer> = {}): GesturePointer => ({ id, type: 'touch', x, y, t: (t += 16), ...extra });
  const settle = () => {
    for (let i = 0; i < 400 && camera.moving; i++) camera.step(1 / 60);
  };
  return { camera, g, p, settle, onAnimalTap, advance: (ms: number) => (t += ms) };
}

/** Pinch mit zwei Fingern um (200, 150) von Abstand `from` auf `to`. */
function pinch(s: ReturnType<typeof setup>, from: number, to: number, release = true): void {
  const { g, p } = s;
  g.pointerDown(p(1, 200 - from / 2, 150));
  g.pointerDown(p(2, 200 + from / 2, 150));
  for (let i = 1; i <= 8; i++) {
    const d = from + ((to - from) * i) / 8;
    g.pointerMove(p(1, 200 - d / 2, 150));
    g.pointerMove(p(2, 200 + d / 2, 150));
  }
  if (release) {
    g.pointerUp(p(1, 200 - to / 2, 150));
    g.pointerUp(p(2, 200 + to / 2, 150));
  }
}

describe('Kamera-Gesten: Tippen, Ziehen, Pinch', () => {
  it('Tippen auf ein Tier meldet den Treffer; Ziehen (> 6 px) nicht', () => {
    const hit: AnimalHit = { nicheId: 'roots', index: 0, speciesId: 'earthworm', listIndex: 0 };
    const s = setup(hit);
    s.g.pointerDown(s.p(1, 100, 100));
    s.g.pointerUp(s.p(1, 102, 101));
    expect(s.onAnimalTap).toHaveBeenCalledWith(hit);

    s.onAnimalTap.mockClear();
    s.camera.jump({ zoom: 2, x: 0.5, y: 0.5 });
    s.g.pointerDown(s.p(1, 100, 100));
    s.g.pointerMove(s.p(1, 100 + TAP_SLOP + 4, 100));
    s.g.pointerUp(s.p(1, 100, 100));
    expect(s.onAnimalTap).not.toHaveBeenCalled();
  });

  it('Pinch zoomt zum Mittelpunkt; über 4× federt es nach dem Loslassen zurück', () => {
    const s = setup();
    pinch(s, 60, 180);
    s.settle();
    expect(s.camera.view.zoom).toBeCloseTo(3, 6);
    pinch(s, 60, 600, false);
    expect(s.camera.view.zoom).toBeGreaterThan(MAX_ZOOM);
    expect(s.camera.view.zoom).toBeLessThanOrEqual(STRETCH_MAX_ZOOM);
    s.g.pointerUp(s.p(1, 0, 150));
    s.g.pointerUp(s.p(2, 400, 150));
    s.settle();
    expect(s.camera.view.zoom).toBe(MAX_ZOOM);
  });

  it('Doppeltipp zoomt hinein, ein Tipp hält dabei kein Gleiten an', () => {
    const s = setup();
    s.g.pointerDown(s.p(1, 100, 100));
    s.g.pointerUp(s.p(1, 100, 100));
    s.g.pointerDown(s.p(1, 101, 100));
    s.g.pointerUp(s.p(1, 101, 100));
    expect(s.camera.target.zoom).toBe(DOUBLE_TAP_ZOOM);
    s.camera.step(1 / 60);
    // Ein weiterer Tipp mitten im Gleiten: das Ziel bleibt.
    s.advance(1000);
    s.g.pointerDown(s.p(1, 300, 200));
    s.g.pointerUp(s.p(1, 300, 200));
    s.settle();
    expect(s.camera.view.zoom).toBe(DOUBLE_TAP_ZOOM);
  });
});

describe('Kamera-Gesten: nichts bleibt hängen', () => {
  it('Tipp während des Zurückfederns: Zoom landet bei 4× (nicht ~4,3×)', () => {
    const s = setup();
    pinch(s, 60, 600, false);
    s.g.pointerUp(s.p(1, 0, 150));
    s.g.pointerUp(s.p(2, 400, 150));
    s.camera.step(1 / 60); // federt gerade zurück
    expect(s.camera.view.zoom).toBeGreaterThan(MAX_ZOOM);
    s.advance(1000);
    s.g.pointerDown(s.p(3, 200, 150));
    s.g.pointerUp(s.p(3, 200, 150));
    s.settle();
    expect(s.camera.view.zoom).toBe(MAX_ZOOM);
  });

  it('Tipp bei einem Zoom knapp über 1×: rastet auf die ganze Szene ein', () => {
    const s = setup();
    s.camera.jump({ zoom: (1 + SNAP_ZOOM) / 2, x: 0.5, y: 0.5 });
    s.g.pointerDown(s.p(1, 200, 150));
    s.g.pointerUp(s.p(1, 200, 150));
    s.settle();
    expect(s.camera.view).toEqual(HOME_VIEW);
  });

  it('Pinch abgebrochen (verlorenes Capture): Zoom federt zurück, Geste ist beendet', () => {
    const s = setup();
    pinch(s, 60, 600, false);
    s.g.pointerUp(s.p(1, 0, 150), true);
    s.g.pointerUp(s.p(2, 400, 150), true);
    expect(s.g.active).toBe(false);
    expect(s.g.pinched).toBe(false);
    s.settle();
    expect(s.camera.view.zoom).toBe(MAX_ZOOM);
    // Der nächste Finger ist wieder eine Einzelgeste (kein Pinch).
    s.g.pointerDown(s.p(5, 100, 100));
    expect(s.g.pinched).toBe(false);
  });

  it('Maus ohne gedrückte Taste beendet eine hängende Ziehgeste (kein Phantom-Verschieben)', () => {
    const s = setup();
    s.camera.jump({ zoom: 2, x: 0.5, y: 0.5 });
    const mouse = (x: number, y: number, buttons: number, button = 0) => s.p(1, x, y, { type: 'mouse', buttons, button });
    s.g.pointerDown(mouse(200, 150, 1));
    s.g.pointerMove(mouse(240, 150, 1));
    expect(s.g.dragging).toBe(true);
    const x = s.camera.view.x;
    // Das pointerup ging verloren; die Maus bewegt sich ohne Taste weiter.
    expect(s.g.pointerMove(mouse(300, 150, 0))).toBe(false);
    expect(s.g.active).toBe(false);
    expect(s.g.dragging).toBe(false);
    s.g.pointerMove(mouse(380, 150, 0));
    s.settle();
    // Kein weiteres Verschieben (höchstens das Ausgleiten wurde verworfen – abgebrochen).
    expect(s.camera.view.x).toBeCloseTo(x, 9);
  });

  it('rechte Maustaste startet keine Geste', () => {
    const s = setup();
    expect(s.g.pointerDown(s.p(1, 10, 10, { type: 'mouse', button: 2 }))).toBe(false);
    expect(s.g.active).toBe(false);
  });

  it('bei 1× gehört Ziehen der Seite (keine Verschiebung, kein preventDefault)', () => {
    const s = setup();
    s.g.pointerDown(s.p(1, 200, 150));
    expect(s.g.pointerMove(s.p(1, 200, 60))).toBe(false);
    s.g.pointerUp(s.p(1, 200, 60), true);
    expect(s.camera.view).toEqual(HOME_VIEW);
  });
});

describe('Kamera-Gesten: Tasten und Rad', () => {
  it('Tasten zoomen und setzen zurück; Pfeile nur vergrößert; mit Strg nichts', () => {
    const s = setup();
    expect(s.g.key('ArrowLeft')).toBe(false);
    expect(s.g.key('+')).toBe(true);
    s.settle();
    expect(s.camera.view.zoom).toBeCloseTo(1.5, 9);
    expect(s.g.key('ArrowRight')).toBe(true);
    s.settle();
    expect(s.camera.view.x).toBeGreaterThan(0.5);
    expect(s.g.key('+', { ctrl: true })).toBe(false);
    expect(s.g.key('0')).toBe(true);
    s.settle();
    expect(s.camera.view).toEqual(HOME_VIEW);
  });

  it('Rad zoomt zum Zeiger', () => {
    const s = setup();
    s.g.wheel(-300, 0, 0, false);
    s.settle();
    expect(s.camera.view.zoom).toBeGreaterThan(1.5);
    expect(s.camera.view.x).toBeLessThan(0.5);
    expect(s.camera.view.y).toBeLessThan(0.5);
  });
});
