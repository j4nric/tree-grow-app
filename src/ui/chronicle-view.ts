/**
 * Waldchronik und Kennarten im Album (DESIGN_V2.md 26.7, ROADMAP Phase 9, 3a): Texte und
 * Ansichten für U:Standort (Abschnitt „Chronik“), den Reiter „Landschaft“ (Kennzahl, Siegel,
 * Tagebuch der Wälder), U:Neuer Zyklus (offene Kapitel beim Ziel-Wald), R:Arten (Andenken der
 * Chroniken), die Stempel je neuem Kapitel und den Rückkehr-Bericht.
 *
 * Reine Funktionen ohne DOM – getestet in tests/chronicle-view.test.ts. Alle Werte kommen
 * lesend aus core/ (`chronicleOf`, `chronicleComplete`, `kennartOf`, `keepsakeOf`); hier stehen
 * nur Texte und Reihenfolge.
 *
 * **Spoiler:** Vor der Freischaltung der Landschaft gibt es keine Ansicht (null bzw. '') – die
 * Chronik des Heimatwalds wird still mitgeschrieben (26.4). Offene Kapitel nennen weder Art noch
 * Ereignis beim Namen (Hinweise aus content/chronicle.ts); das Andenken erst, wenn die Chronik
 * vollständig ist.
 */
import { CHAPTER_IDS, CHRONICLE_CHAPTERS, type ChapterId } from '../content/chronicle';
import { LANDSCAPE_SITES, LANDSCAPE_SITES_BY_ID, type Keepsake, type SiteId } from '../content/landscape';
import { SEASONS } from '../content/seasons';
import { SPECIES_BY_ID } from '../content/species';
import {
  chronicleComplete,
  chronicleOf,
  isSiteFounded,
  kennartOf,
  keepsakeOf,
  landscapeOf,
  landscapeUnlocked,
  type ChapterNews,
} from '../core/landscape';
import type { ChronicleEntry, GameState } from '../core/state';
import { formatNumber } from './format';

type ChronicleHolder = Pick<GameState, 'meta'>;

/** Kapitel je Wald (6) und in der ganzen Landschaft (36). */
export const CHAPTERS_PER_SITE = CHAPTER_IDS.length;
export const CHRONICLE_TOTAL = LANDSCAPE_SITES.length * CHAPTERS_PER_SITE;

/** Symbol der Chronik (Kennzahl, Stempel, Rückkehr-Bericht). */
export const CHRONICLE_ICON = '📜';

/** Kurzname eines offenen Kapitels für „offen: Erster Schnee, Kennart“ – ohne Spoiler. */
const CHAPTER_SHORT: Readonly<Record<ChapterId, string>> = {
  ancient: 'Urwald',
  'first-snow': 'Erster Schnee',
  signature: 'Ereignis',
  kennart: 'Kennart',
  harmony: 'Einklang',
  memory: 'Gedächtnis',
};

/** Ort im Dativ („im Auwald am Fluss“, „in den Buchenhallen“) für Stempel und Hinweise. */
const SITE_IN: Readonly<Record<SiteId, string>> = {
  home: 'im',
  floodplain: 'im',
  carr: 'im',
  beechwood: 'in den',
  mountain: 'im',
  heath: 'in der',
};

/** „im Auwald am Fluss“ (unbekannter Wald: „in <id>“). */
export function siteIn(id: SiteId): string {
  const name = LANDSCAPE_SITES_BY_ID.get(id)?.name ?? id;
  return `${SITE_IN[id] ?? 'in'} ${name}`;
}

/** Wird die Chronik gezeigt? Erst mit der Landschaft (26.4 „still mitgeschrieben“). */
export function chronicleVisible(state: ChronicleHolder): boolean {
  return Array.isArray(state.meta.achievements) && landscapeUnlocked(state);
}

/**
 * Titel eines Kapitels in diesem Wald: das Ereignis mit dem Titel des Waldes
 * („Frühjahrshochwasser“), die Kennart erst geschrieben mit ihrem Namen („Die Kennart: Biber“).
 */
export function chapterTitle(site: SiteId, chapter: ChapterId, written: boolean): string {
  const base = CHRONICLE_CHAPTERS.find((c) => c.id === chapter)?.title ?? chapter;
  if (chapter === 'signature') return LANDSCAPE_SITES_BY_ID.get(site)?.chronicleEventTitle ?? base;
  if (chapter === 'kennart' && written) {
    const id = kennartOf(site);
    const name = id ? SPECIES_BY_ID.get(id)?.name : undefined;
    return name ? `${base}: ${name}` : base;
  }
  return base;
}

