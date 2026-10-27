/**
 * Unterseite „Harmonie“ (docs/ALBUM_UI.md, B.1 und A.3 #31–32): woraus sich die Harmonie
 * zusammensetzt, Lebensgemeinschaften live (aktiv, fast, offen, „???“ für unentdeckte, mit
 * Aufleuchten beim Entstehen) und die Harmoniestufen. Erreichbar über „Mehr ›“ in der
 * Harmonie-Notiz und den Link „Lebensgemeinschaften ›“ im Reiter Nischen.
 *
 * DOM einmal bauen; Zeilen entstehen nur für neue Teile bzw. Gemeinschaften.
 */
import { el, setAttr, setText, srOnly } from '../../dom';
import { restartAnimation } from '../../feedback';
import { formatNumber } from '../../format';
import { hyphenate } from '../../hyphenate';
import { formatHarmonyPart, toneOf } from '../../view-format';
import { harmonyOverview } from '../../care-view';
import type { CommunityListView, CommunityView, EcosystemView, HarmonyPartView } from '../../view-model';
import { createBookmark } from '../bookmark';
import { HARMONY_NOTE_TEXT } from '../notes-text';
import { createPage } from '../page';
import { harmonyTierRows } from './niches-view';
import type { PageEnv, Subpage } from './registry';
import './subpage.css';
import './harmony-page.css';

interface CommunityRow {
  root: HTMLLIElement;
  icon: HTMLElement;
  name: HTMLElement;
  note: HTMLElement;
  value: HTMLElement;
  bar: HTMLElement;
  sr: HTMLElement;
  state: CommunityView['state'] | null;
}

function block(title: string, ref: string): HTMLElement {
  const box = el('section', 'sub-section');
  box.dataset.ref = ref;
  box.append(el('h3', 'sub-heading', title));
  return box;
}

