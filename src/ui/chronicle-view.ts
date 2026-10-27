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
import { SEASONS, SEASON_IDS, SEASON_SECONDS, YEAR_SECONDS } from '../content/seasons';
import { SPECIES_BY_ID, kennartSite } from '../content/species';
import {
  activeSite,
  ANCIENT_STAGE,
  chronicleComplete,
  chronicleOf,
  hasChapter,
  isSiteAncient,
  isSiteFounded,
  kennartOf,
  keepsakeOf,
  landscapeOf,
  landscapeUnlocked,
  type ChapterNews,
} from '../core/landscape';
import type { ChronicleEntry, GameState } from '../core/state';
import { formatNumber } from './format';
import { seasonTimeLeft } from './season-view';

type ChronicleHolder = Pick<GameState, 'meta'>;
/** Für Hinweise, die Stufe und Spielzeit des laufenden Zyklus brauchen (Kennart, Verweilen). */
type CycleHolder = Pick<GameState, 'meta' | 'stage' | 'cycle'>;

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
 * Offene Kennart, wenn der Wald schon alt ist (Playtest Phase 9, F2): Der allgemeine Hinweis
 * „zeigt sich nur, wenn er alt ist“ stimmte dann nicht mehr. Ohne Spoiler – nennt die Art nicht.
 */
export const KENNART_READY_HINT = 'Der Wald ist alt genug – jetzt kann sie jederzeit kommen.';
/** Dasselbe für einen alten Wald, der gerade ruht (die Kennart kommt nur im aktiven Wald). */
export const KENNART_READY_RESTING_HINT = 'Der Wald ist alt genug – wächst du wieder hier, kann sie jederzeit kommen.';

/** Hinweis eines offenen Kapitels: der aus den Inhalten, bei der Kennart je nach Alter des Waldes. */
function openChapterHint(state: ChronicleHolder, site: SiteId, chapter: ChapterId, hint: string): string {
  if (chapter !== 'kennart') return hint;
  // isSiteAncient liest `stage` nur für den aktiven Wald – ohne Stufe zählt nur „schon einmal Urwald“.
  if (!isSiteAncient({ stage: -1, ...state }, site)) return hint;
  return activeSite(landscapeOf(state)) === site ? KENNART_READY_HINT : KENNART_READY_RESTING_HINT;
}

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
      hint: entry ? null : openChapterHint(state, site, c.id, c.hint),
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

/** Index des Winters im Jahr (Frühling 0 … Winter 3). */
const WINTER_START = SEASON_IDS.indexOf('winter') * SEASON_SECONDS;

/**
 * Spielzeit bis zum Beginn des nächsten Winters (> 0, höchstens ein Jahr): im Winter selbst bis
 * zum Winter des nächsten Jahres – das Kapitel schreibt erst der Wechsel *zu* Winter (26.4).
 */
export function secondsToWinter(elapsed: number): number {
  const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const inYear = t % YEAR_SECONDS;
  const left = WINTER_START - inYear;
  return left > 0 ? left : left + YEAR_SECONDS;
}

/**
 * Worauf man beim Verweilen im Urwald wartet (Playtest Phase 9, F3): „❄️ Noch 1:19 min bis zum
 * Winter – bleib, dann schreibt der Wald „Erster Schnee“.“ Nur, solange der aktive Wald im Urwald
 * steht und sein Kapitel „Erster Schnee“ noch offen ist; sonst null (auch vor der Landschaft).
 *
 * `site`: der Wald, dessen Seite bzw. Ziel gezeigt wird – nur der aktive Wald kann verweilen.
 * `away`: Der Zyklus soll woanders weitergehen (U:Neuer Zyklus mit anderem Ziel) – dann nennt der
 * Hinweis den aktiven Wald beim Namen.
 */
