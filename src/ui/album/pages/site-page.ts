/**
 * Unterseite „Standort“ (docs/ALBUM_UI.md, A.10 #110 und #114): Tipp auf einen Standort der
 * Karte (oder einen Wald im Tagebuch, oder den Ziel-Wald auf U:Neuer Zyklus) blättert hierher.
 * Zeigt Waldtyp, Stimmungstext, Gedächtnis, Baum, Urwald, Eigenheit, Verzicht, Gabe, Wetter und den
 * Grund, falls er nicht wählbar ist; bei gegründeten Wäldern dazu Stammgäste und Tiere aus dem
 * Tagebuch. „Als Ziel wählen“ setzt das gemeinsame Ziel des nächsten Zyklus (`albumTarget`),
 * „Neuer Zyklus ›“ blättert zu U:Neuer Zyklus im Reiter „Ziele“.
 *
 * Einmal gebaut; `opened(ref)` füllt sie, `update` zieht nur bei neuer Ansicht bzw. neuem Ziel nach.
 */
import type { SiteId } from '../../../content/landscape';
import { el, setAttr, setText, srOnly } from '../../dom';
import { restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import { toJournalLandscapeView } from '../../journal-landscape-view';
import type { LandscapeMapView } from '../../landscape-view';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber } from '../nav';
import type { PageEnv, Subpage } from './registry';
import { siteAnnouncement, siteChoiceView, siteDiaryRows } from './landscape-page-view';
import './landscape.css';

export interface SitePage extends Subpage {
  /** Gezeigter Standort (null vor dem ersten Öffnen). */
  readonly id: SiteId | null;
}

