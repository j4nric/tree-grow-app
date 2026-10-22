/**
 * Unterseite „Pflanze setzen“ (docs/ALBUM_UI.md, A.6 #81 und B.1) – ersetzt den Dialog der
 * Pflanzenwahl. Vom Knopf „🌱 Pflanze setzen“ im Reiter Nischen aus umgeblättert: Kopf mit
 * Pflanzring-Zeile und Samen („Du hast 120 🌰 – noch 20 🌰 bis zur nächsten Pflanze“),
 * darunter die Pflanzen als Zettel mit „Setzen (−x 🌰)“ bzw. Sperrgrund.
 *
 * Nach dem Setzen blättert main.ts über `closePlantPicker` zurück zu den Nischen (dort klebt
 * die neue Pflanze). Liste nur bei Änderungen neu, die Samenzeile gedrosselt.
 */
import { evaluate, nextPlantCost } from '../../../core/formulas';
import { toPlantPickerView } from '../../adapters';
import { el, setText } from '../../dom';
import { createPlantOffers } from '../../plant-offers';
import { seedsLine } from '../../view-format';
import { createBookmark } from '../bookmark';
import { initialNav, pageNumber } from '../nav';
import { createPage, type Page } from '../page';
import { tapeStrip } from '../../encounter-cards';
import type { PageEnv, Subpage } from './registry';
import './subpage.css';
import './encounter-page.css';

/** Samenzeile höchstens so oft neu (sie ändert sich mit jedem Frame). */
const SEEDS_REFRESH_MS = 200;

export interface PlantPickerPage extends Subpage {
  /** Liste neu bauen (nach einer Aktion, neuer Stufe, Zahlenformat). */
  invalidate(): void;
}

export function createPlantPickerPage(env: PageEnv): PlantPickerPage {
  const deps = env.deps;
  const base = createPage({
    kind: 'plant-picker',
    title: 'Pflanze setzen',
    number: pageNumber({ ...initialNav(), stack: [{ kind: 'plant-picker' }] }),
    className: 'album-subpage plant-picker-page',
  });
  const bookmark = createBookmark(() => env.back());
  base.element.prepend(bookmark.element);

  // Kopf als Zettel wie auf U:Begegnung.
  const head = el('div', 'enc-head');
  const headText = el('div', 'encounter-head-text');
  const kind = el('p', 'encounter-kind', '🌱 Samen in die Erde');
  base.title.classList.add('encounter-title');
  const subtitle = el('p', 'encounter-subtitle picker-subtitle');
  subtitle.dataset.ref = 'picker-subtitle';
  const seedsText = el('p', 'picker-seeds');
  seedsText.dataset.ref = 'picker-seeds';
  headText.append(kind, base.title, subtitle, seedsText);
  head.append(tapeStrip(), headText);
  base.header.replaceChildren(head);
  base.header.classList.add('enc-page-head');

  const offers = createPlantOffers((plantId) => deps.actions.plant(plantId));
  base.body.append(offers.element);

  const page: Page = {
    ...base,
    focusTitle() {
      if (!offers.focusFirst()) base.focusTitle();
    },
  };

  let opened = false;
  let dirty = true;
  let cost = 0;
  let shownAffordable: boolean | null = null;
  let seedsShown = -1;
  let seedsAt = -Infinity;

  deps.preferences.onChange(() => (dirty = true));

  function updateSeeds(seeds: number): void {
    setText(seedsText, seedsLine(seeds, cost));
    seedsText.classList.toggle('short', seeds < cost);
  }

  function refresh(now: number): void {
    if (!opened) return;
    const state = deps.state();
    const affordable = state.seeds >= nextPlantCost(state);
    if (!dirty && affordable === shownAffordable) {
      const whole = Math.floor(state.seeds);
      if (whole !== seedsShown || now - seedsAt >= SEEDS_REFRESH_MS) {
        seedsShown = whole;
        seedsAt = now;
        updateSeeds(state.seeds);
      }
      return;
    }
    dirty = false;
    shownAffordable = affordable;
    seedsShown = Math.floor(state.seeds);
    seedsAt = now;
    const view = toPlantPickerView(state, evaluate(state));
    cost = view.cost;
    base.setTitle(view.title);
    setText(subtitle, view.subtitle);
    updateSeeds(state.seeds);
    offers.show(view.offers);
  }

  return {
    page,
    bookmark,
    opened() {
      opened = true;
      dirty = true;
      offers.clear();
      offers.guard();
      refresh(performance.now());
    },
    update(now) {
      refresh(now);
    },
    reset() {
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
  };
}
