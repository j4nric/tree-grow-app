import { describe, expect, it } from 'vitest';
import { EVENTS } from '../src/content/events';
import { VISITORS } from '../src/content/visitors';
import { stackIcon } from '../src/ui/encounter-stack';

/** Symbol auf dem Begegnungs-Stapel (Playtest Phase 6, K3): je Ereignis und Gast das eigene. */
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
