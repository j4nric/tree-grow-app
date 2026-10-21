import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anchoredView,
  Camera,
  clampView,
  HOME_VIEW,
  MAX_ZOOM,
  panView,
  sceneToScreen,
  screenToScene,
  SNAP_ZOOM,
  STRETCH_MAX_ZOOM,
  stretchZoom,
  viewLeft,
  viewTop,
  zoomAt,
  type CameraView,
} from '../src/render/camera';
import { nicheAnchors } from '../src/render/anchors';
import { RESIZE_SETTLE_SECONDS } from '../src/render/resize';
import { drawScene, hitTestAnimal, type SceneAnimal } from '../src/render/tree';

/** Kein Leerraum: Der Ausschnitt liegt ganz in der Szene (Anteile 0–1). */
function expectInside(v: CameraView): void {
  const w = 1 / v.zoom;
  expect(viewLeft(v)).toBeGreaterThanOrEqual(-1e-12);
  expect(viewTop(v)).toBeGreaterThanOrEqual(-1e-12);
  expect(viewLeft(v) + w).toBeLessThanOrEqual(1 + 1e-12);
  expect(viewTop(v) + w).toBeLessThanOrEqual(1 + 1e-12);
}

describe('Kamera: Grenzen', () => {
  it('bei 1× keine Verschiebung möglich', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [0.2, 0.9],
      [-5, 7],
    ]) {
      expect(clampView({ zoom: 1, x: x!, y: y! })).toEqual(HOME_VIEW);
    }
    expect(panView(HOME_VIEW, 0.5, -0.3)).toEqual(HOME_VIEW);
  });

  it('bei allen Zoomstufen bleibt der Ausschnitt in der Szene', () => {
    for (const zoom of [1, 1.01, 1.5, 2, 3, 3.99, 4, 7, 0.5, -1, Number.NaN]) {
      for (const x of [-1, 0, 0.1, 0.5, 0.9, 1, 2, Number.NaN]) {
        for (const y of [-1, 0, 0.5, 1, 3]) {
          const v = clampView({ zoom, x, y });
          expect(v.zoom).toBeGreaterThanOrEqual(1);
          expect(v.zoom).toBeLessThanOrEqual(MAX_ZOOM);
          expectInside(v);
        }
      }
    }
  });

  it('Verschieben stößt an allen Seiten an den Rand', () => {
    const v = { zoom: 2, x: 0.5, y: 0.5 };
    expect(viewLeft(panView(v, 10, 0))).toBeCloseTo(0, 12);
    expect(viewLeft(panView(v, -10, 0)) + 0.5).toBeCloseTo(1, 12);
    expect(viewTop(panView(v, 0, 10))).toBeCloseTo(0, 12);
    expect(viewTop(panView(v, 0, -10)) + 0.5).toBeCloseTo(1, 12);
  });

  it('ungültige Werte werden zur ganzen Szene', () => {
    expect(clampView({ zoom: Number.NaN, x: Number.NaN, y: Infinity })).toEqual(HOME_VIEW);
  });
});

