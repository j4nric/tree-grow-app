import { describe, expect, it } from 'vitest';
import { IdleQueue, type IdlePost } from '../src/render/idle';
import {
  ESTIMATE_COLUMNS,
  ESTIMATE_ROW_PX,
  ESTIMATE_TITLE_PX,
  createDeferredReveal,
  deferBlock,
  estimateGridHeight,
  initialGroupCount,
  revealOnFind,
  showBlock,
  supportsHiddenUntilFound,
  type DeferredBlock,
} from '../src/ui/album/pages/deferred-reveal';

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

/** Ersatz für ein HTMLElement: Attribute, Dataset, Stil-Eigenschaften, `beforematch`. */
function fakeBlock() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  const listeners: { fn: () => void; once: boolean }[] = [];
  const block: DeferredBlock & { fire(): void; attrs: Map<string, string>; props: Map<string, string> } = {
    dataset: {} as DOMStringMap,
    style: {
      setProperty: (name: string, value: string | null) => void props.set(name, value ?? ''),
      removeProperty: (name: string) => {
        const old = props.get(name) ?? '';
        props.delete(name);
        return old;
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    getAttribute: (name) => attrs.get(name) ?? null,
    removeAttribute: (name) => void attrs.delete(name),
    addEventListener: (_type, fn, options) => void listeners.push({ fn, once: options?.once === true }),
    fire() {
      // Wie der Browser: erst `beforematch`, dann `hidden` entfernen.
      for (const l of [...listeners]) {
        l.fn();
        if (l.once) listeners.splice(listeners.indexOf(l), 1);
      }
      attrs.delete('hidden');
    },
    attrs,
    props,
  };
  return block;
}

describe('Arten: Seitensuche (hidden="until-found")', () => {
  it('ohne DOM (Tests) gilt die Unterstützung als nicht vorhanden', () => {
    expect(supportsHiddenUntilFound()).toBe(false);
  });

  it('mit Unterstützung: durchsuchbar verborgen, Höhe als Platzhalter', () => {
    const b = fakeBlock();
    deferBlock(b, 301.6, true);
    expect(b.attrs.get('hidden')).toBe('until-found');
    expect(b.dataset.deferred).toBe('until-found');
    expect(b.props.get('--deferred-height')).toBe('302px');
    showBlock(b);
    expect(b.attrs.has('hidden')).toBe(false);
    expect(b.dataset.deferred).toBeUndefined();
    expect(b.props.has('--deferred-height')).toBe(false);
  });

  it('ohne Unterstützung: wie bisher nur die eigene Sperre, kein `hidden`', () => {
    const b = fakeBlock();
    deferBlock(b, 120, false);
    expect(b.attrs.has('hidden')).toBe(false);
    expect(b.dataset.deferred).toBe('');
    expect(b.props.get('--deferred-height')).toBe('120px');
    showBlock(b);
    expect(b.dataset.deferred).toBeUndefined();
  });

  it('ein anderes `hidden` bleibt beim Aufdecken unangetastet', () => {
    const b = fakeBlock();
    deferBlock(b, 50, false);
    b.setAttribute('hidden', '');
    showBlock(b);
    expect(b.attrs.get('hidden')).toBe('');
  });

  it('`beforematch` in einem Block deckt sofort alle auf – auch die davor', () => {
    const { reveal, shown, runIdle } = setup(3);
    const blocks = [fakeBlock(), fakeBlock(), fakeBlock()];
    for (const b of blocks) deferBlock(b, 100, true);
    revealOnFind(blocks, () => reveal.all());
    reveal.start();
    blocks[2]!.fire();
    expect(shown).toEqual([0, 1, 2]);
    expect(reveal.pending).toBe(0);
    while (runIdle()) {
      // geplanter Rückruf findet nichts mehr
    }
    expect(shown).toEqual([0, 1, 2]);
    // Ein zweiter Fund (anderer Block) tut nichts mehr.
    blocks[1]!.fire();
    expect(shown).toEqual([0, 1, 2]);
  });
});
