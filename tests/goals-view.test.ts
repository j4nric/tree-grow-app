import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { ANCIENT_STAGE } from '../src/core/landscape';
import {
  achievementsLinkView,
  goalsPageMeta,
  goalsTabDot,
  shareWidth,
  statsLinkText,
  tileTilt,
  toCycleCardView,
} from '../src/ui/album/pages/goals-view';
import { stateAt } from './helpers';

describe('Reiter „Ziele“ (ALBUM_UI.md B.4)', () => {
  it('Punkt am Reiter nur, wenn ein Neuer Zyklus möglich ist (G-13)', () => {
    expect(goalsTabDot(stateAt(NEW_CYCLE_MIN_STAGE - 1))).toBe(false);
    expect(goalsTabDot(stateAt(NEW_CYCLE_MIN_STAGE))).toBe(true);
  });

  it('Kennzahl im Kopf: Serie der Tagesziele, sonst der Zyklus', () => {
    expect(goalsPageMeta({ streak: 4 }, 2)).toBe('🌞 4 Tage');
    expect(goalsPageMeta({ streak: 1 }, 2)).toBe('🌞 1 Tag');
    expect(goalsPageMeta({ streak: 0 }, 3)).toBe('Zyklus 3');
    expect(goalsPageMeta(null, 1)).toBe('Zyklus 1');
  });

  it('Kurzkarte gesperrt: Grund statt Gewinn, „Mehr dazu ›“', () => {
    const card = toCycleCardView(stateAt(3, ['earthworm']));
    expect(card).toMatchObject({
      title: 'Zyklus 1',
      tree: '🌳 Stieleiche',
      ready: false,
      line: 'Ein neuer Zyklus ist ab der Stufe „Hain“ möglich (noch 14 Wegpunkte).',
      button: 'Mehr dazu ›',
    });
    expect(card.memory).toBe('Waldgedächtnis 0 · +0 % Wachstum und Samen');
  });

  it('Kurzkarte bereit: Gewinn wie die Vorschau, „Vorbereiten ›“', () => {
    const state = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin']);
    state.cycle.maxHarmony = 80;
    const card = toCycleCardView(state);
    expect(card.ready).toBe(true);
    expect(card.line).toMatch(/^\+\d+ Waldgedächtnis \(\+\d+ %\)$/);
    expect(card.button).toBe('Vorbereiten ›');
  });

  it('mit Landschaft: Wald im Titel', () => {
    const state = stateAt(ANCIENT_STAGE, ['earthworm']);
    state.meta.forestMemory = 300;
    state.meta.achievements.push('ancient-forest');
    expect(toCycleCardView(state).title).toBe('Zyklus 1 · 🌳 Heimatwald');
  });

  it('Link-Karte Erfolge: Zähler (nur sichtbare) und die neuesten Symbole zuerst', () => {
    const state = stateAt(3);
    const [a, b, c] = ACHIEVEMENTS.filter((x) => x.requires !== 'landscape');
    state.meta.achievements = [a!.id, b!.id, c!.id, 'unbekannt'];
    const view = achievementsLinkView(state, 2);
    expect(view.icons).toEqual([c!.icon, b!.icon]);
    const visible = ACHIEVEMENTS.filter((x) => x.requires !== 'landscape').length;
    expect(view.count).toBe(`3/${visible}`);
  });

  it('Link-Karte Statistik: Zyklus und Spielzeit', () => {
    const state = stateAt(3);
    state.cycle.number = 2;
    state.meta.stats.playSeconds = 3600 + 5 * 60;
    expect(statsLinkText(state)).toBe('Zyklus 2 · 1 Std. 5 Min. gespielt');
  });

  it('Balkenbreite begrenzt und auf eine Stelle gerundet', () => {
    expect(shareWidth(0.12345)).toBe('12.3%');
    expect(shareWidth(2)).toBe('100%');
    expect(shareWidth(Number.NaN)).toBe('0%');
  });

  it('Kacheln der Erfolge liegen fest schräg (−4° … +4°)', () => {
    for (const a of ACHIEVEMENTS) {
      const tilt = tileTilt(a.id);
      expect(tilt).toBe(tileTilt(a.id));
      expect(Math.abs(tilt)).toBeLessThanOrEqual(4);
    }
  });
});
