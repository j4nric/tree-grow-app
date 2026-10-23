import { describe, expect, it } from 'vitest';
import { SWIPE_CLOSE_PX, flipFrame, isSwipeClose } from '../src/ui/album/fullscreen';

/**
 * FLIP des Vollbilds (docs/ALBUM_UI.md, C.6): Aus Transform und Ausschnitt der Bühne ergibt
 * sich das sichtbare Rechteck auf dem Bildschirm. Es muss beim Öffnen genau auf dem Polaroid
 * beginnen und beim Schließen genau dort enden – sonst springt das Bild.
 */

type Rect = { left: number; top: number; width: number; height: number };

/** Sichtbares Rechteck: Ausschnitt (Bühnen-Koordinaten), skaliert um die Bühnenmitte, verschoben. */
function visibleRect(stage: Rect, frame: { transform: string; clipPath: string }): Rect {
  const t = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(frame.transform)!;
  const c = /inset\(([-\d.]+)px ([-\d.]+)px\)/.exec(frame.clipPath)!;
  const [dx, dy, s] = [Number(t[1]), Number(t[2]), Number(t[3])];
  const [iy, ix] = [Number(c[1]), Number(c[2])];
  const cx = stage.left + stage.width / 2;
  const cy = stage.top + stage.height / 2;
  const map = (x: number, y: number) => ({ x: cx + (x - cx) * s + dx, y: cy + (y - cy) * s + dy });
  const a = map(stage.left + ix, stage.top + iy);
  const b = map(stage.left + stage.width - ix, stage.top + stage.height - iy);
  return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
}

function expectRect(actual: Rect, expected: Rect): void {
  for (const key of ['left', 'top', 'width', 'height'] as const) expect(actual[key]).toBeCloseTo(expected[key], 1);
}

describe('flipFrame', () => {
  const desktop: Rect = { left: 0, top: 0, width: 1200, height: 700 };
  const mobile: Rect = { left: 0, top: 0, width: 390, height: 844 };
  const photoDesk: Rect = { left: 100, top: 122, width: 435, height: 261 };
  const photoMobile: Rect = { left: 24, top: 78, width: 342, height: 230 };

  it('Öffnen beginnt genau auf dem Polaroid (eingepasstes Bild, Desktop und hochkant)', () => {
    for (const [stage, photo] of [
      [desktop, photoDesk],
      [mobile, photoMobile],
    ] as const) {
      // Wie fullscreen.ts: Canvas in Polaroid-Größe, eingepasst skaliert.
      const fit = Math.min(stage.width / photo.width, stage.height / photo.height);
      const frame = flipFrame(stage, photo, 1 / fit, photo.width * fit, photo.height * fit);
      expectRect(visibleRect(stage, frame), photo);
    }
  });

  it('Schließen endet genau auf dem Polaroid (beschnittenes Bild)', () => {
    for (const [stage, photo] of [
      [desktop, photoDesk],
      [mobile, photoMobile],
    ] as const) {
      const cover = Math.max(photo.width / stage.width, photo.height / stage.height);
      const frame = flipFrame(stage, photo, cover, photo.width / cover, photo.height / cover);
      expectRect(visibleRect(stage, frame), photo);
    }
  });

  it('kein negativer Ausschnitt, wenn das Ziel größer ist als die Bühne', () => {
    const frame = flipFrame(mobile, { left: 0, top: 0, width: 800, height: 900 }, 1, 800, 900);
    expect(frame.clipPath).toBe('inset(0.00px 0.00px)');
  });
});

describe('isSwipeClose', () => {
  it('erst ab 80 px nach unten und deutlich senkrecht', () => {
    expect(isSwipeClose(0, SWIPE_CLOSE_PX)).toBe(false);
    expect(isSwipeClose(0, SWIPE_CLOSE_PX + 1)).toBe(true);
    expect(isSwipeClose(40, 120)).toBe(true);
    // zu schräg (waagerecht mehr als halb so weit wie senkrecht)
    expect(isSwipeClose(70, 120)).toBe(false);
    // nach oben nie
    expect(isSwipeClose(0, -200)).toBe(false);
  });
});
