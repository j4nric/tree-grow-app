import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { SPECIES } from '../src/content/species';
import { MAX_OFFLINE_SECONDS } from '../src/core/tick';
import { welcomeText } from '../src/ui/adapters';
import { withRegulars } from '../src/ui/cycle-view';
import { RETURN_REPORT_MORE, returnStamp, toReturnReportView } from '../src/ui/return-report-view';

/** Rückkehr nach 3 Std.: Ertrag, gemitteltes Wetter, keine Besonderheiten. */
const base = { seconds: 3 * 3600, growth: 12_400.7, seeds: 300.2, autoDeclined: 0, declinedSeeds: 0 };

describe('toReturnReportView', () => {
  it('Kurzfassung: eine Zeile mit Dauer und Ertrag, ohne Verweis, wenn nichts mehr kommt', () => {
    const view = toReturnReportView({ away: base.seconds, report: base, waiting: 0 });
    expect(view.summary).toBe('Willkommen zurück! 3 Std.: +12.400 🌿, +300 🌰');
    expect(view.more).toBe(false);
    expect(view.headline).toBe(view.summary);
    expect(view.details).toEqual([welcomeText(base.seconds, base, 0)]);
    expect(view.full).toBe(welcomeText(base.seconds, base, 0));
  });

  it('nennt erreichte Stufe und wartende Begegnungen, Details im Bericht', () => {
    const view = toReturnReportView({
      away: base.seconds,
      report: { ...base, averaged: true, weather: [] },
      waiting: 2,
      stages: { from: 3, to: 5 },
    });
    expect(view.summary).toBe(
      `Willkommen zurück! 3 Std.: +12.400 🌿, +300 🌰 · Stufe „${STAGES[5]!.name}“ · 2 Begegnungen warten · ${RETURN_REPORT_MORE}`,
    );
    // Die Karte ist selbst der Bericht: dort ohne Verweis.
    expect(view.headline).toBe(view.summary.replace(` · ${RETURN_REPORT_MORE}`, ''));
    expect(view.details).toEqual([
      welcomeText(base.seconds, base, 2, { from: 3, to: 5 }),
      'Wetter gemittelt.',
    ]);
    expect(toReturnReportView({ away: base.seconds, report: base, waiting: 1 }).summary).toContain('· 1 Begegnung wartet');
  });

  it('verliert nichts: ganze Meldung wie bisher, jeder Teil steht auch in den Details', () => {
    const regular = SPECIES[0]!.id;
    const notes = ['🏅 Erfolg: „Wurzeln schlagen“', '', 'Tagesziele: Ein neuer Tag beginnt.', null, 'Die Landschaft ist offen.'];
    const report = { ...base, averaged: true, weather: [], regulars: [regular], autoDeclined: 2, declinedSeeds: 40 };
    const view = toReturnReportView({ away: base.seconds, report, waiting: 1, notes });
    // Bisheriger Toast-Text (main.ts vor dem Bericht): Begrüßung + Stammgäste + Zusatzhinweise.
    const before = [withRegulars(welcomeText(base.seconds, report, 1), [regular]), ...notes.filter(Boolean)].join(' ');
    expect(view.full).toBe(before);
    // Jeder Punkt kommt in der ganzen Meldung vor, und zusammen ergeben sie sie (ohne Lücken).
    expect(view.details.join(' ')).toBe(before);
    expect(view.details).toHaveLength(6);
    expect(view.details[1]).toBe('Wetter gemittelt.');
    expect(view.details[2]).toContain(SPECIES[0]!.name);
    expect(view.more).toBe(true);
    // Weitergezogene Begegnungen stehen nur in den Details – die Kurzfassung verweist darauf.
    expect(view.summary).not.toContain('zogen weiter');
    expect(view.summary.endsWith(RETURN_REPORT_MORE)).toBe(true);
  });

  it('gedeckelte Abwesenheit und Weiterziehen allein reichen für den Verweis', () => {
    const capped = { ...base, seconds: MAX_OFFLINE_SECONDS };
    expect(toReturnReportView({ away: 30 * 3600, report: capped, waiting: 0 }).more).toBe(true);
    expect(toReturnReportView({ away: base.seconds, report: { ...base, autoDeclined: 1, declinedSeeds: 5 }, waiting: 0 }).more).toBe(true);
  });

  it('Kurzfassung ohne Ertrag (gerundet 0) und ohne „+0“', () => {
    const view = toReturnReportView({ away: base.seconds, report: { ...base, growth: 0.01, seeds: 0 }, waiting: 0 });
    expect(view.summary).toBe('Willkommen zurück! 3 Std.');
  });

  it('bleibt kurz, auch wenn die ganze Meldung lang ist', () => {
    const notes = Array.from({ length: 4 }, (_, i) => `Ein ziemlich langer Zusatzhinweis Nummer ${i + 1} mit vielen Wörtern darin.`);
    const view = toReturnReportView({ away: base.seconds, report: { ...base, averaged: true, weather: [] }, waiting: 3, notes });
    expect(view.full.length).toBeGreaterThan(300);
    expect(view.summary.length).toBeLessThan(110);
  });
});

describe('returnStamp', () => {
  it('grüßt nur – die Kurzfassung steht im Zettel, Screenreader hören sie mit (S4)', () => {
    const view = toReturnReportView({ away: base.seconds, report: { ...base, averaged: true, weather: [] }, waiting: 2, notes: ['Mehr.'] });
    expect(view.greeting).toBe('Willkommen zurück! 3 Std.');
    const stamp = returnStamp(view);
    expect(stamp.text).toBe('Willkommen zurück! 3 Std.');
    expect(stamp.spoken).toBe('+12.400 🌿, +300 🌰 · 2 Begegnungen warten · Mehr im Rückkehr-Bericht.');
    // Kein „mehr im Rückkehr-Bericht“ im sichtbaren Text (S4: stand sonst auch auf dem Bericht selbst).
    expect(stamp.text).not.toContain(RETURN_REPORT_MORE);
  });

  it('ohne Ertrag und ohne mehr: nichts zum Vorlesen dazu', () => {
    const view = toReturnReportView({ away: base.seconds, report: { ...base, growth: 0, seeds: 0 }, waiting: 0 });
    expect(returnStamp(view)).toEqual({ text: 'Willkommen zurück! 3 Std.', spoken: '' });
  });
});