describe('Kamera: Zoom zum Punkt und Rückrechnung', () => {
  it('der Punkt unter dem Zeiger bleibt stehen (wenn die Grenzen es erlauben)', () => {
    const v0 = { zoom: 1.5, x: 0.5, y: 0.5 };
    const W = 800;
    const H = 500;
    const px = 300;
    const py = 260;
    const before = screenToScene(v0, W, H, px, py);
    const v1 = zoomAt(v0, 3, px / W, py / H);
    const after = screenToScene(v1, W, H, px, py);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('am Rand gewinnt die Grenze (kein Leerraum)', () => {
    const v = zoomAt(HOME_VIEW, 4, 0, 0);
    expectInside(v);
    expect(viewLeft(v)).toBeCloseTo(0, 12);
    expect(viewTop(v)).toBeCloseTo(0, 12);
  });

  it('Bildschirm ↔ Szene sind zueinander invers', () => {
    for (const v of [HOME_VIEW, { zoom: 2, x: 0.3, y: 0.7 }, clampView({ zoom: 4, x: 0.9, y: 0.1 })]) {
      for (const [x, y] of [
        [0, 0],
        [123.4, 56.7],
        [640, 480],
      ]) {
        const s = screenToScene(v, 640, 480, x!, y!);
        const b = sceneToScreen(v, 640, 480, s.x, s.y);
        expect(b.x).toBeCloseTo(x!, 9);
        expect(b.y).toBeCloseTo(y!, 9);
      }
    }
    // Bei 1× ist Bildschirm = Szene.
    expect(screenToScene(HOME_VIEW, 640, 480, 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it('anchoredView: Pinch-Mittelpunkt hält den Szenenpunkt', () => {
    const v = anchoredView(2.5, 0.4, 0.6, 0.45, 0.55);
    expect(viewLeft(v) + 0.4 / v.zoom).toBeCloseTo(0.45, 12);
    expect(viewTop(v) + 0.6 / v.zoom).toBeCloseTo(0.55, 12);
  });
});

describe('Kamera: Gleiten', () => {
  it('gleitet weich zum Ziel und rastet dort ein', () => {
    const cam = new Camera();
    cam.zoomBy(2, 0.3, 0.6);
    expect(cam.moving).toBe(true);
    const zooms: number[] = [];
    for (let i = 0; i < 120 && cam.moving; i++) {
      cam.step(1 / 60);
      zooms.push(cam.view.zoom);
      expectInside(cam.view);
    }
    expect(cam.moving).toBe(false);
    expect(cam.view).toEqual(cam.target);
    expect(cam.view.zoom).toBe(2);
    // Stetig wachsend, ohne Überschwingen.
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]!);
    expect(zooms.length).toBeGreaterThan(5);
  });

  it('beim gleitenden Zoom bleibt der Punkt unter dem Zeiger stehen', () => {
    const cam = new Camera({ zoom: 1.5, x: 0.5, y: 0.5 });
    const fx = 0.35;
    const fy = 0.45;
    const s = viewLeft(cam.view) + fx / cam.view.zoom;
    cam.zoomBy(2, fx, fy);
    for (let i = 0; i < 10; i++) {
      cam.step(1 / 60);
      expect(viewLeft(cam.view) + fx / cam.view.zoom).toBeCloseTo(s, 9);
    }
  });

  it('reduzierte Bewegung: Ziele sofort, kein Ausgleiten', () => {
    const cam = new Camera();
    cam.reducedMotion = true;
    cam.zoomBy(2);
    expect(cam.moving).toBe(false);
    expect(cam.view.zoom).toBe(2);
    const before = { ...cam.view };
    cam.fling(5, 5);
    expect(cam.view).toEqual(before);
    expect(cam.moving).toBe(false);
    cam.reset();
    expect(cam.view).toEqual(HOME_VIEW);
  });

  it('ein Wisch gleitet aus und bremst vor dem Rand weich ab', () => {
    const cam = new Camera({ zoom: 3, x: 0.5, y: 0.5 });
    cam.fling(-20, 0); // kräftig nach links wischen → Ausschnitt wandert nach rechts
    let last = cam.view.x;
    let lastStep = Infinity;
    for (let i = 0; i < 300 && cam.moving; i++) {
      cam.step(1 / 60);
      expectInside(cam.view);
      const stepSize = cam.view.x - last;
      expect(stepSize).toBeGreaterThanOrEqual(0);
      // Abbremsen: Schritte werden kleiner (bis auf das Einrasten im letzten Schritt, unter einem Pixel).
      if (cam.moving) expect(stepSize).toBeLessThanOrEqual(lastStep + 1e-12);
      else expect(stepSize).toBeLessThan(4e-5);
      lastStep = stepSize;
      last = cam.view.x;
    }
    expect(viewLeft(cam.view) + 1 / 3).toBeCloseTo(1, 9);
  });

  it('Pinch über den Höchstzoom: gibt nach und federt zurück', () => {
    expect(stretchZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(stretchZoom(MAX_ZOOM * 1.001)).toBeCloseTo(MAX_ZOOM * 1.001, 3);
    expect(stretchZoom(100)).toBeLessThanOrEqual(STRETCH_MAX_ZOOM);
    expect(stretchZoom(0.3)).toBe(1);
    const cam = new Camera();
    cam.jump({ zoom: stretchZoom(6), x: 0.5, y: 0.5 }, STRETCH_MAX_ZOOM);
    expect(cam.view.zoom).toBeGreaterThan(MAX_ZOOM);
    cam.settle();
    for (let i = 0; i < 200 && cam.moving; i++) cam.step(1 / 60);
    expect(cam.view.zoom).toBe(MAX_ZOOM);
  });

  it('knapp über 1× rastet nach der Geste auf die ganze Szene ein', () => {
    const cam = new Camera({ zoom: (1 + SNAP_ZOOM) / 2, x: 0.5, y: 0.5 });
    cam.settle();
    for (let i = 0; i < 200 && cam.moving; i++) cam.step(1 / 60);
    expect(cam.view).toEqual(HOME_VIEW);
    // Deutlich vergrößert bleibt es dabei.
    const cam2 = new Camera({ zoom: 2, x: 0.5, y: 0.5 });
    cam2.settle();
    expect(cam2.moving).toBe(false);
  });

  it('Tastatur: Verschieben gleitet und bleibt in den Grenzen', () => {
    const cam = new Camera({ zoom: 2, x: 0.5, y: 0.5 });
    for (let k = 0; k < 10; k++) cam.panBy(-0.15, 0);
    for (let i = 0; i < 200 && cam.moving; i++) cam.step(1 / 60);
    expectInside(cam.view);
    expect(viewLeft(cam.view) + 0.5).toBeCloseTo(1, 9);
  });
});

describe('Treffer-Test für Tiere', () => {
  const W = 900;
  const H = 600;
  const G = 4.5;
  const ANIMALS: SceneAnimal[] = [
    { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 1 },
    { id: 'bluetit', family: 'birds', niche: 'crown', slot: 1, happiness: 1 },
    { id: 'earthworm', family: 'soil', niche: 'roots', slot: 0, happiness: 1 },
  ];
  const scene = { width: W, height: H, growth: G, time: 3, animals: ANIMALS, reducedMotion: true };
  const anchors = nicheAnchors(W, H, G, 4);

  it('trifft ein Tier an seinem Ankerpunkt – Nische, Platz, Art und Listenposition', () => {
    const a = anchors.crown[1]!;
    const hit = hitTestAnimal(scene, null, a.x, a.y - 4);
    expect(hit).toEqual({ nicheId: 'crown', index: 1, speciesId: 'bluetit', listIndex: 1 });
    const r = anchors.litter[0]!;
    expect(hitTestAnimal(scene, null, r.x, r.y - 6)?.speciesId).toBe('robin');
  });

  it('daneben (Himmel) ist kein Treffer; ohne Tiere nie', () => {
    expect(hitTestAnimal(scene, null, 5, 5)).toBeNull();
    expect(hitTestAnimal({ ...scene, animals: [] }, null, anchors.crown[1]!.x, anchors.crown[1]!.y)).toBeNull();
    expect(hitTestAnimal(scene, null, Number.NaN, 3)).toBeNull();
  });

  it('rechnet über die Kamera zurück', () => {
    const a = anchors.roots[0]!;
    const cam = clampView({ zoom: 3, x: a.x / W, y: a.y / H });
    const p = sceneToScreen(cam, W, H, a.x, a.y);
    expect(hitTestAnimal(scene, cam, p.x, p.y)?.speciesId).toBe('earthworm');
    // Derselbe Bildschirmpunkt ohne Kamera zeigt etwas anderes.
    const off = sceneToScreen(cam, W, H, a.x + 200, a.y - 250);
    expect(hitTestAnimal(scene, cam, off.x, off.y)).toBeNull();
  });

  it('gleiche Eingabe → gleiches Ergebnis (stabil)', () => {
    const a = anchors.crown[1]!;
    const moving = { ...scene, reducedMotion: false, time: 12.3 };
    expect(hitTestAnimal(moving, null, a.x, a.y)).toEqual(hitTestAnimal(moving, null, a.x, a.y));
  });
});

// --- drawScene mit Kamera (Canvas-Stub wie in render-scene.test.ts) ---------------------

interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

let created = 0;

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop() {}, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.calls.push({ name: String(prop), args });
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

describe('drawScene mit Kamera', () => {
  beforeEach(() => {
    created = 0;
    vi.stubGlobal('document', {
      createElement: () => {
        created++;
        return makeCanvas();
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const animals: SceneAnimal[] = [{ id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 1 }];

  function frame(canvas: StubCanvas, time: number, camera?: CameraView): number[] {
    canvas.calls.length = 0;
    drawScene(canvas.getContext('2d'), 400, 300, { growth: 4, time, animals, sizeSettled: true, camera });
    const t = canvas.calls.find((c) => c.name === 'setTransform');
    return t ? (t.args as number[]) : [];
  }

  it('ohne Kamera und bei 1× wie bisher (Skalierung 1, keine Verschiebung)', () => {
    const canvas = makeCanvas(800, 600);
    expect(frame(canvas, 1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(frame(canvas, 2, HOME_VIEW)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('bewegte Kamera: Basis skaliert; ruhend: scharfe Detail-Ebenen ohne Skalierung', () => {
    const canvas = makeCanvas(800, 600);
    frame(canvas, 1);
    const cam = { zoom: 2, x: 0.25, y: 0.75 };
    // Erster Frame mit Zoom: Basis 2× vergrößert, Ausschnitt links unten.
    const scaled = frame(canvas, 1.016, cam);
    expect(scaled[0]).toBe(2);
    expect(scaled[3]).toBe(2);
    expect(scaled[4]).toBeCloseTo(0, 9);
    expect(scaled[5]).toBeCloseTo(-600, 9);
    // Nach der Ruhezeit: Detail-Ebenen, 1:1 kopiert.
    const before = created;
    const sharp = frame(canvas, 1.02 + RESIZE_SETTLE_SECONDS, cam);
    expect(created).toBeGreaterThan(before);
    // 1:1, nur um den Wind-Rand (ganze Pixel) nach links versetzt.
    expect(sharp.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(Number.isInteger(sharp[4])).toBe(true);
    expect(sharp[4]).toBeLessThan(0);
    expect(sharp[5]).toBe(0);
    // Weiter hineinzoomen im selben Bereich: vorhandene Detail-Ebenen skaliert (deckt ab).
    const inner = frame(canvas, 1.3, { zoom: 3, x: 0.25, y: 0.75 });
    expect(inner[0]).toBeCloseTo(1.5, 12);
    // Herauszoomen auf 1×: zurück zur Basis.
    expect(frame(canvas, 1.4, HOME_VIEW)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('Wechsel Detail ↔ Basis legt keine Sprites oder alten Wald neu an', () => {
    const canvas = makeCanvas(800, 600);
    const many: SceneAnimal[] = [
      ...animals,
      { id: 'bluetit', family: 'birds', niche: 'crown', slot: 0, happiness: 1 },
      { id: 'earthworm', family: 'soil', niche: 'roots', slot: 0, happiness: 1 },
    ];
    const draw = (time: number, camera?: CameraView) => {
      canvas.calls.length = 0;
      drawScene(canvas.getContext('2d'), 400, 300, {
        growth: 4,
        time,
        animals: many,
        sizeSettled: true,
        camera,
        // Ohne Bewegung: keine neuen Einzelbilder der Tiere zwischen den Frames.
        reducedMotion: true,
        cycleTransition: { startedAt: 1, fromGrowth: 5 },
      });
    };
    const cam = { zoom: 2, x: 0.4, y: 0.6 };
    draw(1);
    draw(1.02, cam); // Geste: Basis skaliert
    draw(1.03 + RESIZE_SETTLE_SECONDS, cam); // Ruhe: Detail-Ebenen + Sprites der Stufe ×2
    draw(1.3, cam);
    // Neue Geste (Basis), dann wieder Ruhe am alten Ort (Detail deckt ab): nichts Neues.
    const before = created;
    draw(1.32, { zoom: 2, x: 0.41, y: 0.6 });
    draw(1.34, cam);
    draw(1.36, cam);
    expect(created).toBe(before);
  });

  it('ungültige Kamera zeichnet die ganze Szene', () => {
    const canvas = makeCanvas(800, 600);
    expect(frame(canvas, 1, { zoom: Number.NaN, x: 3, y: -2 })).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
