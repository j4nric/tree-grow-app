import { describe, expect, it } from 'vitest';
import { IdleQueue, type IdlePost } from '../src/render/idle';
import { ESTIMATE_COLUMNS, ESTIMATE_ROW_PX, ESTIMATE_TITLE_PX, createDeferredReveal, estimateGridHeight, initialGroupCount } from '../src/ui/album/pages/deferred-reveal';

/**
 * Stückweises Aufdecken des Reiters Arten (deferred-reveal.ts, R3): ein Block je Leerlauf-
 * Rückruf, Pause solange die Seite nicht zu sehen ist, alles auf einmal für Sprungmarken.
 */

function setup(count: number) {
  const pending: (() => void)[] = [];
  const post: IdlePost = (run) => void pending.push(run);
  const queue = new IdleQueue(post);
  const shown: number[] = [];
  let active = true;
  const reveal = createDeferredReveal(count, (i) => shown.push(i), () => active, queue);
  const runIdle = (): boolean => {
    const run = pending.shift();
    if (!run) return false;
    run();
    return true;
  };
  return { reveal, shown, runIdle, pending, setActive: (a: boolean) => (active = a) };
}

describe('Arten: Blöcke stückweise aufdecken', () => {
  it('vor `start` passiert nichts, danach genau ein Block je Leerlauf-Rückruf, in Reihenfolge', () => {
    const { reveal, shown, runIdle, pending } = setup(3);
    expect(pending.length).toBe(0);
    reveal.start();
    reveal.start(); // mehrfach: plant nur einmal
    expect(pending.length).toBe(1);
    expect(runIdle()).toBe(true);
    expect(shown).toEqual([0]);
    expect(reveal.pending).toBe(2);
    runIdle();
    runIdle();
    expect(shown).toEqual([0, 1, 2]);
    expect(reveal.pending).toBe(0);
    expect(runIdle()).toBe(false);
  });

  it('ruht, solange die Seite verborgen ist, und macht beim nächsten `start` weiter', () => {
    const { reveal, shown, runIdle, setActive } = setup(3);
    reveal.start();
    runIdle();
    setActive(false);
    runIdle();
    expect(shown).toEqual([0]);
    expect(runIdle()).toBe(false); // nichts mehr geplant
    setActive(true);
    reveal.start();
    runIdle();
    expect(shown).toEqual([0, 1]);
  });

  it('`all` deckt den Rest sofort auf (Sprungmarke), danach plant nichts mehr', () => {
    const { reveal, shown, runIdle } = setup(4);
    reveal.start();
    runIdle();
    reveal.all();
    expect(shown).toEqual([0, 1, 2, 3]);
    expect(reveal.pending).toBe(0);
    while (runIdle()) {
      // ein schon geplanter Rückruf findet nichts mehr
    }
    expect(shown).toEqual([0, 1, 2, 3]);
    reveal.start();
    expect(runIdle()).toBe(false);
  });

  it('ohne Blöcke: nichts zu tun', () => {
    const { reveal, runIdle } = setup(0);
    reveal.start();
    expect(runIdle()).toBe(false);
    reveal.all();
    expect(reveal.pending).toBe(0);
  });
});

describe('Arten: erster Bildschirm', () => {
  it('so viele Gruppen, bis die Mindestzahl an Zellen erreicht ist – mindestens eine', () => {
    expect(initialGroupCount([8, 10, 11, 6], 18)).toBe(2);
    expect(initialGroupCount([8, 10, 11, 6], 19)).toBe(3);
    expect(initialGroupCount([8, 10], 100)).toBe(2);
    expect(initialGroupCount([20, 10], 5)).toBe(1);
    expect(initialGroupCount([], 18)).toBe(0);
  });
});

describe('Arten: Platzhalter-Höhe gesperrter Blöcke', () => {
  it('Titel plus angefangene Zeilen, nie negativ', () => {
    expect(estimateGridHeight(0)).toBe(ESTIMATE_TITLE_PX);
    expect(estimateGridHeight(-3)).toBe(ESTIMATE_TITLE_PX);
    expect(estimateGridHeight(1)).toBe(ESTIMATE_TITLE_PX + ESTIMATE_ROW_PX);
    expect(estimateGridHeight(ESTIMATE_COLUMNS)).toBe(ESTIMATE_TITLE_PX + ESTIMATE_ROW_PX);
    expect(estimateGridHeight(ESTIMATE_COLUMNS + 1)).toBe(ESTIMATE_TITLE_PX + 2 * ESTIMATE_ROW_PX);
  });
});