export function firstSnowWaitText(state: CycleHolder, site?: SiteId, away = false): string | null {
  if (!chronicleVisible(state) || state.stage < ANCIENT_STAGE) return null;
  const active = activeSite(landscapeOf(state));
  if (site !== undefined && site !== active) return null;
  if (!isSiteFounded(state, active) || hasChapter(state, active, 'first-snow')) return null;
  const left = seasonTimeLeft(secondsToWinter(state.cycle.elapsed));
  const title = CHAPTER_SHORT['first-snow'];
  return away
    ? `❄️ Noch ${left} bis zum Winter – bleibst du, schreibt die Chronik ${siteIn(active)} „${title}“.`
    : `❄️ Noch ${left} bis zum Winter – bleib, dann schreibt der Wald „${title}“.`;
}

/** „im alten Auwald am Fluss“, „in den alten Buchenhallen“ (Kennart-Karte, F5). */
export function siteInOld(id: SiteId): string {
  const name = LANDSCAPE_SITES_BY_ID.get(id)?.name ?? id;
  return `${SITE_IN[id] ?? 'in'} alten ${name}`;
}

/**
 * Markierung einer Kennart auf ihrer Karte in U:Begegnung (Playtest Phase 9, F5). `label` steht
 * sichtbar als Band („Kennart“), `text` darunter und vollständig für Screenreader; `chapter`
 * nennt das Kapitel, das ihr Einzug schreibt (nur offen und nur im eigenen, aktiven Wald) bzw.
 * dass es nur dort zählt (Wildwechsel).
 */
export interface KennartMarkView {
  site: SiteId;
  icon: string;
  label: string;
  /** „Lebt nur im alten Auwald am Fluss.“ */
  text: string;
  /** „📜 Zieht sie ein, schreibt der Wald das Kapitel „Die Kennart: Biber“.“ – sonst fehlt es. */
  chapter?: string;
}

export const KENNART_ICON = '🔎';
export const KENNART_LABEL = 'Kennart';

/** Kennart-Markierung für eine Tierkarte; null für andere Arten und vor der Landschaft. */
export function kennartMark(state: ChronicleHolder, speciesId: string): KennartMarkView | null {
  if (!chronicleVisible(state)) return null;
  const site = kennartSite(SPECIES_BY_ID.get(speciesId));
  if (site === null || !LANDSCAPE_SITES_BY_ID.has(site)) return null;
  const mark: KennartMarkView = { site, icon: KENNART_ICON, label: KENNART_LABEL, text: `Lebt nur ${siteInOld(site)}.` };
  if (!hasChapter(state, site, 'kennart')) {
    const title = chapterTitle(site, 'kennart', true);
    mark.chapter =
      activeSite(landscapeOf(state)) === site
        ? `${CHRONICLE_ICON} Zieht sie ein, schreibt der Wald das Kapitel „${title}“.`
        : `${CHRONICLE_ICON} Ihr Kapitel „${title}“ schreibt nur der Wald, in dem sie zu Hause ist.`;
  }
  return mark;
}

/**
 * Hinweis im Kopf von U:Begegnung, wenn das Ereignis das Kapitel „Ereignis des Waldes“ schreibt
 * (Playtest Phase 9, F5): „📜 Schreibt ein Kapitel der Chronik: „Frühjahrshochwasser“ – gleich, wie
 * du dich entscheidest.“ Nur im aktiven Wald, solange das Kapitel offen ist; sonst null (auch vor
 * der Landschaft – dort schreibt der Heimatwald still mit).
 */
