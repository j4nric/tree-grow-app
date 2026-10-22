import { describe, expect, it } from 'vitest';
import { SEASONS } from '../src/content/seasons';
import { seasonTimeLeft, toSeasonBadgeView } from '../src/ui/season-view';
import { seasonWeatherChangeText } from '../src/ui/weather-view';

describe('Jahreszeit in der Kopfzeile (DESIGN_V2.md 16.6)', () => {
  it('Abzeichen: Symbol, Name, Restzeit; Wirkungen als Tooltip', () => {
    expect(toSeasonBadgeView(0)).toMatchObject({ id: 'spring', text: '🌱 Frühling · noch 3:00 min' });
    expect(toSeasonBadgeView(400)).toMatchObject({
      id: 'autumn',
      text: '🍂 Herbst · noch 2:20 min',
      title: 'Herbst: +20 % 🌰 · Pilze +15 % 😊',
    });
    expect(toSeasonBadgeView(719.2).text).toBe('❄️ Winter · noch 0:01 min');
    expect(toSeasonBadgeView(720).id).toBe('spring');
  });

  it('ungültige Spielzeit: Frühlingsbeginn statt Absturz', () => {
    expect(toSeasonBadgeView(NaN).id).toBe('spring');
    expect(toSeasonBadgeView(-3).text).toBe('🌱 Frühling · noch 3:00 min');
  });

  it('Restzeit: aufgerundet auf ganze Sekunden, nie negativ', () => {
    expect(seasonTimeLeft(80)).toBe('1:20 min');
    expect(seasonTimeLeft(59.1)).toBe('1:00 min');
    expect(seasonTimeLeft(0)).toBe('0:00 min');
    expect(seasonTimeLeft(-5)).toBe('0:00 min');
    expect(seasonTimeLeft(NaN)).toBe('0:00 min');
  });

  it('Hinweis beim Wechsel: die zuletzt erreichte Jahreszeit mit ihrem Text', () => {
    // Ohne Wetter (z. B. alter Bericht) wie früher; mit Wetter siehe tests/weather-view.test.ts.
    expect(seasonWeatherChangeText([], [])).toBe('');
    expect(seasonWeatherChangeText(['summer'], [])).toBe(`☀️ Sommer: ${SEASONS[1]!.text}`);
    expect(seasonWeatherChangeText(['summer', 'autumn'], [])).toContain('Herbst');
  });
});
