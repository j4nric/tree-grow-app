/**
 * Ansichten für den Reiter „Landschaft“ und die Unterseite „Standort“ (docs/ALBUM_UI.md, B.5
 * und A.10). Reine Funktionen ohne DOM – getestet in tests/album-landscape.test.ts. Die
 * Regeln (was wählbar ist, was es kostet) stehen schon in der Ansicht der Karte
 * (`toLandscapeMapView`, landscape-view.ts); hier steht nur, was das Album daraus zeigt.
 */
import type { SiteId } from '../../../content/landscape';
import { formatNumber } from '../../format';
import {
  targetText,
  type LandscapeCorridorView,
  type LandscapeMapView,
  type LandscapeSiteView,
} from '../../landscape-view';
import type { JournalLandscapeRowView, JournalLandscapeView } from '../../view-model';

/** Kennzahl rechts im Seitenkopf, z. B. „🪶 3 Hähersaat“. */
export function landscapePageMeta(view: Pick<LandscapeMapView, 'available'> | null): string {
  return view ? `🪶 ${formatNumber(view.available)} Hähersaat` : '';
}

/**
 * Ziel des nächsten Zyklus (D.2 `albumTarget`): der gewählte Standort, solange er wählbar ist,
 * sonst der aktive Wald („hier“). Ohne Ansicht (Landschaft verborgen) gibt es keins.
 */
export function resolveTarget(view: Pick<LandscapeMapView, 'active' | 'sites'> | null, chosen: SiteId | null): SiteId | null {
  if (!view) return null;
  const pick = view.sites.find((s) => s.id === chosen);
  return pick && pick.action !== null ? pick.id : view.active;
}

/** Ist dieser Standort ein anderes Ziel als „hier“ (und darf der Zyklus beginnen)? */
export function isOtherTarget(view: Pick<LandscapeMapView, 'allowed'>, site: Pick<LandscapeSiteView, 'id' | 'active'>, target: SiteId | null): boolean {
  return view.allowed && !site.active && site.id === target;
}

/** Zusatz im Knopf auf der Karte nur für Screenreader: „, Ziel des nächsten Zyklus“. */
export function siteButtonExtra(view: Pick<LandscapeMapView, 'allowed'>, site: Pick<LandscapeSiteView, 'id' | 'active'>, target: SiteId | null): string {
  return isOtherTarget(view, site, target) ? ', Ziel des nächsten Zyklus' : '';
}

/** Zeile „Ziel des nächsten Zyklus“ unter der Karte; null, solange kein Zyklus möglich ist. */
export function targetLine(view: LandscapeMapView, target: SiteId | null): string | null {
  if (!view.allowed) return null;
  const site = view.sites.find((s) => s.id === target);
  const active = view.sites.find((s) => s.id === view.active);
  return targetText(site, active ? `${active.icon} ${active.name}` : '');
}

/** Knopf „Als Ziel wählen“ auf U:Standort. */
export interface SiteChoiceView {
  /** Knopf zeigen (wählbar, nicht der aktive Wald, Zyklus möglich). */
  visible: boolean;
  /** Schon das Ziel (der Knopf ist gedrückt; erneut tippen heißt „doch hier bleiben“). */
  chosen: boolean;
  label: string;
  /** Zeile unter dem Knopf, z. B. „Der nächste Zyklus gründet hier einen neuen Wald (3 🪶).“ */
  hint: string;
}

export function siteChoiceView(view: LandscapeMapView, site: LandscapeSiteView, target: SiteId | null): SiteChoiceView {
  const visible = view.allowed && !site.active && site.action !== null;
  const chosen = visible && site.id === target;
  const what =
    site.action === 'found'
      ? `gründet hier einen neuen Wald (${formatNumber(site.cost ?? 0)} 🪶)`
      : 'wechselt hierher';
  return {
    visible,
    chosen,
    label: chosen ? '✓ Ziel des nächsten Zyklus' : 'Als Ziel wählen',
    hint: visible ? (chosen ? `Der nächste Zyklus ${what}. Erneut tippen: doch hier bleiben.` : `Der nächste Zyklus ${what}.`) : '',
  };
}

/** Kurzer Satz über dem Standort (Live-Ansage nach „Als Ziel wählen“ bzw. Tipp auf die Karte). */
export function siteAnnouncement(view: LandscapeMapView, site: LandscapeSiteView, target: SiteId | null): string {
  const what = isOtherTarget(view, site, target) ? 'Ziel des nächsten Zyklus.' : (site.blocker ?? '');
  return `${site.name}: ${what}`.trim();
}

/** Text und Name des Bau-Knopfs eines Korridors (scharf: zweiter Klick baut). */
export function corridorBuildLabel(c: Pick<LandscapeCorridorView, 'name' | 'cost'>, armed: boolean): { text: string; label: string } {
  return armed
    ? { text: 'Wirklich bauen? Erneut tippen', label: `${c.name} wirklich bauen? Zum Bestätigen erneut klicken` }
    : { text: `Bauen · ${formatNumber(c.cost)} 🪶`, label: `${c.name} bauen, ${formatNumber(c.cost)} Hähersaat` };
}

/** Angaben aus dem Tagebuch, die U:Standort zusätzlich zeigt (Stammgäste, Tiere). */
const DIARY_KEYS: readonly string[] = ['regulars', 'fauna'];

/** Tagebuch-Zeilen eines gegründeten Waldes für U:Standort (leer, wenn nicht gegründet). */
export function siteDiaryRows(journal: JournalLandscapeView | null, id: SiteId): JournalLandscapeRowView[] {
  const site = journal?.sites.find((s) => s.id === id);
  return site ? site.rows.filter((r) => DIARY_KEYS.includes(r.key)) : [];
}