export function createSitePage(env: PageEnv): SitePage {
  const albumTarget = env.albumTarget;
  const page = createPage({
    kind: 'site',
    title: 'Standort',
    number: pageNumber({ ...initialNav('landscape'), stack: [{ kind: 'site', id: 'home' }] }),
    className: 'album-subpage site-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Landschaft');
  page.element.prepend(bookmark.element);
  page.meta.dataset.ref = 'site-status';
  page.body.classList.add('lsc-body');
  page.body.dataset.ref = 'site-detail';

  const type = el('p', 'site-type');
  const text = el('p', 'site-text');
  const lines = el('div', 'site-lines');
  const memory = el('p', 'site-line');
  memory.dataset.ref = 'site-memory';
  const tree = el('p', 'site-line');
  const ancient = el('p', 'site-line');
  const gains = el('p', 'site-line site-gain');
  const costs = el('p', 'site-line site-cost');
  const gift = el('p', 'site-line site-gift');
  // Wetter des Waldtyps (DESIGN_V2.md 24.14), z. B. „🌫️ Oft Nebel über dem Wasser, selten Dürre.“
  const weather = el('p', 'site-line site-weather');
  weather.dataset.ref = 'site-weather';
  lines.append(memory, tree, ancient, gains, costs, gift, weather);
  const blocker = el('p', 'site-blocker');
  blocker.dataset.ref = 'site-blocker';

  // „Als Ziel wählen“ – gedrückt, solange der Standort das Ziel ist.
  const choice = el('div', 'site-choice');
  const choose = el('button', 'site-choose');
  choose.type = 'button';
  choose.dataset.ref = 'site-choose';
  const choiceHint = el('p', 'site-choice-hint');
  choiceHint.id = 'site-choice-hint';
  choiceHint.dataset.ref = 'site-choice-hint';
  choose.setAttribute('aria-describedby', choiceHint.id);
  const cycleOpen = el('button', 'lsc-more', 'Neuer Zyklus ›');
  cycleOpen.type = 'button';
  cycleOpen.dataset.ref = 'site-cycle-open';
  cycleOpen.setAttribute('aria-label', 'Neuer Zyklus (im Reiter Ziele)');
  cycleOpen.addEventListener('click', () => env.goto('goals', { kind: 'cycle' }));
  choice.append(choose, choiceHint, cycleOpen);

  // Tagebuch: Stammgäste und Tiere (nur gegründete Wälder).
  const diary = el('section', 'site-diary');
  const diaryTitle = el('h3', 'lsc-title', 'Im Tagebuch');
  const diaryList = el('dl', 'lsc-facts');
  diaryList.dataset.ref = 'site-diary';
  diary.append(diaryTitle, diaryList);

  // Ansage nur bei Auswahländerungen (die Angaben selbst ändern sich laufend).
  const live = srOnly();
  live.dataset.ref = 'landscape-live';
  live.setAttribute('aria-live', 'polite');

  page.body.append(type, text, lines, blocker, choice, diary, live);

  let id: SiteId | null = null;
  let shownView: LandscapeMapView | null = null;
  let shownTarget: SiteId | null = null;
  let shownDiary = '';

  choose.addEventListener('click', () => {
    const view = albumTarget.view();
    const site = view?.sites.find((s) => s.id === id);
    if (!view || !site) return;
    const before = siteChoiceView(view, site, albumTarget.target());
    albumTarget.choose(before.chosen ? null : site.id);
    render(true);
    const after = albumTarget.target();
    // Leeren und neu setzen: dieselbe Ansage auch beim zweiten Mal.
    live.textContent = '';
    live.textContent = before.chosen ? `${site.name}: Ziel zurückgenommen, der nächste Baum keimt hier.` : siteAnnouncement(view, site, after);
    if (!before.chosen) restartAnimation(choose, 'site-chosen');
  });

  function render(force: boolean): void {
    const view = albumTarget.view();
    const tgt = albumTarget.target();
    if (!force && view === shownView && tgt === shownTarget) return;
    const fresh = force || view !== shownView;
    shownView = view;
    shownTarget = tgt;
    const site = view?.sites.find((s) => s.id === id);
    page.body.hidden = !site;
    if (!view || !site) {
      // Landschaft gesperrt (Import eines älteren Stands): kein veralteter Titel.
      page.setTitle('Standort');
      page.setMeta('');
      delete page.element.dataset.siteId;
      return;
    }
    page.element.dataset.siteId = site.id;
    page.setTitle(`${site.icon} ${site.name}`);
    page.setMeta(site.status);
    page.element.classList.toggle('active', site.active);
    setText(type, hyphenate(site.forestType));
    setText(text, site.text);
    setText(memory, site.memory);
    setText(tree, site.tree);
    ancient.hidden = site.ancientText === null;
    setText(ancient, site.ancientText ?? '');
    gains.hidden = site.gains === null;
    setText(gains, site.gains ? `Eigenheit (nur hier): ${site.gains}` : '');
    costs.hidden = site.costs === null;
    setText(costs, site.costs ? `Verzicht (nur hier): ${site.costs}` : '');
    gift.hidden = site.gift === null;
    setText(gift, site.gift ? `Gabe (${site.giftActive ? 'wirkt schon' : 'nach der Gründung'}): ${site.gift}` : '');
    gift.classList.toggle('inactive', !site.giftActive);
    weather.hidden = site.weather === null;
    setText(weather, site.weather ? `Wetter: ${site.weather}` : '');
    blocker.hidden = site.blocker === null;
    setText(blocker, site.blocker ?? '');

    const c = siteChoiceView(view, site, tgt);
    choice.hidden = !c.visible;
    choose.classList.toggle('chosen', c.chosen);
    setAttr(choose, 'aria-pressed', String(c.chosen));
    setText(choose, c.label);
    setText(choiceHint, c.hint);
    cycleOpen.hidden = !c.chosen;

    if (!fresh) return;
    const rows = siteDiaryRows(toJournalLandscapeView(env.deps.state()), site.id);
    const key = JSON.stringify(rows);
    diary.hidden = rows.length === 0;
    if (key !== shownDiary) {
      shownDiary = key;
      diaryList.replaceChildren(
        ...rows.map((r) => {
          const wrap = el('div', 'lsc-facts-row');
          wrap.dataset.row = r.key;
          wrap.append(el('dt', '', r.label), el('dd', '', hyphenate(r.value)));
          return wrap;
        }),
      );
    }
  }

  return {
    page,
    bookmark,
    get id() {
      return id;
    },
    opened(ref) {
      if (ref.kind !== 'site') return;
      id = ref.id;
      live.textContent = '';
      render(true);
      // Nicht wählbar: den Grund ansagen (A.10 #110, Live-Ansage).
      const view = albumTarget.view();
      const site = view?.sites.find((s) => s.id === id);
      if (view && site?.blocker) live.textContent = siteAnnouncement(view, site, albumTarget.target());
    },
    update(_now, force) {
      render(force === true);
    },
  };
}