/** Datum eines Kapitels: „7. Zyklus · Winter“; vor v16 ohne Datum „schon früher“. */
export function chapterDate(entry: Pick<ChronicleEntry, 'cycle' | 'season'>): string {
  if (entry.cycle === null || !Number.isFinite(entry.cycle)) return 'schon früher';
  const season = SEASONS.find((s) => s.id === entry.season)?.name;
  return season ? `${formatNumber(entry.cycle)}. Zyklus · ${season}` : `${formatNumber(entry.cycle)}. Zyklus`;
}

/** Ein Zettel im Abschnitt „Chronik“ (U:Standort). */
export interface ChronicleChapterView {
  id: ChapterId;
  icon: string;
  title: string;
  written: boolean;
  /** Stempel-Datum (nur geschrieben). */
  date: string | null;
  /** Hinweis ohne Spoiler (nur offen). */
  hint: string | null;
}

export interface SiteChronicleView {
  written: number;
  total: number;
  complete: boolean;
  /** „Chronik 4 / 6“ */
  count: string;
  chapters: ChronicleChapterView[];
  /** Kurznamen der offenen Kapitel in Anzeige-Reihenfolge („Erster Schnee“, „Kennart“). */
  open: string[];
  /** Andenken – nur bei vollständiger Chronik. */
  keepsake: Keepsake | null;
}

/** „4 / 6“ */
const fraction = (n: number, total: number) => `${formatNumber(n)} / ${formatNumber(total)}`;

/**
 * Chronik eines gegründeten Waldes für U:Standort und das Tagebuch der Wälder; null vor der
 * Landschaft und für Wälder, die noch nicht gegründet sind.
 */
export function siteChronicleView(state: ChronicleHolder, site: SiteId): SiteChronicleView | null {
  if (!chronicleVisible(state) || !isSiteFounded(state, site)) return null;
  const entries = new Map(chronicleOf(state, site).map((e) => [e.chapter, e]));
  const chapters = CHRONICLE_CHAPTERS.map((c): ChronicleChapterView => {
    const entry = entries.get(c.id);
    return {
      id: c.id,
      icon: c.icon,
      title: chapterTitle(site, c.id, entry !== undefined),
      written: entry !== undefined,
      date: entry ? chapterDate(entry) : null,
      hint: entry ? null : c.hint,
    };
  });
  const written = chapters.filter((c) => c.written).length;
  const complete = chronicleComplete(state, site);
  return {
    written,
    total: CHAPTERS_PER_SITE,
    complete,
    count: `Chronik ${fraction(written, CHAPTERS_PER_SITE)}`,
    chapters,
    open: chapters.filter((c) => !c.written).map((c) => CHAPTER_SHORT[c.id]),
    keepsake: complete ? keepsakeOf(site) : null,
  };
}

/** Kurzfassung „4 / 6 – offen: Erster Schnee, Kennart“ bzw. „6 / 6 – vollständig“. */
export function chronicleShortText(view: Pick<SiteChronicleView, 'written' | 'total' | 'open'>): string {
  const count = fraction(view.written, view.total);
  return view.open.length === 0 ? `${count} – vollständig` : `${count} – offen: ${view.open.join(', ')}`;
}

/** Geschriebene Kapitel aller Wälder (je Wald höchstens sechs, bekannte IDs). */
export function writtenChapters(state: ChronicleHolder): number {
  let n = 0;
  for (const site of LANDSCAPE_SITES) n += Math.min(CHAPTERS_PER_SITE, new Set(chronicleOf(state, site.id).map((e) => e.chapter)).size);
  return n;
}

/** Kennzahl im Reiter „Landschaft“: „📜 9 / 36 Kapitel“; '' vor der Landschaft. */
export function chronicleTotalText(state: ChronicleHolder): string {
  if (!chronicleVisible(state)) return '';
  return `${CHRONICLE_ICON} ${fraction(writtenChapters(state), CHRONICLE_TOTAL)} Kapitel`;
}

/**
 * Hinweis beim Ziel-Wald auf U:Neuer Zyklus (26.7): „📜 Chronik 4 / 6 – offen: Erster Schnee,
 * Kennart“; ein neuer Wald „📜 Chronik 0 / 6 – ein neuer Wald beginnt seine Chronik.“; null vor
 * der Landschaft.
 */
export function chronicleTargetText(state: ChronicleHolder, site: SiteId): string | null {
  if (!chronicleVisible(state)) return null;
  const view = siteChronicleView(state, site);
  if (!view) return `${CHRONICLE_ICON} Chronik ${fraction(0, CHAPTERS_PER_SITE)} – ein neuer Wald beginnt seine Chronik.`;
  return `${CHRONICLE_ICON} Chronik ${chronicleShortText(view)}`;
}

/** Stand der Chronik je Wald (Zahl der Einträge) – für den Vergleich vorher/nachher. */
export type ChronicleMark = Readonly<Partial<Record<SiteId, number>>>;

