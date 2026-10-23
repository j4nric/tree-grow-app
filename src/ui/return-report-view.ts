/**
 * Rückkehr-Bericht (Playtest Phase 6): Nach längerer Abwesenheit sammelt sich viel in der
 * Begrüßung – Ertrag, Begegnungen, Mittelwetter, Stammgäste, Erfolge, Tagesziele,
 * Landschaft, Wildwechsel. Mobil war der Toast dafür sehr hoch und deckte lange die Szene ab.
 *
 * Darum gibt es drei Fassungen derselben Nachricht:
 * - `summary`: eine Zeile für den Toast im einspaltigen Layout (und als Kopf des Berichts),
 * - `full`: die ganze Meldung wie bisher (Toast am Desktop, dort stört sie nicht),
 * - `details`: dieselben Inhalte als einzelne Punkte für den schließbaren Bericht in der
 *   Seitenleiste – so geht nichts verloren, auch wenn der Toast verschwunden ist.
 *
 * Reine Ansichtslogik ohne DOM (Tests: tests/return-report-view.test.ts).
 */
import type { SiteId } from '../content/landscape';
import type { OfflineReport } from '../core/tick';
import { averagedWeatherText } from './weather-view';
import { reachedStage, welcomeAmount, welcomeText, type StageProgress } from './adapters';
import { regularsArrivedText, withRegulars } from './cycle-view';
import { formatDuration, formatNumber, joinSentences } from './format';
import { wildwechselReturnText } from './wildwechsel-view';

/** Was main.ts nach dem Nachrechnen über die Rückkehr weiß. */
export interface ReturnReportInput {
  /** Tatsächliche Abwesenheit in Sekunden (kann über der simulierten Zeit liegen). */
  away: number;
  report: Pick<OfflineReport, 'seconds' | 'growth' | 'seeds' | 'autoDeclined' | 'declinedSeeds'> &
    Partial<Pick<OfflineReport, 'averaged' | 'weather' | 'regulars' | 'wildwechsel'>>;
  /** Wartende Begegnungen im Stapel. */
  waiting: number;
  stages?: StageProgress;
  /** Wald des Zyklus (Landschaft) – das gemittelte Wetter nennt ihn außerhalb des Heimatwalds. */
  site?: SiteId;
  /** Zusatzhinweise in Reihenfolge (Erfolge, Landschaft, Tagesziele, Migration …); leere fallen weg. */
  notes?: readonly (string | null | undefined)[];
}

export interface ReturnReportView {
  /** Nur der Gruß mit der Dauer: „Willkommen zurück! 3 Std.“ (Stempel neben dem Zettel). */
  greeting: string;
  /** Kurzfassung für den Toast: „Willkommen zurück! 3 Std.: +12.400 🌿, +300 🌰 · …“. */
  summary: string;
  /** Dieselbe Kurzfassung ohne den Verweis auf den Bericht – Kopf der Karte selbst. */
  headline: string;
  /** Ganze Meldung wie vor dem Bericht (Begrüßung, Stammgäste, Zusatzhinweise). */
  full: string;
  /** Alle Inhalte als einzelne Punkte – zusammen mindestens so viel wie `full`. */
  details: string[];
  /** Steht mehr im Bericht, als die Kurzfassung sagt? (dann der Verweis „mehr im Bericht“) */
  more: boolean;
}

/** Symbol vor dem Punkt „Wetter gemittelt“ im Bericht (eine Wetterzeile, kein Wachstum). */
export const AVERAGED_WEATHER_ICON = '⛅';

/** Verweis am Ende der Kurzfassung – der Bericht steht in der Seitenleiste. */
export const RETURN_REPORT_MORE = 'mehr im Rückkehr-Bericht';

export function toReturnReportView(input: ReturnReportInput): ReturnReportView {
  const { away, report, waiting, stages } = input;
  const regulars = report.regulars ?? [];
  const notes = (input.notes ?? []).filter((n): n is string => !!n);

  const welcome = welcomeText(away, report, waiting, stages, input.site);
  // Jeder Teil mit Satzzeichen – sonst läuft eine Erfolgsliste in den nächsten Hinweis hinein.
  const full = joinSentences(withRegulars(welcome, regulars), ...notes);
  // Gemitteltes Wetter als eigener Punkt, mit Wetter-Symbol statt des üblichen 🌿 davor.
  const weather = averagedWeatherText(report, input.site);

  // Punkte: Begrüßung ohne Wetter, dann Wetter, Stammgäste und die Zusatzhinweise einzeln.
  const details = [
    welcomeText(away, { ...report, averaged: false }, waiting, stages),
    weather ? `${AVERAGED_WEATHER_ICON} ${weather}` : '',
    regularsArrivedText(regulars),
    // Wildwechsel (24.6): wie viele der wartenden Begegnungen ein Tier über Korridore bringen.
    wildwechselReturnText(report.wildwechsel?.length ?? 0),
    ...notes,
  ].filter((d): d is string => !!d);

  // Kurzfassung: Dauer, Ertrag, erreichte Stufe, wartende Begegnungen.
  const yields = [welcomeAmount(report.growth, '🌿'), welcomeAmount(report.seeds, '🌰')].filter(Boolean);
  const greeting = `Willkommen zurück! ${formatDuration(report.seconds)}`;
  const head = `${greeting}${yields.length > 0 ? `: ${yields.join(', ')}` : ''}`;
  const parts = [head];
  const reached = reachedStage(stages);
  if (reached) parts.push(`Stufe „${reached}“`);
  if (waiting > 0) parts.push(waiting === 1 ? '1 Begegnung wartet' : `${formatNumber(waiting)} Begegnungen warten`);
  // Mehr als die Kurzfassung: gedeckelte Zeit, weitergezogene Begegnungen, weitere Punkte.
  const more = details.length > 1 || report.seconds < away || report.autoDeclined > 0;
  const headline = parts.join(' · ');
  return { greeting, summary: more ? `${headline} · ${RETURN_REPORT_MORE}` : headline, headline, full, details, more };
}

/**
 * Willkommens-Stempel neben dem Rückkehr-Zettel (Playtest Schritt 14, S4): Der Zettel zeigt
 * schon die Kurzfassung, der Stempel grüßt nur („Willkommen zurück! 8 Std.“). Screenreader
 * hören den Rest der Kurzfassung mit (`spoken`) – der Zettel selbst ist keine Live-Region.
 */
export function returnStamp(view: ReturnReportView): { text: string; spoken: string } {
  const rest = view.headline.slice(view.greeting.length).replace(/^[:\s·]+/, '');
  const spoken = [rest, view.more ? 'Mehr im Rückkehr-Bericht.' : ''].filter(Boolean).join(' · ');
  return { text: view.greeting, spoken };
}
