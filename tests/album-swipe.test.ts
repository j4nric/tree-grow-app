import { describe, expect, it } from 'vitest';
import {
  SWIPE_EDGE_PX,
  SWIPE_FOLLOW_MAX_DEG,
  SWIPE_MIN_PX,
  endSwipe,
  followAngle,
  moveSwipe,
  startSwipe,
  swipeStartAllowed,
  swipeVelocity,
  type SwipeState,
} from '../src/ui/album/swipe';

/**
 * Wisch-Zurück (docs/ALBUM_UI.md, C.2 und E.1): Schwellen für Weite, Richtung und Tempo;
 * senkrechtes Scrollen löst nie aus; Abbruch.
 */

/** Gleichmäßige Bewegung von (0|0) nach (dx|dy) in `ms`, in Schritten zu 16 ms. */
function drag(dx: number, dy: number, ms: number, x0 = 100, y0 = 300): { state: SwipeState; end: [number, number, number] } {
  let state = startSwipe(x0, y0, 0);
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i < steps; i++) state = moveSwipe(state, x0 + (dx * i) / steps, y0 + (dy * i) / steps, (ms * i) / steps);
  return { state, end: [x0 + dx, y0 + dy, ms] };
}

const swiped = (dx: number, dy: number, ms: number) => {
  const { state, end } = drag(dx, dy, ms);
  return endSwipe(state, ...end);
};

describe('Wisch-Zurück: Erkennung', () => {
  it('Weite: ab 60 px nach rechts, auch langsam', () => {
    expect(swiped(SWIPE_MIN_PX, 0, 1000)).toBe(true);
    expect(swiped(200, 10, 600)).toBe(true);
    expect(swiped(SWIPE_MIN_PX - 5, 0, 1000)).toBe(false);
  });

  it('Tempo: kurzer Wisch reicht, wenn er schneller als 0,5 px/ms ist (ab 20 px)', () => {
    expect(swiped(40, 0, 50)).toBe(true); // 0,8 px/ms
    expect(swiped(40, 0, 100)).toBe(false); // 0,4 px/ms
    expect(swiped(15, 0, 10)).toBe(false); // schnell, aber nur ein Zucken
  });

  it('Tempo zählt am Ende: erst ziehen, dann stehen bleiben löst nicht aus', () => {
    let state = startSwipe(100, 300, 0);
    state = moveSwipe(state, 140, 300, 30);
    // Finger ruht 200 ms.
    state = moveSwipe(state, 145, 300, 230);
    expect(swipeVelocity(state)).toBeLessThan(0.5);
    expect(endSwipe(state, 145, 300, 240)).toBe(false);
  });

  it('Richtung: nur nach rechts und waagerecht mindestens doppelt so weit wie senkrecht', () => {
    expect(swiped(-150, 0, 300)).toBe(false);
    expect(swiped(120, 50, 300)).toBe(true);
    expect(swiped(120, 70, 300)).toBe(false);
    expect(swiped(120, -70, 300)).toBe(false);
  });

  it('senkrechtes Scrollen löst nie aus – auch nicht, wenn der Finger danach waagerecht weiterzieht', () => {
    expect(swiped(0, 400, 300)).toBe(false);
    expect(swiped(30, -400, 100)).toBe(false);
    let state = startSwipe(100, 300, 0);
    state = moveSwipe(state, 102, 320, 16);
    expect(state.phase).toBe('rejected');
    state = moveSwipe(state, 400, 330, 100);
    expect(state.phase).toBe('rejected');
    expect(endSwipe(state, 400, 330, 110)).toBe(false);
  });

  it('Richtung steht erst nach 10 px fest', () => {
    let state = startSwipe(100, 300, 0);
    state = moveSwipe(state, 104, 305, 16);
    expect(state.phase).toBe('pending');
    state = moveSwipe(state, 120, 305, 32);
    expect(state.phase).toBe('tracking');
  });

  it('Abbruch: zurück zum Start gezogen zählt nicht', () => {
    let state = startSwipe(100, 300, 0);
    state = moveSwipe(state, 180, 300, 100);
    state = moveSwipe(state, 110, 300, 300);
    expect(endSwipe(state, 105, 300, 400)).toBe(false);
  });

  it('linker Bildschirmrand gehört dem Browser', () => {
    expect(swipeStartAllowed(0)).toBe(false);
    expect(swipeStartAllowed(SWIPE_EDGE_PX)).toBe(false);
    expect(swipeStartAllowed(SWIPE_EDGE_PX + 1)).toBe(true);
  });
});

describe('Wisch-Zurück: Seite folgt dem Finger', () => {
  it('ohne Perspektive: rechte Kante unter dem Finger (cos θ = dx / Breite)', () => {
    expect(followAngle(0, 400)).toBe(-90);
    expect(followAngle(-30, 400)).toBe(-90);
    expect(Math.cos((followAngle(200, 400) * Math.PI) / 180) * 400).toBeCloseTo(200, 1);
  });

  it('höchstens bis −20°, nie flach', () => {
    expect(followAngle(400, 400)).toBe(SWIPE_FOLLOW_MAX_DEG);
    expect(followAngle(10_000, 400)).toBe(SWIPE_FOLLOW_MAX_DEG);
  });

  it('mit Perspektive: Die zum Betrachter gedrehte Kante liegt trotzdem unter dem Finger', () => {
    const width = 500;
    const p = 700;
    const angle = followAngle(240, width, p);
    const rad = (angle * Math.PI) / 180;
    const projected = (width * Math.cos(rad) * p) / (p + width * Math.sin(rad));
    expect(projected).toBeCloseTo(240, 0);
    // Perspektive dreht weniger weit als ohne.
    expect(angle).toBeLessThan(followAngle(240, width));
  });

  it('wächst mit dem Weg (stetig)', () => {
    let last = -91;
    for (let dx = 0; dx <= 400; dx += 20) {
      const angle = followAngle(dx, 400, 1400);
      expect(angle).toBeGreaterThanOrEqual(last);
      last = angle;
    }
  });
});
