/**
 * Unterseite „Tier“ (docs/ALBUM_UI.md, B.1 und A.5 #54–65) – ersetzt den Dialog
 * Tierdetails. Gegliedert wie im Prototyp: Kopf mit großem Sticker, Name, Gattung · Nische,
 * Seltenheit und Zufriedenheit; „Was es braucht“ (✓ / ~ / ✗ und weitere Einflüsse); „Was es
 * bewirkt“ (Beitrag, Wirkungen, Fähigkeiten); „Räuber und Beute“ mit „Nahrungsnetz ›“
 * (Ebene 2); Lebensgemeinschaften; Stammgast ★; Notiz zur Art; „Zuerst gesehen“ (nur, wenn
 * der Stand es kennt).
 *
 * Zieht die Art aus, bleibt die Seite offen und zeigt „ist ausgezogen“ (G-11). Reine
 * Darstellung: Die Zahlen kommen aus `toAnimalDetailView`; einzige Aktion ist der
 * Stammgast-Schalter (`toggleRegular`, wie im Tagebuch). Inhalt nur bei Änderung neu.
 */
import { evaluate } from '../../../core/formulas';
import { toAnimalDetailView } from '../../animal-detail-view';
import { el, setAttr, setText, setVar, srOnly } from '../../dom';
import { hyphenate } from '../../hyphenate';
import { RARITY_LABELS, formatPercent, happinessLevel, previewChips, toneSymbol } from '../../view-format';
import type { AnimalDetailView, PreviewView } from '../../view-model';
import { createBookmark } from '../bookmark';
import type { PageRef } from '../nav';
import { createPage } from '../page';
import { STICKER_BIG_SIZE, createStickerImage } from '../sticker';
import { happinessArc, stickerTilt } from '../sticker-rules';
import { animalBasics, firstSeenText, regularToggleView, type AnimalBasics } from './niches-view';
import type { PageEnv, Subpage } from './registry';
import './subpage.css';
import './animal-page.css';

export const GONE_TEXT = 'ist ausgezogen – das Naturtagebuch erinnert sich an die Art.';
const NO_CHANGE_TEXT = 'keine Änderung';

function block(title: string, ref: string): HTMLElement {
  const box = el('section', 'sub-section');
  box.dataset.ref = ref;
  box.append(el('h3', 'sub-heading', title));
  return box;
}