export function createHarmonyPage(env: PageEnv): Subpage {
  const page = createPage({ kind: 'harmony', title: 'Harmonie', className: 'album-subpage harmony-page' });
  const bookmark = createBookmark(() => env.back());
  page.element.prepend(bookmark.element);

  // Oben drei Zeilen (DESIGN_V2.md 27.12): Produktion, Vorrat, Bonus.
  const overview = el('dl', 'harmony-overview');
  overview.dataset.ref = 'harmony-overview';
  const overviewRow = (term: string, ref: string): HTMLElement => {
    const row = el('div', 'harmony-overview-row');
    const value = el('dd', 'harmony-overview-value');
    value.dataset.ref = ref;
    row.append(el('dt', 'harmony-overview-term', term), value);
    overview.append(row);
    return value;
  };
  const production = overviewRow('Produktion', 'harmony-production');
  const supply = overviewRow('Vorrat', 'harmony-supply');
  const factor = overviewRow('Bonus', 'harmony-factor');
  const intro = el('p', 'sub-intro', HARMONY_NOTE_TEXT);

  // Zusammensetzung
  const parts = block('Woraus sie sich zusammensetzt', 'harmony-parts');
  const partList = el('ul', 'harmony-parts');
  const partRows: { root: HTMLLIElement; label: HTMLElement; value: HTMLElement }[] = [];
  const total = el('p', 'harmony-total');
  parts.append(partList, total);

  // Lebensgemeinschaften
  const communities = block('Lebensgemeinschaften', 'communities');
  const communityCount = el('p', 'hcom-count');
  communityCount.setAttribute('aria-hidden', 'true');
  const communityCountSr = srOnly();
  const communityList = el('ul', 'hcom-list');
  communityList.setAttribute('aria-label', 'Lebensgemeinschaften');
  communities.append(communityCount, communityCountSr, communityList);
  const communityRows = new Map<string, CommunityRow>();
  let communityOrder = '';

  // Harmoniestufen
  const tiers = block('Harmoniestufen', 'harmony-tiers');
  const tierList = el('ol', 'harmony-tier-list');
  tiers.append(tierList);
  const tierRows: { root: HTMLLIElement; label: HTMLElement; range: HTMLElement }[] = [];

  page.body.append(overview, intro, parts, communities, tiers);

  let shownView: EcosystemView | null = null;
  /** Nach dem ersten Füllen – vorher kein Aufleuchten. */
  let filled = false;

  function updateParts(list: readonly HarmonyPartView[], sum: number): void {
    while (partRows.length < list.length) {
      const li = el('li');
      const label = el('span', 'harmony-part-label');
      const value = el('b', 'harmony-part-value');
      li.append(label, value);
      partList.append(li);
      partRows.push({ root: li, label, value });
    }
    partRows.forEach((row, i) => {
      const part = list[i];
      row.root.hidden = !part;
      if (!part) return;
      setText(row.label, part.label);
      setText(row.value, formatHarmonyPart(part.value));
      const className = `harmony-part tone-${toneOf(part.value)}`;
      if (row.root.className !== className) row.root.className = className;
    });
    setText(total, `Summe: ${formatNumber(Math.round(sum))}`);
  }

  function buildCommunity(id: string): CommunityRow {
    const li = el('li', 'hcom');
    li.dataset.community = id;
    const icon = el('span', 'hcom-icon');
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'hcom-text');
    const name = el('span', 'hcom-name');
    const note = el('span', 'hcom-note');
    text.append(name, note);
    const value = el('span', 'hcom-value');
    value.setAttribute('aria-hidden', 'true');
    const track = el('span', 'hcom-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = el('span', 'hcom-bar');
    track.append(bar);
    const sr = srOnly();
    li.append(icon, sr, text, value, track);
    return { root: li, icon, name, note, value, bar, sr, state: null };
  }

  function updateCommunities(view: CommunityListView): void {
    setText(communityCount, view.summary);
    setText(communityCountSr, view.summaryText);
    for (const item of view.items) {
      let row = communityRows.get(item.id);
      if (!row) {
        row = buildCommunity(item.id);
        communityRows.set(item.id, row);
      }
      const className = `hcom state-${item.state}${item.discovered ? '' : ' undiscovered'}`;
      if (row.root.className.replace(' formed', '') !== className) row.root.className = className;
      if (item.state === 'active' && row.state !== null && row.state !== 'active' && filled) restartAnimation(row.root, 'formed');
      row.state = item.state;
      setText(row.icon, item.icon);
      setText(row.name, hyphenate(item.name));
      const note = item.state === 'active' ? item.effects : (item.missingText ?? (item.discovered ? '' : (item.hint ?? '')));
      setText(row.note, note);
      row.note.hidden = !note;
      const active = item.state === 'active';
      setText(row.value, active ? `+${formatNumber(item.harmony)} ⚖️` : `${formatNumber(item.present)}/${formatNumber(item.total)}`);
      const progress = Number.isFinite(item.progress) ? Math.min(1, Math.max(0, item.progress)) : 0;
      row.bar.style.setProperty('--progress', progress.toFixed(3));
      if (item.discovered) row.name.removeAttribute('aria-hidden');
      else setAttr(row.name, 'aria-hidden', 'true');
      const members = `${formatNumber(item.present)} von ${formatNumber(item.total)} Mitgliedern`;
      setText(
        row.sr,
        active
          ? `Aktiv, +${formatNumber(item.harmony)} Harmonie: `
          : item.discovered
            ? `${members}: `
            : `Noch unentdeckte Lebensgemeinschaft, ${members}. `,
      );
    }
    const order = view.items.map((i) => i.id).join('|');
    if (order !== communityOrder) {
      communityOrder = order;
      communityList.replaceChildren(...view.items.map((i) => communityRows.get(i.id)!.root));
      const present = new Set(view.items.map((i) => i.id));
      for (const id of [...communityRows.keys()]) if (!present.has(id)) communityRows.delete(id);
    }
  }

  function updateTiers(harmony: number): void {
    const rows = harmonyTierRows(harmony);
    while (tierRows.length < rows.length) {
      const li = el('li', 'harmony-tier');
      const label = el('span', 'harmony-tier-label');
      const range = el('span', 'harmony-tier-range');
      li.append(label, range);
      tierList.append(li);
      tierRows.push({ root: li, label, range });
    }
    rows.forEach((row, i) => {
      const refs = tierRows[i]!;
      setText(refs.label, row.label);
      setText(refs.range, row.range);
      refs.root.classList.toggle('current', row.current);
      if (row.current) setAttr(refs.root, 'aria-current', 'true');
      else refs.root.removeAttribute('aria-current');
    });
  }

  /** Vorrat wächst laufend: gedrosselt wie die übrigen Zahlen. */
  let overviewAt = -Infinity;
  function updateOverview(now: number, force = false): void {
    const view = env.eco.view;
    if (!view || (!force && now - overviewAt < 200)) return;
    overviewAt = now;
    const o = harmonyOverview(env.deps.state(), view.harmony, view.harmonyMultiplier);
    setText(production, o.production);
    setText(supply, o.supply);
    setText(factor, o.bonus);
  }

  function update(now = performance.now(), force = false): void {
    updateOverview(now, force);
    const view = env.eco.view;
    if (!view || view === shownView) return;
    shownView = view;
    updateOverview(now, true);
    const harmony = Math.round(view.harmony);
    page.setMeta(`${formatNumber(harmony)} ⚖️ · ${view.harmonyTier}`);
    updateParts(view.harmonyParts, view.harmony);
    updateCommunities(view.communities);
    updateTiers(view.harmony);
    filled = true;
  }

  return {
    page,
    bookmark,
    opened() {
      update(performance.now(), true);
      page.element.scrollTop = 0;
    },
    update,
  };
}
