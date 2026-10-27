import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { SPECIES } from '../src/content/species';
import { MAX_OFFLINE_SECONDS } from '../src/core/tick';
import { catchUpNotice, offlineYieldHint, reducedYield, welcomeText, yieldPhrase } from '../src/ui/adapters';
import { withRegulars } from '../src/ui/cycle-view';
import { joinSentences } from '../src/ui/format';
import { AVERAGED_WEATHER_ICON, RETURN_REPORT_MORE, returnStamp, toReturnReportView } from '../src/ui/return-report-view';

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
      // Wetterzeile mit Wetter-Symbol statt des üblichen 🌿 davor (Playtest Phase 7, S3).
      `${AVERAGED_WEATHER_ICON} Wetter gemittelt.`,
    ]);
    expect(toReturnReportView({ away: base.seconds, report: base, waiting: 1 }).summary).toContain('· 1 Begegnung wartet');
  });

  it('verliert nichts: ganze Meldung wie bisher, jeder Teil steht auch in den Details', () => {
    const regular = SPECIES[0]!.id;
    const notes = ['🏅 Erfolg: „Wurzeln schlagen“', '', 'Tagesziele: Ein neuer Tag beginnt.', null, 'Die Landschaft ist offen.'];
    const report = { ...base, averaged: true, weather: [], regulars: [regular], autoDeclined: 2, declinedSeeds: 40 };
    const view = toReturnReportView({ away: base.seconds, report, waiting: 1, notes });
    // Bisheriger Toast-Text (main.ts vor dem Bericht): Begrüßung + Stammgäste + Zusatzhinweise –
    // jeder Teil mit Satzzeichen (Playtest Phase 7, S4: „… Wurzeln schlagen“. Tagesziele …“).
    const before = joinSentences(withRegulars(welcomeText(base.seconds, report, 1), [regular]), ...notes);
    expect(view.full).toBe(before);
    expect(view.full).toContain('„Wurzeln schlagen“. Tagesziele');
    // Jeder Punkt kommt in der ganzen Meldung vor (ohne das Wetter-Symbol davor).
    for (const d of view.details) expect(before).toContain(d.replace(`${AVERAGED_WEATHER_ICON} `, ''));
    expect(view.details).toHaveLength(6);
    expect(view.details[1]).toBe(`${AVERAGED_WEATHER_ICON} Wetter gemittelt.`);
    expect(view.details[2]).toContain(SPECIES[0]!.name);
    expect(view.more).toBe(true);
    // Weitergezogene Begegnungen stehen nur in den Details – die Kurzfassung verweist darauf.
    expect(view.summary).not.toContain('zogen weiter');
    expect(view.summary.endsWith(RETURN_REPORT_MORE)).toBe(true);
  });

  it('nennt beim gemittelten Wetter den Wald, wenn der Zyklus nicht im Heimatwald wächst (S3)', () => {
    const report = { ...base, averaged: true, weather: ['snow', 'snow', 'rain'] as const };
    const view = toReturnReportView({ away: base.seconds, report: { ...report, weather: [...report.weather] }, waiting: 0, site: 'mountain' });
    expect(view.details[1]).toBe(`${AVERAGED_WEATHER_ICON} Wetter im Bergmischwald gemittelt (2 × Neuschnee, 1 × Landregen).`);
    expect(view.full).toContain('Wetter im Bergmischwald gemittelt (2 × Neuschnee, 1 × Landregen).');
    // Heimatwald: wie bisher ohne Namen.
    const home = toReturnReportView({ away: base.seconds, report: { ...report, weather: [...report.weather] }, waiting: 0, site: 'home' });
    expect(home.details[1]).toBe(`${AVERAGED_WEATHER_ICON} Wetter gemittelt (2 × Neuschnee, 1 × Landregen).`);
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

describe('Offline 10 % im Rückkehr-Bericht (28.3)', () => {
  const slow = { ...base, yieldFactor: 0.1, fullSeconds: 60 };

  it('Halbsatz „mit einem Zehntel der Kraft“ und Kurztext „gemächlich (10 %)“', () => {
    expect(welcomeText(slow.seconds, slow, 0)).toBe(
      'Willkommen zurück! In 3 Std. ist dein Wald gemächlich weitergewachsen – mit einem Zehntel der Kraft: +12.400 🌿, +300 🌰.',
    );
    expect(welcomeText(slow.seconds, slow, 0, { from: 3, to: 4 })).toContain(
      `wuchs dein Baum gemächlich bis zur Stufe „${STAGES[4]!.name}“ – mit einem Zehntel der Kraft: +12.400 🌿`,
    );
    const view = toReturnReportView({ away: slow.seconds, report: slow, waiting: 2 });
    expect(view.summary).toBe('Willkommen zurück! 3 Std.: +12.400 🌿, +300 🌰 · gemächlich (10 %) · 2 Begegnungen warten');
    expect(view.details[0]).toContain('mit einem Zehntel der Kraft');
    expect(returnStamp(view).text).toBe('Willkommen zurück! 3 Std.');
    expect(catchUpNotice(slow.seconds, { ...slow, declinedStackFull: 0 }, 0)?.text).toContain('mit einem Zehntel der Kraft');
  });

  it('nur, wenn wirklich mehr als die vollen Sekunden gerechnet wurden', () => {
    expect(reducedYield(slow)).toBe(true);
    expect(reducedYield({ ...slow, seconds: 60 })).toBe(false);
    expect(reducedYield({ ...slow, seconds: 30, fullSeconds: 30 })).toBe(false);
    expect(reducedYield({ ...slow, yieldFactor: 1 })).toBe(false);
    expect(reducedYield({ ...slow, yieldFactor: NaN })).toBe(false);
    expect(reducedYield(base)).toBe(false);
    expect(welcomeText(base.seconds, base, 0)).not.toContain('gemächlich');
  });

  it('andere Faktoren in Prozent, Hinweis nennt den Faktor', () => {
    expect(yieldPhrase(0.1)).toBe('mit einem Zehntel der Kraft');
    expect(yieldPhrase(0.25)).toBe('mit 25 % der Kraft');
    expect(offlineYieldHint(0.1)).toBe('Dein Wald wächst am schnellsten, während du zusiehst – im Hintergrund und offline mit 10 %.');
    // Der Hinweis steht als eigener Punkt im Bericht (main.ts hängt ihn an die Zusatzhinweise).
    const view = toReturnReportView({ away: slow.seconds, report: slow, waiting: 0, notes: [offlineYieldHint(0.1)] });
    expect(view.details).toContain(offlineYieldHint(0.1));
    expect(view.more).toBe(true);
  });

  it('Harmonie-Vorrat (27.3): „+840 ⚖️“ in Kurzfassung und Begrüßung, 0 fällt weg', () => {
    const view = toReturnReportView({ away: base.seconds, report: { ...base, harmony: 840.6 }, waiting: 0 });
    expect(view.summary).toBe('Willkommen zurück! 3 Std.: +12.400 🌿, +300 🌰, +840 ⚖️');
    expect(view.full).toContain('+12.400 🌿, +300 🌰, +840 ⚖️.');
    expect(toReturnReportView({ away: base.seconds, report: { ...base, harmony: 0 }, waiting: 0 }).summary).not.toContain('⚖️');
  });
});