export function createAnimalPage(env: PageEnv): Subpage {
  const page = createPage({ kind: 'animal', title: '', className: 'album-subpage animal-page' });
  const bookmark = createBookmark(() => env.back());
  page.element.prepend(bookmark.element);

  // --- Kopf ------------------------------------------------------------------------------
  const hero = el('span', 'sticker sticker-big');
  hero.setAttribute('aria-hidden', 'true');
  const heroFace = el('span', 'sticker-face');
  const heroImage = createStickerImage(STICKER_BIG_SIZE);
  heroFace.append(heroImage.canvas);
  const heroGem = el('span', 'sticker-gem', '◆');
  hero.append(heroFace, heroGem);
  const headText = el('div', 'animal-head-text');
  const family = el('p', 'animal-family');
  const rarity = el('span', 'animal-rarity');
  const happiness = el('p', 'animal-happiness');
  happiness.dataset.ref = 'detail-happiness';
  const happinessValue = el('b', 'animal-happiness-value');
  const moodText = el('span', 'animal-mood');
  happiness.append(happinessValue, ' ', moodText);
  const stock = el('p', 'animal-stock');
  stock.dataset.ref = 'detail-stock';
  const gone = el('p', 'animal-gone', GONE_TEXT);
  gone.dataset.ref = 'detail-gone';
  headText.append(page.title, family, rarity, happiness, stock, gone);
  page.header.replaceChildren(hero, headText);
  page.header.classList.add('animal-head');

  // --- Was es braucht --------------------------------------------------------------------
  const needs = block('Was es braucht', 'detail-reasons');
  const conditions = el('ul', 'animal-needs');
  conditions.setAttribute('aria-label', 'Futter und Wünsche');
  const factors = el('ul', 'animal-factors');
  factors.setAttribute('aria-label', 'Weitere Einflüsse');
  needs.append(conditions, factors);

  // --- Was es bewirkt --------------------------------------------------------------------
  const effectsBox = block('Was es bewirkt', 'detail-contribution');
  const contribution = el('ul', 'animal-pills animal-contribution');
  contribution.setAttribute('aria-label', 'Beitrag zum Ökosystem gerade');
  const contributionNote = el('p', 'animal-note');
  contributionNote.dataset.ref = 'detail-contribution-note';
  const effects = el('ul', 'animal-pills animal-effects');
  effects.dataset.ref = 'detail-effects';
  effects.setAttribute('aria-label', 'Wirkungen');
  const abilities = el('ul', 'animal-abilities');
  abilities.dataset.ref = 'detail-abilities';
  abilities.setAttribute('aria-label', 'Fähigkeiten');
  effectsBox.append(contribution, contributionNote, effects, abilities);

  // --- Räuber und Beute ------------------------------------------------------------------
  const predationBox = block('Räuber und Beute', 'detail-predation');
  const predation = el('ul', 'animal-factors animal-predation');
  const foodWebLink = el('button', 'sub-link', 'Nahrungsnetz ›');
  foodWebLink.type = 'button';
  foodWebLink.dataset.ref = 'detail-food-web';
  foodWebLink.addEventListener('click', () => env.open({ kind: 'foodweb' }));
  predationBox.append(predation, foodWebLink);

  // --- Lebensgemeinschaften --------------------------------------------------------------
  const communitiesBox = block('Lebensgemeinschaften', 'detail-communities');
  const communities = el('ul', 'animal-communities');
  communitiesBox.append(communities);

  // --- Stammgast, Notiz, Zuerst gesehen --------------------------------------------------
  const regularRow = el('div', 'animal-regular');
  const regularToggle = el('button', 'animal-regular-toggle');
  regularToggle.type = 'button';
  regularToggle.dataset.ref = 'detail-regular-toggle';
  const regularStar = el('span', 'animal-regular-star');
  regularStar.setAttribute('aria-hidden', 'true');
  const regularToggleText = el('span', 'animal-regular-label');
  regularToggle.append(regularStar, regularToggleText);
  const regular = el('p', 'animal-regular-text');
  regular.dataset.ref = 'detail-regular';
  regularRow.append(regularToggle, regular);
  regularToggle.addEventListener('click', () => {
    if (speciesId && !regularToggle.disabled) env.deps.actions.toggleRegular(speciesId);
  });

  const flavor = el('div', 'animal-flavor');
  flavor.dataset.ref = 'detail-flavor';
  const flavorText = el('p', 'animal-flavor-text');
  flavor.append(flavorText);
  const firstSeen = el('p', 'animal-first-seen');
  firstSeen.dataset.ref = 'detail-first-seen';

  page.body.append(needs, effectsBox, predationBox, communitiesBox, regularRow, flavor, firstSeen);

  let speciesId: string | null = null;
  let shownSerial = -1;
  let lastEvaluation: unknown = null;
  let lastExtra = '';
  let signature = '';
  /** Zuletzt gezeigte Ansicht der lebenden Art (für „ist ausgezogen“). */
  let lastView: AnimalDetailView | null = null;

  // --- Darstellung -----------------------------------------------------------------------
  function renderHead(basics: AnimalBasics, live: AnimalDetailView | null): void {
    page.element.dataset.species = basics.id;
    const shown = hyphenate(basics.name);
    page.setTitle(shown);
    if (shown !== basics.name) setAttr(page.title, 'aria-label', basics.name);
    else page.title.removeAttribute('aria-label');
    setText(family, `${basics.familyIcon} ${basics.familyLabel} · ${basics.nicheLabel}`);
    setText(rarity, RARITY_LABELS[basics.rarity]);
    setAttr(rarity, 'data-rarity', basics.rarity);
    setAttr(hero, 'data-family', basics.family);
    setAttr(hero, 'data-rarity', basics.rarity);
    setVar(hero, '--tilt', `${stickerTilt(basics.id, 0)}deg`);
    const level = live ? happinessLevel(live.happiness) : 'mid';
    setAttr(hero, 'data-happy', live ? level : 'plant');
    setVar(hero, '--arc', `${happinessArc(live?.happiness ?? 0)}deg`);
    heroImage.draw(basics.id, live ? 'color' : 'muted', basics.family);
    page.element.classList.toggle('is-gone', !live);
    gone.hidden = live !== null;
    happiness.hidden = !live;
    if (live) {
      setText(happinessValue, `😊 ${formatPercent(live.happiness)}`);
      setAttr(happinessValue, 'aria-label', `Zufriedenheit ${formatPercent(live.happiness)}`);
      setText(moodText, live.mood);
    }
    const stockRow = live?.predation.find((p) => p.key === 'stock');
    setText(stock, stockRow ? `${stockRow.icon} ${stockRow.label}` : '');
    stock.hidden = !stockRow;
    setText(flavorText, basics.text ?? '');
    flavor.hidden = !basics.text;
  }

  function renderChips(list: HTMLElement, preview: PreviewView): void {
    list.replaceChildren(
      ...previewChips(preview).map((part) => {
        if (part === 'none') {
          const li = el('li', 'animal-pill tone-neutral', NO_CHANGE_TEXT);
          return li;
        }
        const li = el('li', `animal-pill tone-${part.tone}`);
        const value = el('span', '', `${part.value} ${part.icon}`);
        value.setAttribute('aria-hidden', 'true');
        li.append(value, srOnly(part.text));
        return li;
      }),
    );
  }

  function renderLive(view: AnimalDetailView): void {
    // Was es braucht: Futter und Wünsche (✓ / ~ / ✗), dann weitere Einflüsse.
    conditions.replaceChildren(
      ...view.conditions.map((condition) => {
        const state = condition.met ? (condition.partial ? 'partial' : 'met') : 'unmet';
        const li = el('li', `animal-need ${state}`);
        const mark = el('span', 'animal-mark', state === 'met' ? '✓' : state === 'partial' ? '~' : '✗');
        mark.setAttribute('aria-hidden', 'true');
        const text = el('span', 'animal-need-text', condition.label);
        li.append(mark, text, srOnly(state === 'met' ? ' (erfüllt)' : state === 'partial' ? ' (teilweise)' : ' (fehlt)'));
        if (condition.hint) text.append(el('span', 'animal-need-hint', condition.hint));
        return li;
      }),
    );
    factors.replaceChildren(
      ...view.factors.map((factor) => {
        const li = el('li', `animal-factor tone-${factor.tone}`);
        li.dataset.factor = factor.key;
        const icon = el('span', 'animal-mark', factor.icon);
        icon.setAttribute('aria-hidden', 'true');
        li.append(icon, el('span', '', factor.label));
        return li;
      }),
    );

    // Was es bewirkt: Beitrag gerade, Wirkungen, Fähigkeiten.
    renderChips(contribution, view.contribution);
    setText(contributionNote, view.contributionNote);
    effects.replaceChildren(
      ...view.effects.map((effect) => {
        const li = el('li', `animal-pill tone-${effect.tone}`);
        const mark = el('span', 'animal-mark', toneSymbol(effect.tone));
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', '', effect.label));
        return li;
      }),
    );
    effects.hidden = view.effects.length === 0;
    abilities.replaceChildren(
      ...view.abilities.map((ability) => {
        const li = el('li', 'animal-ability');
        li.append(el('b', '', `✨ ${ability.name}`), el('span', '', ` – ${ability.text}`));
        return li;
      }),
    );
    abilities.hidden = view.abilities.length === 0;

    // Räuber und Beute (der Bestand steht schon im Kopf).
    const rows = view.predation;
    predation.replaceChildren(
      ...rows.map((row) => {
        const li = el('li', `animal-factor tone-${row.tone}`);
        li.dataset.predation = row.key;
        const icon = el('span', 'animal-mark', row.icon);
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'animal-predation-text');
        text.append(el('span', '', row.label));
        if (row.hint) text.append(el('span', 'animal-need-hint', row.hint));
        li.append(icon, text);
        return li;
      }),
    );
    predationBox.hidden = rows.length === 0;

    communities.replaceChildren(
      ...view.communities.map((c) => {
        const li = el('li', `animal-community${c.active ? ' active' : ''}${c.discovered ? '' : ' undiscovered'}`);
        // Nur entdeckte tragen ihre ID – Unentdeckte verraten nichts (Spoiler-Regel).
        if (c.discovered) li.dataset.community = c.key;
        const icon = el('span', 'animal-community-icon', c.icon);
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'animal-community-text');
        text.append(el('b', '', c.name));
        const state = c.active ? 'besteht gerade' : (c.progress ?? '');
        if (state) text.append(el('span', 'animal-community-note', state));
        if (c.effect) text.append(el('span', 'animal-community-note', c.effect));
        if (c.hint) text.append(el('span', 'animal-community-note', c.hint));
        li.append(icon, text);
        return li;
      }),
    );
    communitiesBox.hidden = view.communities.length === 0;
  }

  function renderRegular(text: string | null, toggle: { selected: boolean; disabled: boolean } | null, name: string): void {
    // „☆ Kein Stammgast – im Naturtagebuch wählbar“ ist neben dem Schalter überflüssig.
    const shown = toggle && !toggle.selected ? '' : (text ?? '');
    setText(regular, shown);
    regular.hidden = !shown;
    regularToggle.hidden = toggle === null;
    if (toggle) {
      setText(regularStar, toggle.selected ? '★' : '☆');
      setText(regularToggleText, toggle.selected ? 'Stammgast' : 'Als Stammgast wählen');
      setAttr(regularToggle, 'aria-pressed', String(toggle.selected));
      regularToggle.disabled = toggle.disabled;
      setAttr(regularToggle, 'aria-label', `${name} als Stammgast${toggle.disabled ? ' – alle Plätze belegt' : ''}`);
      if (toggle.disabled) regularToggle.title = 'Alle Plätze für Stammgäste sind belegt';
      else regularToggle.removeAttribute('title');
    }
    regularRow.hidden = !shown && toggle === null;
  }

  /** Inhalt neu, wenn sich Auswertung, Stammgäste oder Tagebuch geändert haben (`force`: immer). */
  function refresh(force: boolean): void {
    if (!speciesId) return;
    const state = env.deps.state();
    const ev = evaluate(state);
    const extra = `${state.meta.regulars.join(',')}|${state.meta.journal.communities.join(',')}|${state.meta.forestMemory}|${state.cycle.elapsed >= 0 ? Math.floor(state.cycle.elapsed / 30) : 0}`;
    if (!force && ev === lastEvaluation && extra === lastExtra) return;
    lastEvaluation = ev;
    lastExtra = extra;
    const view = toAnimalDetailView(state, speciesId, ev);
    const toggle = regularToggleView(state, speciesId);
    const seen = firstSeenText(state, speciesId);
    const next = JSON.stringify([view, toggle, seen]);
    if (!force && next === signature) return;
    signature = next;
    const basics = view ?? (lastView?.id === speciesId ? lastView : null) ?? animalBasics(speciesId);
    if (!basics) return;
    if (view) lastView = view;
    renderHead(basics, view);
    for (const box of [needs, effectsBox]) box.hidden = !view;
    if (view) renderLive(view);
    else {
      predationBox.hidden = true;
      communitiesBox.hidden = true;
    }
    renderRegular(view?.regular ?? null, toggle, basics.name);
    setText(firstSeen, seen);
    firstSeen.hidden = !seen;
  }

  return {
    page,
    bookmark,
    opened(ref: PageRef) {
      if (ref.kind !== 'animal') return;
      if (speciesId !== ref.id) {
        speciesId = ref.id;
        lastView = null;
        page.element.scrollTop = 0;
      }
      shownSerial = env.eco.serial;
      refresh(true);
    },
    update() {
      if (env.eco.serial === shownSerial) return;
      shownSerial = env.eco.serial;
      refresh(false);
    },
  };
}
