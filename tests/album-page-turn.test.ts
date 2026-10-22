import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNED_AWAY, TURNING, createPageTurn } from '../src/ui/album/page-turn';

/**
 * Umblättern (docs/ALBUM_UI.md, C.3): Zustand nach dem Blättern und Abbruch einer laufenden
 * Drehung durch eine neue (Zurück direkt nach dem Antippen). Ohne DOM: kleine Ersatz-Elemente.
 */

class FakeAnimation {
  cancelled = false;
  private resolve!: () => void;
  finished = new Promise<void>((r) => (this.resolve = r));
  finish(): void {
    this.resolve();
  }
  cancel(): void {
    this.cancelled = true;
  }
}

function fakeElement() {
  const classes = new Set<string>();
  const animations: FakeAnimation[] = [];
  return {
    inert: false,
    hidden: false,
    style: { willChange: '', transformOrigin: '', backfaceVisibility: '' },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    animations,
    animate() {
      const a = new FakeAnimation();
      animations.push(a);
      return a;
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }),
  };
}

type FakeElement = ReturnType<typeof fakeElement>;
const el = (e: FakeElement) => e as unknown as HTMLElement;

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('window', { innerHeight: 800 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageTurn', () => {
  it('vorwärts: vordere Seite weggedreht und nicht bedienbar, Unterseite bedienbar', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    const under = fakeElement();
    under.hidden = true;
    const done = turn.forward(el(front), el(under));
    expect(turn.busy).toBe(true);
    expect(front.inert && under.inert).toBe(true);
    expect(front.classList.contains(TURNING)).toBe(true);
    front.animations[0]!.finish();
    await done;
    expect(turn.busy).toBe(false);
    expect(front.classList.contains(TURNED_AWAY)).toBe(true);
    expect(front.classList.contains(TURNING)).toBe(false);
    expect(front.inert).toBe(true);
    expect(under.hidden).toBe(false);
    expect(under.inert).toBe(false);
  });

  it('Zurück während des Vorwärtsblätterns: die erste Drehung bricht ab und hinterlässt nichts', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    const under = fakeElement();
    under.hidden = true;
    const first = turn.forward(el(front), el(under));
    // Sofort zurück (z. B. Escape direkt nach dem Antippen).
    const second = turn.back(el(front), el(under));
    expect(front.animations[0]!.cancelled).toBe(true);
    await first;
    // Der Abschluss der abgebrochenen Drehung ändert nichts mehr.
    expect(front.classList.contains(TURNED_AWAY)).toBe(false);
    expect(turn.busy).toBe(true);
    front.animations[1]!.finish();
    await second;
    expect(turn.busy).toBe(false);
    expect(front.classList.contains(TURNED_AWAY)).toBe(false);
    expect(front.inert).toBe(false);
    expect(under.hidden).toBe(true);
    expect(under.inert).toBe(false);
  });
});
