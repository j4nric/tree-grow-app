import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_SETTLE_MS, createAlbumHistory } from '../src/ui/album/history';

/**
 * Verlauf ↔ Album (docs/ALBUM_UI.md, C.2) gegen einen nachgebauten Browser-Verlauf:
 * `history.go/back` melden ihr `popstate` wie im Browser erst später (asynchron).
 */

interface Entry {
  state: unknown;
  url: string;
}

class FakeHistory {
  entries: Entry[] = [{ state: null, url: '/' }];
  index = 0;
  /** Nächste Rücksprünge ohne `popstate` (z. B. vom Browser verschluckt). */
  dropNext = 0;
  constructor(private readonly fire: (state: unknown) => void) {}
  get state(): unknown {
    return this.entries[this.index]!.state;
  }
  get length(): number {
    return this.entries.length;
  }
  pushState(state: unknown, _title: string, url?: string): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ state, url: url ?? this.entries[this.index]!.url });
    this.index++;
  }
  replaceState(state: unknown, _title: string, url?: string): void {
    this.entries[this.index] = { state, url: url ?? this.entries[this.index]!.url };
    location.hash = new URL(this.entries[this.index]!.url, 'http://x').hash;
  }
  go(n: number): void {
    setTimeout(() => {
      this.index = Math.max(0, Math.min(this.entries.length - 1, this.index + n));
      if (this.dropNext > 0) {
        this.dropNext--;
        return;
      }
      this.fire(this.state);
    }, 5);
  }
  back(): void {
    this.go(-1);
  }
}

let fake: FakeHistory;
let listeners: ((event: { state: unknown }) => void)[];

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  vi.stubGlobal('location', { pathname: '/', search: '', hash: '' });
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: { state: unknown }) => void) => {
      if (type === 'popstate') listeners.push(listener);
    },
  });
  fake = new FakeHistory((state) => listeners.forEach((l) => l({ state })));
  vi.stubGlobal('history', fake);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Album-Verlauf', () => {
  it('neue Ebenen legen Einträge an; Browser-Zurück meldet die neue Tiefe', async () => {
    const onBack = vi.fn();
    const h = createAlbumHistory({ onBack });
    h.sync(2);
    expect(fake.length).toBe(3);
    expect(fake.state).toEqual({ album: 2 });
    h.back();
    expect(onBack).not.toHaveBeenCalled(); // erst mit dem popstate
    await vi.advanceTimersByTimeAsync(10);
    expect(onBack).toHaveBeenCalledWith(1);
    expect(h.depth).toBe(1);
  });

  it('Doppelklick aufs Lesezeichen: nur ein Schritt zurück, die App bleibt', async () => {
    const onBack = vi.fn();
    const h = createAlbumHistory({ onBack });
    h.sync(1);
    h.back();
    h.back();
    await vi.advanceTimersByTimeAsync(20);
    expect(fake.index).toBe(1 - 1);
    expect(onBack).toHaveBeenCalledTimes(1);
    // Auf Tiefe 0 geht back() gar nicht mehr in den Verlauf (sonst verließe es die App).
    h.back();
    await vi.advanceTimersByTimeAsync(20);
    expect(fake.index).toBe(0);
  });

  it('Zurückspulen ist still, der Hash kommt danach auf den Grundeintrag, Vorgemerktes folgt', async () => {
    const onBack = vi.fn();
    const h = createAlbumHistory({ onBack });
    h.sync(2);
    h.sync(0); // z. B. Reiterwechsel bei offener Unterseite
    h.setHash('#ziele');
    h.sync(1); // gleich danach eine neue Unterseite
    expect(fake.entries[2]!.url).not.toContain('#ziele');
    await vi.advanceTimersByTimeAsync(10);
    expect(onBack).not.toHaveBeenCalled();
    expect(fake.entries[0]!.url).toBe('/#ziele');
    expect(h.depth).toBe(1);
    expect(fake.index).toBe(1);
    expect(fake.state).toEqual({ album: 1 });
  });

  it('bleibt das popstate aus, löst das Sicherheitsnetz den Rücksprung auf', async () => {
    const onBack = vi.fn();
    const h = createAlbumHistory({ onBack });
    h.sync(2);
    fake.dropNext = 1;
    h.sync(0);
    h.setHash('#arten');
    await vi.advanceTimersByTimeAsync(10);
    // Hängt noch: weitere Ebenen werden vorgemerkt …
    h.sync(1);
    await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS);
    // … und nach dem Sicherheitsnetz mit der Tiefe aus dem Verlauf nachgeholt.
    expect(fake.entries[0]!.url).toBe('/#arten');
    expect(h.depth).toBe(1);
    expect(fake.state).toEqual({ album: 1 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('nach einem verschluckten Zurück geht back() wieder', async () => {
    const onBack = vi.fn();
    const h = createAlbumHistory({ onBack });
    h.sync(1);
    fake.dropNext = 1;
    h.back();
    await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS + 10);
    fake.pushState({ album: 1 }, '');
    h.back();
    await vi.advanceTimersByTimeAsync(10);
    expect(onBack).toHaveBeenCalledWith(0);
  });

  it('Neuladen auf einer Unterseite: Tiefe 0, nichts wird wiederhergestellt', () => {
    fake.replaceState({ album: 2 }, '');
    const h = createAlbumHistory({ onBack: vi.fn() });
    expect(h.depth).toBe(0);
    expect(fake.state).toEqual({ album: 0 });
  });

  it('Hash wird ersetzt, nicht angehängt', () => {
    const h = createAlbumHistory({ onBack: vi.fn() });
    h.setHash('#pflege');
    h.setHash('#ziele');
    expect(fake.length).toBe(1);
    expect(fake.entries[0]!.url).toBe('/#ziele');
  });
});
