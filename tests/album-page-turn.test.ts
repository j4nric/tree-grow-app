import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_MS, TURNED_AWAY, TURNING, createPageTurn } from '../src/ui/album/page-turn';

/**
 * Umblättern (docs/ALBUM_UI.md, C.3): Zustand nach dem Blättern und Abbruch einer laufenden
 * Drehung durch eine neue (Zurück direkt nach dem Antippen). Ohne DOM: kleine Ersatz-Elemente.
 */

class FakeAnimation {
  constructor(
    readonly frames: Keyframe[] = [],
    readonly options: KeyframeAnimationOptions = {},
  ) {}
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
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    inert: false,
    hidden: false,
    style: { willChange: '', transformOrigin: '', backfaceVisibility: '', transform: '', clipPath: '' },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    animations,
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const a = new FakeAnimation(frames, options);
      animations.push(a);
      return a;
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800, width: 400 }),
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    /** Ziele mit `inside: true` liegen auf dieser Seite. */
    contains: (node: unknown) => (node as { inside?: boolean } | null)?.inside === true,
    /** Eingabe auf der Seite: `true`, wenn sie durchkommt (nicht abgefangen). */
    input(type: string, target?: unknown): boolean {
      let stopped = false;
      const event = { type, target, cancelable: true, stopPropagation: () => (stopped = true), preventDefault: () => undefined } as unknown as Event;
      for (const listener of listeners.get(type) ?? []) listener(event);
      return !stopped;
    },
  };
}


type FakeElement = ReturnType<typeof fakeElement>;
const el = (e: FakeElement) => e as unknown as HTMLElement;

/** Lauscher am Dokument (Capture), z. B. für Klicks außerhalb der drehenden Seite. */
const docListeners = new Map<string, Set<(event: Event) => void>>();
/** Klick irgendwo im Dokument (nach den Lauschern der Seite). */
function documentClick(target: unknown): void {
  const event = { type: 'click', target } as unknown as Event;
  for (const listener of docListeners.get('click') ?? []) listener(event);
}