export function chronicleMark(state: ChronicleHolder): ChronicleMark {
  const mark: Partial<Record<SiteId, number>> = {};
  for (const site of LANDSCAPE_SITES) mark[site.id] = chronicleOf(state, site.id).length;
  return mark;
}

/**
 * Seit `mark` neu geschriebene Kapitel (Aktionen melden sie nicht eigens – 26.6 „die Oberfläche
 * vergleicht vorher/nachher“). Die Chronik wächst nur; ein kürzerer Stand (Import) meldet nichts.
 */
export function chaptersSince(state: ChronicleHolder, mark: ChronicleMark): ChapterNews[] {
  const news: ChapterNews[] = [];
  for (const site of LANDSCAPE_SITES) {
    const entries = chronicleOf(state, site.id);
    const before = mark[site.id] ?? 0;
    for (const e of entries.slice(before)) news.push({ site: site.id, chapter: e.chapter });
  }
  return news;
}

/**
 * Stempel bzw. Punkt im Rückkehr-Bericht für neue Kapitel (26.4 „Meldung“):
 * „📜 Neues Kapitel im Auwald am Fluss: Frühjahrshochwasser.“ – je Wald ein Satz; ist die
 * Chronik damit vollständig, dazu das Andenken. '' ohne Kapitel oder vor der Landschaft.
 */
export function chapterNewsText(state: ChronicleHolder, news: readonly ChapterNews[]): string {
  if (news.length === 0 || !chronicleVisible(state)) return '';
  const bySite = new Map<SiteId, ChapterId[]>();
  for (const n of news) {
    if (!LANDSCAPE_SITES_BY_ID.has(n.site)) continue;
    const list = bySite.get(n.site) ?? [];
    if (!list.includes(n.chapter)) list.push(n.chapter);
    bySite.set(n.site, list);
  }
  const parts: string[] = [];
  for (const [site, chapters] of bySite) {
    const titles = chapters.map((c) => chapterTitle(site, c, true));
    const head = titles.length === 1 ? 'Neues Kapitel' : 'Neue Kapitel';
    let text = `${CHRONICLE_ICON} ${head} ${siteIn(site)}: ${titles.join(', ')}.`;
    const keepsake = chronicleComplete(state, site) ? keepsakeOf(site) : null;
    if (keepsake) text += ` Die Chronik ist vollständig – Andenken: ${keepsake.icon} ${keepsake.name}.`;
    parts.push(text);
  }
  return parts.join(' ');
}

/**
 * Zusatz zur Freischaltung der Landschaft (26.4): „📜 Im Heimatwald stehen schon 3 Kapitel der
 * Chronik.“ – '' ohne Kapitel.
 */
export function chronicleUnlockText(state: ChronicleHolder): string {
  const home = LANDSCAPE_SITES[0];
  if (!home) return '';
  const n = new Set(chronicleOf(state, home.id).map((e) => e.chapter)).size;
  if (n === 0) return '';
  const what = n === 1 ? 'steht schon 1 Kapitel' : `stehen schon ${formatNumber(n)} Kapitel`;
  const where = siteIn(home.id);
  return `${CHRONICLE_ICON} ${where.charAt(0).toUpperCase()}${where.slice(1)} ${what} der Chronik.`;
}

/** Ein Andenken der Chroniken in R:Arten → Andenken. */
export interface ChronicleKeepsakeView {
  key: SiteId;
  /** Symbol des Andenkens bzw. „?“ solange die Chronik offen ist. */
  icon: string;
  /** Name des Andenkens bzw. „???“. */
  name: string;
  /** „🌊 Auwald am Fluss · Chronik 4 / 6“ */
  site: string;
  /** Text des Andenkens bzw. Hinweis. */
  text: string;
  complete: boolean;
}

/** Andenken der sechs Chroniken (Wald-Reihenfolge der Inhalte); leer vor der Landschaft. */
export function chronicleKeepsakes(state: ChronicleHolder): ChronicleKeepsakeView[] {
  if (!chronicleVisible(state)) return [];
  const founded = new Set(landscapeOf(state).sites.map((s) => s?.id));
  return LANDSCAPE_SITES.map((site): ChronicleKeepsakeView => {
    const complete = chronicleComplete(state, site.id);
    const view = siteChronicleView(state, site.id);
    const label = `${site.icon} ${site.name}`;
    if (complete && view?.keepsake) {
      return { key: site.id, icon: view.keepsake.icon, name: view.keepsake.name, site: `${label} · Chronik vollständig`, text: view.keepsake.text, complete: true };
    }
    return {
      key: site.id,
      icon: '?',
      name: '???',
      site: founded.has(site.id) && view ? `${label} · ${view.count}` : `${label} · noch nicht gegründet`,
      text: `Schreib die Chronik ${siteIn(site.id)} zu Ende – dann bleibt ein Andenken.`,
      complete: false,
    };
  });
}
