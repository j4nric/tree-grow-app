import { describe, expect, it } from 'vitest';
import { EVENTS } from '../src/content/events';
import { VISITORS } from '../src/content/visitors';
import { stackCountText, stackHeadline, stackIcon, stackLayers, stackText } from '../src/ui/album/note-stack-view';

/** Zettelstapel der Begegnungen (docs/ALBUM_UI.md, C.7; Symbol: Playtest Phase 6, K3). */
describe('stackIcon', () => {
  it('Ereignisse und Gäste zeigen ihr Symbol aus content', () => {
    for (const e of EVENTS) expect(stackIcon({ type: 'event', cards: [e.id] }), e.id).toBe(e.icon);
    for (const v of VISITORS) expect(stackIcon({ type: 'visitor', cards: [v.id] }), v.id).toBe(v.icon);
    expect(stackIcon({ type: 'event', cards: ['storm'] })).toBe('🌩️');
    expect(stackIcon({ type: 'event', cards: ['bee-swarm'] })).toBe('🐝');
  });

  it('Tiere, Pflanzen und Unbekanntes: Symbol der Art der Begegnung', () => {
    expect(stackIcon({ type: 'animal', cards: ['earthworm'] })).toBe('🐾');
    expect(stackIcon({ type: 'plant', cards: ['fern'] })).toBe('🌱');
    expect(stackIcon({ type: 'event', cards: ['gibt-es-nicht'] })).toBe('⛈️');
    expect(stackIcon({ type: 'visitor', cards: [] })).toBe('🦢');
    expect(stackIcon(undefined)).toBe('🐾');
  });
});

describe('Text des Zettelstapels', () => {
  it('„2 Zettel: Besuch wartet!“ bei Tieren, „Etwas keimt!“ bei Pflanzen', () => {
    expect(stackText(2, { type: 'animal', cards: ['earthworm'] })).toBe('2 Zettel: Besuch wartet!');
    expect(stackText(1, { type: 'plant', cards: ['fern'] })).toBe('1 Zettel: Etwas keimt!');
    expect(stackText(3, undefined)).toBe('3 Zettel: Besuch wartet!');
  });

  it('Ereignisse und Gäste mit ihrem Namen aus content', () => {
    expect(stackHeadline({ type: 'event', cards: ['storm'] })).toBe('Sturmnacht!');
    expect(stackHeadline({ type: 'visitor', cards: ['cranes'] })).toBe('Kranichzug!');
    for (const e of EVENTS) expect(stackHeadline({ type: 'event', cards: [e.id] })).toBe(`${e.name}!`);
    // Unbekannte IDs (älterer Stand): Ersatztext statt „undefined!“.
    expect(stackHeadline({ type: 'event', cards: ['gibt-es-nicht'] })).toBe('Ein Ereignis!');
    expect(stackHeadline({ type: 'visitor', cards: [] })).toBe('Besuch auf der Durchreise!');
  });

  it('Zahl im deutschen Format, nie negativ', () => {
    expect(stackCountText(1)).toBe('1 Zettel:');
    expect(stackCountText(1200)).toBe('1.200 Zettel:');
    expect(stackCountText(-2)).toBe('0 Zettel:');
  });

  it('Schatten deutet höchstens drei Zettel an', () => {
    expect([0, 1, 2, 3, 7].map(stackLayers)).toEqual([1, 1, 2, 3, 3]);
  });
});