beforeEach(() => {
  docListeners.clear();
  vi.stubGlobal('document', {
    documentElement: {},
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      docListeners.get(type)?.delete(listener);
    },
  });
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
    expect(under.inert).toBe(true);
    // Die drehende Seite bekommt `inert` erst am Ende (S9); bis dahin fängt sie Eingaben ab.
    expect(front.inert).toBe(false);
    expect(front.input('click')).toBe(false);
    expect(front.input('pointerdown')).toBe(false);
    expect(front.classList.contains(TURNING)).toBe(true);
    expect(front.animations).toHaveLength(1);
    expect(front.style.willChange).toBe('transform');
    front.animations[0]!.finish();
    await done;
    expect(turn.busy).toBe(false);
    expect(front.classList.contains(TURNED_AWAY)).toBe(true);
    expect(front.classList.contains(TURNING)).toBe(false);
    expect(front.inert).toBe(true);
    expect(front.input('click')).toBe(true);
    expect(under.hidden).toBe(false);
    expect(under.inert).toBe(false);
  });

  it('zurück: die vordere Seite verliert `inert` gleich am Anfang, Eingaben bleiben gesperrt', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    front.classList.add(TURNED_AWAY);
    front.inert = true;
    const under = fakeElement();
    const done = turn.back(el(front), el(under));
    expect(front.inert).toBe(false);
    expect(front.classList.contains(TURNED_AWAY)).toBe(false);
    expect(front.input('click')).toBe(false);
    expect(under.inert).toBe(true);
    front.animations[0]!.finish();
    await done;
    expect(front.input('click')).toBe(true);
    expect(front.inert).toBe(false);
    expect(under.hidden).toBe(true);
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

  it('Klick während des Zurückblätterns wird vorgemerkt und danach ausgelöst, vorwärts verfällt er', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const target = { inside: true, isConnected: true, clicks: 0, focused: 0, closest: () => null, focus() { this.focused++; }, click() { this.clicks++; } };
    const front = fakeElement();
    front.classList.add(TURNED_AWAY);
    front.inert = true;
    const under = fakeElement();
    const back = turn.back(el(front), el(under));
    expect(front.input('click', target)).toBe(false);
    documentClick(target);
    front.animations[0]!.finish();
    await back;
    expect(target.clicks).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(target.clicks).toBe(1);
    // Vor dem Klick fokussiert: Das Album merkt sich so den richtigen Auslöser fürs Zurück.
    expect(target.focused).toBe(1);
    // Vorwärts: Die Seite ist danach weggedreht und `inert` – der Klick verfällt.
    const away = { ...target, clicks: 0, closest: () => ({}), click() { this.clicks++; } };
    const forward = turn.forward(el(front), el(under));
    front.input('click', away);
    front.animations[1]!.finish();
    await forward;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(away.clicks).toBe(0);
  });

  it('späterer Klick außerhalb der drehenden Seite gewinnt: nichts wird nachgeholt', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const target = { inside: true, isConnected: true, clicks: 0, closest: () => null, focus() {}, click() { this.clicks++; } };
    const front = fakeElement();
    front.classList.add(TURNED_AWAY);
    front.inert = true;
    const back = turn.back(el(front), el(fakeElement()));
    front.input('click', target);
    documentClick(target);
    documentClick({ inside: false }); // z. B. Umschlag-Knopf im Kopf
    front.animations[0]!.finish();
    await back;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(target.clicks).toBe(0);
    expect(docListeners.get('click')?.size ?? 0).toBe(0);
  });

  it('pointerup wird während der Drehung nicht angehalten (Gesten sehen das Ende der Berührung)', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    const forward = turn.forward(el(front), el(fakeElement()));
    expect(front.input('pointerdown')).toBe(false);
    expect(front.input('pointerup')).toBe(true);
    front.animations[0]!.finish();
    await forward;
  });

  it('lange, gescrollte Seite: Achse in der Mitte des sichtbaren Teils, Zuschnitt auf ihn', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    // 3 000 px hoch, 500 px nach oben gescrollt; Fenster 800 px.
    front.getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, width: 400 });
    const under = fakeElement();
    const done = turn.forward(el(front), el(under));
    expect(front.style.transformOrigin).toBe('0 900px');
    expect(front.style.clipPath).toBe('inset(500px -120px 1700px -120px)');
    front.animations[0]!.finish();
    await done;
    expect(front.style.clipPath).toBe('');
    expect(front.style.transformOrigin).toBe('');
  });

  it('ganz sichtbare Seite: kein Zuschnitt', async () => {
    const turn = createPageTurn({ reducedMotion: () => false });
    const front = fakeElement();
    const under = fakeElement();
    const done = turn.forward(el(front), el(under));
    expect(front.style.clipPath).toBe('');
    front.animations[0]!.finish();
    await done;
  });

  describe('drag (Wisch-Zurück)', () => {
    /** Weggedrehte Seite wie nach dem Vorwärtsblättern. */
    function awayPage(): FakeElement {
      const front = fakeElement();
      front.classList.add(TURNED_AWAY);
      front.inert = true;
      return front;
    }

    it('zeigt die weggedrehte Seite, folgt dem Winkel und schnappt beim Abbruch zurück', async () => {
      const turn = createPageTurn({ reducedMotion: () => false });
      const front = awayPage();
      const drag = turn.drag(el(front))!;
      expect(drag.width).toBe(400);
      expect(front.classList.contains(TURNED_AWAY)).toBe(false);
      expect(front.classList.contains(TURNING)).toBe(true);
      expect(front.inert).toBe(true);
      drag.set(-60);
      expect(front.style.transform).toContain('rotateY(-60deg)');
      // Nicht über flach hinaus.
      drag.set(15);
      expect(front.style.transform).toContain('rotateY(0deg)');
      drag.release(false);
      expect(turn.busy).toBe(false);
      front.animations[0]!.finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(front.classList.contains(TURNED_AWAY)).toBe(true);
      expect(front.classList.contains(TURNING)).toBe(false);
      expect(front.style.transform).toBe('');
      expect(front.style.willChange).toBe('');
    });

    it('nach dem Loslassen blättert back() vom gezogenen Winkel aus zu Ende (kürzer)', async () => {
      const turn = createPageTurn({ reducedMotion: () => false });
      const front = awayPage();
      const under = fakeElement();
      const drag = turn.drag(el(front))!;
      drag.set(-40);
      drag.release(true);
      // Die Seite bleibt stehen, bis back() kommt.
      expect(front.style.transform).toContain('rotateY(-40deg)');
      const done = turn.back(el(front), el(under));
      const animation = front.animations[0]!;
      expect(String(animation.frames[0]!.transform)).toContain('rotateY(-40deg)');
      expect(String(animation.frames[1]!.transform)).toContain('rotateY(0deg)');
      expect(Number(animation.options.duration)).toBeLessThan(380);
      animation.finish();
      await done;
      expect(front.classList.contains(TURNED_AWAY)).toBe(false);
      expect(front.inert).toBe(false);
      expect(under.hidden).toBe(true);
      expect(front.style.transform).toBe('');
    });

    it('kommt nach dem Loslassen kein back(), schnappt die Seite zurück', () => {
      vi.useFakeTimers();
      try {
        const turn = createPageTurn({ reducedMotion: () => false });
        const front = awayPage();
        const drag = turn.drag(el(front))!;
        drag.set(-50);
        drag.release(true);
        vi.advanceTimersByTime(HELD_MS + 1000);
        expect(front.classList.contains(TURNED_AWAY)).toBe(true);
        expect(front.classList.contains(TURNING)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('während einer Drehung gibt es kein Mitführen; eine neue Drehung beendet es', async () => {
      const turn = createPageTurn({ reducedMotion: () => false });
      const page = fakeElement();
      const under = fakeElement();
      const turning = turn.forward(el(page), el(under));
      expect(turn.drag(el(fakeElement()))).toBeNull();
      page.animations[0]!.finish();
      await turning;
      const other = awayPage();
      const drag = turn.drag(el(other))!;
      drag.set(-30);
      // Ein Reiterwechsel o. Ä. blättert dazwischen: Die gezogene Seite liegt wieder weggedreht.
      const next = turn.forward(el(page), el(under));
      expect(other.classList.contains(TURNED_AWAY)).toBe(true);
      expect(other.style.transform).toBe('');
      drag.set(-10);
      expect(other.style.transform).toBe('');
      page.animations[1]!.finish();
      await next;
    });
  });
});