export function signatureChapterText(state: ChronicleHolder, eventId: string): string | null {
  if (!chronicleVisible(state)) return null;
  const site = activeSite(landscapeOf(state));
  if (LANDSCAPE_SITES_BY_ID.get(site)?.chronicleEvent !== eventId || hasChapter(state, site, 'signature')) return null;
  return `${CHRONICLE_ICON} Schreibt ein Kapitel der Chronik: „${chapterTitle(site, 'signature', false)}“ – gleich, wie du dich entscheidest.`;
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

/** Neue Kapitel je Wald (unbekannte Wälder übergangen, jedes Kapitel einmal). */
function groupNews(news: readonly ChapterNews[]): Map<SiteId, ChapterId[]> {
  const bySite = new Map<SiteId, ChapterId[]>();
  for (const n of news) {
    if (!LANDSCAPE_SITES_BY_ID.has(n.site)) continue;
    const list = bySite.get(n.site) ?? [];
    if (!list.includes(n.chapter)) list.push(n.chapter);
    bySite.set(n.site, list);
  }
  return bySite;
}

/**
 * Punkt im Rückkehr-Bericht für neue Kapitel (26.4 „Meldung“):
 * „📜 Neues Kapitel im Auwald am Fluss: Frühjahrshochwasser.“ – je Wald ein Satz; ist die
 * Chronik damit vollständig, dazu das Andenken. '' ohne Kapitel oder vor der Landschaft.
 */
export function chapterNewsText(state: ChronicleHolder, news: readonly ChapterNews[]): string {
  if (news.length === 0 || !chronicleVisible(state)) return '';
  const bySite = groupNews(news);
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

/** Eine Meldung neuer Kapitel als eigener Stempel (Playtest Phase 9, F4). */
export interface ChapterNote {
  text: string;
  /** Andenken, wenn die Chronik damit vollständig ist – dann ein hervorgehobener Zettel. */
  keepsake: Keepsake | null;
}

/**
 * Neue Kapitel als eigene Meldungen statt im Sammelzettel (F4): ein Stempel für alle Wälder ohne
 * Abschluss („📜 Neues Kapitel im Auwald am Fluss: Frühjahrshochwasser.“), je abgeschlossener
 * Chronik ein eigener Zettel mit Andenken („📜 Die Chronik im Bergmischwald ist vollständig! …“).
 * Leer ohne Kapitel oder vor der Landschaft.
 */
export function chapterNotes(state: ChronicleHolder, news: readonly ChapterNews[]): ChapterNote[] {
  if (news.length === 0 || !chronicleVisible(state)) return [];
  const bySite = groupNews(news);
  const plain: string[] = [];
  const done: ChapterNote[] = [];
  for (const [site, chapters] of bySite) {
    const titles = chapters.map((c) => chapterTitle(site, c, true));
    const head = titles.length === 1 ? 'Neues Kapitel' : 'Neue Kapitel';
    const keepsake = chronicleComplete(state, site) ? keepsakeOf(site) : null;
    if (keepsake) {
      const where = siteIn(site);
      done.push({
        text: `${CHRONICLE_ICON} Die Chronik ${where} ist vollständig! Letztes Kapitel: ${titles.join(', ')}. Andenken: ${keepsake.name} – „${keepsake.text}“`,
        keepsake,
      });
    } else {
      plain.push(`${CHRONICLE_ICON} ${head} ${siteIn(site)}: ${titles.join(', ')}.`);
    }
  }
  return [...(plain.length > 0 ? [{ text: plain.join(' '), keepsake: null }] : []), ...done];
}

/** Zahl der gemeldeten neuen Kapitel (bekannte Wälder, je Wald jedes Kapitel einmal); 0 vor der Landschaft. */
export function chapterNewsCount(state: ChronicleHolder, news: readonly ChapterNews[]): number {
  if (!chronicleVisible(state)) return 0;
  let n = 0;
  for (const chapters of groupNews(news).values()) n += chapters.length;
  return n;
}

/** Kurzfassung des Rückkehr-Berichts (F7): „📜 1 neues Kapitel“, „📜 3 neue Kapitel“; '' bei 0. */
export function chapterCountText(n: number): string {
  if (!(n > 0)) return '';
  return n === 1 ? `${CHRONICLE_ICON} 1 neues Kapitel` : `${CHRONICLE_ICON} ${formatNumber(n)} neue Kapitel`;
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
    // Offene Kapitel beim Namen (Playtest Phase 9, F8) statt sechsmal desselben Satzes.
    const isFounded = founded.has(site.id) && view !== null;
    return {
      key: site.id,
      icon: '?',
      name: '???',
      site: isFounded ? `${label} · ${view.count}` : `${label} · noch nicht gegründet`,
      text: isFounded ? `Noch offen: ${view.open.join(', ')}.` : 'Mit der Gründung beginnt seine Chronik.',
      complete: false,
    };
  });
}
