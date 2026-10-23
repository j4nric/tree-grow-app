/**
 * Reiter „Arten“ – „Wer war schon da?“ · „23 von 53 Arten“ (docs/ALBUM_UI.md, B.2 und A.7
 * #83–88, #92). Ersetzt den Dialog „Naturtagebuch“ (ohne Erfolge und Statistik – die stehen
 * unter „Ziele“ – und ohne Landschaft, die Schritt 10 übernimmt).
 *
 * - Kopf: Zähler, Zyklus und Waldgedächtnis, Stammgäste (`journal-*`).
 * - Sprungmarken als Washi-Streifen: Tiere · Pflanzen · Gemeinschaften · Andenken.
 * - Tiere: Sticker-Raster nach Gattung mit „n von m“. Farbig, wenn die Art im Wald lebt, matt,
 *   wenn sie entdeckt, aber nicht da ist, unentdeckt als Silhouette mit „???“. ★ schaltet
 *   Stammgäste (dieselbe Aktion wie auf U:Tier), ein grüner Punkt heißt „lebt hier“. Tipp →
 *   U:Tier; Tipp auf eine Silhouette → Haftnotiz mit Hinweis statt Spoiler.
 * - Pflanzen: Sticker mit Gruppen-Emoji, Tipp → Haftnotiz mit Fakten und Text.
 * - Gemeinschaften: Liste mit Mitgliedern, Wirkung, Fortschritt und „besteht gerade“.
 * - Andenken: Hauptbaum-Arten als Samentütchen (★/✓/🔒) und Erinnerungen als Zettel.
 *
 * Leistung: Das Raster ist fest (eine Zelle je Art bzw. Pflanze, einmal gebaut); beim ersten
 * Zeigen ist nur der erste Bildschirm sichtbar, der Rest kommt Block für Block in Leerlaufzeit
 * dazu (deferred-reveal.ts, R3). `update`
 * setzt nur Klassen, Texte und das Bild. Bilder zeichnet erst ein IntersectionObserver, wenn
 * die Zelle ins Bild kommt; matte Bilder und Silhouetten laufen über die IdleQueue
 * (sticker.ts). Gemeinschaften und Andenken entstehen nur bei Änderungen neu. Die Ansicht
 * (`toJournalView`) wird nur gerechnet, wenn sich die Auswertung oder `speciesPageKey` ändern.
 */
import { COMMUNITIES } from '../../../content/communities';
import { PLANTS } from '../../../content/plants';
import { COMMON_SPECIES, SPECIES } from '../../../content/species';
import { evaluate } from '../../../core/formulas';
import { IdleQueue } from '../../../render/idle';
import { toJournalView } from '../../adapters';
import { el, setAttr, setText, srOnly } from '../../dom';
import { prefersReducedMotion } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import { RARITY_LABELS } from '../../view-format';
import type { ChronicleKeepsakeView } from '../../chronicle-view';
import type { JournalCommunityView, JournalEntryView, JournalKeepsakeView, JournalTreeView, JournalView } from '../../view-model';
import { openNote } from '../note';
import { STICKER_DRAW_SIZE, createStickerImage, stickerDprEpoch, type StickerImage } from '../sticker';
import { stickerTilt } from '../sticker-rules';
import type { StickerVariant } from '../../../render/sticker';
import type { PageEnv, TabPage } from './registry';
import {
  discoveredIn,
  kennartCaption,
  kennartIndices,
  ofCount,
  plantNote,
  silhouetteHint,
  speciesGroups,
  speciesPageHeader,
  speciesPageKey,
  speciesStickerVariant,
} from './species-view';
import { createTabPanel } from './tab-pages';
import { createDeferredReveal, deferBlock, estimateGridHeight, initialGroupCount, revealOnFind, showBlock } from './deferred-reveal';
import '../sticker.css';
import './species-page.css';

export type SpeciesPage = TabPage;

/** Abschnitte mit Sprungmarke. */
const SECTIONS = [
  { id: 'animals', label: 'Tiere' },
  { id: 'plants', label: 'Pflanzen' },
  { id: 'communities', label: 'Gemeinschaften' },
  { id: 'keepsakes', label: 'Andenken' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Ein Platz im Raster (Tier oder Pflanze), einmal gebaut. */
interface Cell {
  li: HTMLLIElement;
  button: HTMLButtonElement;
  name: HTMLElement;
  sr: HTMLElement;
  /** Nur Tiere: Bild, Stammgast-Stern, Punkt „lebt hier“. */
  image?: StickerImage;
  star?: HTMLButtonElement;
  starIcon?: HTMLElement;
  emoji?: HTMLElement;
  /** Zuletzt gezeigter Eintrag. */
  entry: JournalEntryView | null;
  /** Gewünschtes Bild; gezeichnet, sobald die Zelle sichtbar ist. */
  drawId: string;
  variant: StickerVariant;
  family: string;
  visible: boolean;
}

/**
 * So viele Zellen zeigt der erste Wechsel sofort – heute die erste Gattung (Vögel), die mit
 * Kopf und Sprungmarken den sichtbaren Teil der Seite füllt (390 × 844, 1200 × 700). Die
 * übrigen Gattungen und Abschnitte kommen Block für Block in Leerlaufzeit dazu, meist noch
 * während die Seite hochrückt (deferred-reveal.ts, R3). Gemessen bei 4× Drosselung: zwei
 * Gattungen kosten im Klick ≈ 20 ms mehr, drei ≈ 40 ms.
 */
export const SPECIES_FIRST_CELLS = 8;

/** Geschätzte Höhen für Platzhalter (390 px): Abschnittskopf, eine Gemeinschaft, Andenken. */
const SECTION_HEAD_EST_PX = 50;
const COMMUNITY_EST_PX = 118;
const KEEPSAKES_EST_PX = 900;

/**
 * Block bis zum Aufdecken sperren (species-page.css, wo möglich `hidden="until-found"` für die
 * Seitensuche) und mit geschätzter Höhe Platz halten.
 */
function placeholder(block: HTMLElement, heightPx: number): HTMLElement {
  deferBlock(block, heightPx);
  return block;
}

/** Sichtbar heißt: im Bild oder bis zu 200 px davor (beim Scrollen schon fertig). */
const VISIBLE_MARGIN = '200px 0px';

/** Leistungsmessung (Schritt 14): `performance.measure` für Aufbau und erste Darstellung. */
const canMeasure = typeof performance !== 'undefined' && typeof performance.measure === 'function';

export function createSpeciesPage(env: PageEnv): SpeciesPage {
  const buildStart = canMeasure ? performance.now() : 0;
  const page = createTabPanel('species');
  page.element.classList.add('species-page');

  // --- Kopf ------------------------------------------------------------------------------
  const intro = el('div', 'species-intro');
  const counts = el('p', 'species-counts');
  counts.dataset.ref = 'journal-counts';
  const meta = el('p', 'species-meta');
  meta.dataset.ref = 'journal-meta';
  const regulars = el('p', 'species-regulars');
  regulars.dataset.ref = 'journal-regulars';
  regulars.hidden = true;
  intro.append(counts, meta, regulars);

  // --- Sprungmarken ----------------------------------------------------------------------
  const jumps = el('nav', 'species-jumps');
  jumps.setAttribute('aria-label', 'Abschnitte');
  jumps.dataset.noSwipe = '';
  const jumpCounts = new Map<SectionId, HTMLElement>();
  const sections = new Map<SectionId, { root: HTMLElement; count: HTMLElement }>();
  for (const { id, label } of SECTIONS) {
    const jump = el('button', 'species-jump');
    jump.type = 'button';
    jump.dataset.jump = id;
    const count = el('span', 'species-jump-count');
    jump.append(el('span', '', label), count);
    jump.addEventListener('click', () => {
      deferred.all();
      const target = sections.get(id)?.root;
      target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    jumps.append(jump);
    jumpCounts.set(id, count);
    const root = el('section', `species-section species-${id}`);
    root.dataset.ref = `species-${id}`;
    const heading = el('h3', 'species-heading', label);
    heading.id = `species-heading-${id}`;
    root.setAttribute('aria-labelledby', heading.id);
    const sectionCount = el('span', 'species-heading-count');
    heading.append(' ', sectionCount);
    root.append(heading);
    sections.set(id, { root, count: sectionCount });
  }

  // --- Bilder erst, wenn sie ins Bild kommen ---------------------------------------------
  const cellOf = new WeakMap<Element, Cell>();
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const cell = cellOf.get(entry.target);
              if (!cell) continue;
              cell.visible = entry.isIntersecting;
              if (cell.visible) paint(cell);
            }
          },
          { rootMargin: VISIBLE_MARGIN },
        )
      : null;

  function paint(cell: Cell): void {
    // Farbig sofort, matt und Silhouette in Leerlaufzeit – ohne farbige Vorschau.
    cell.image?.draw(cell.drawId, cell.variant, cell.family, { preview: false });
  }

  function baseCell(kind: 'animal' | 'plant', index: number): Cell {
    const li = el('li', `species-cell species-cell-${kind} is-unknown`);
    const button = el('button', 'sticker species-sticker');
    button.type = 'button';
    button.dataset.happy = 'plant';
    const face = el('span', 'sticker-face');
    face.setAttribute('aria-hidden', 'true');
    const gem = el('span', 'sticker-gem', '◆');
    gem.setAttribute('aria-hidden', 'true');
    const here = el('span', 'species-here');
    here.setAttribute('aria-hidden', 'true');
    const sr = el('span', 'sr-only');
    button.append(face, gem, here, sr);
    const name = el('span', 'sticker-name', '???');
    name.setAttribute('aria-hidden', 'true');
    li.append(button, name);
    const cell: Cell = { li, button, name, sr, entry: null, drawId: '', variant: 'silhouette', family: '', visible: observer === null };
    if (kind === 'animal') {
      cell.image = createStickerImage(STICKER_DRAW_SIZE);
      face.append(cell.image.element);
      // Feste Neigung je Platz – unabhängig von der Art (die ID bleibt bei Silhouetten geheim).
      button.style.setProperty('--tilt', `${stickerTilt(`species-${index}`, index)}deg`);
    } else {
      cell.emoji = el('span', 'sticker-emoji');
      face.append(cell.emoji);
      button.style.setProperty('--tilt', `${stickerTilt(`plant-${index}`, index)}deg`);
    }
    cellOf.set(li, cell);
    observer?.observe(li);
    return cell;
  }

  // --- Tiere -----------------------------------------------------------------------------
  const animals = sections.get('animals')!;
  // Gattungen ohne Kennarten; die Kennarten bilden eine eigene Reihe dahinter (26.7).
  const groups = speciesGroups(COMMON_SPECIES);
  const speciesCells: Cell[] = [];
  /** Raster je Zelle – Kennarten werden erst mit der Landschaft eingehängt. */
  const cellGrid = new Map<Cell, HTMLElement>();
  const groupCounts: { count: HTMLElement; indices: number[] }[] = [];
  /** Blöcke unterhalb des ersten Bildschirms, in Reihenfolge (verborgen bis zum Aufdecken). */
  const later: HTMLElement[] = [];
  const firstGroups = initialGroupCount(groups.map((g) => g.indices.length), SPECIES_FIRST_CELLS);
  /** Eine Reihe im Raster (Gattung oder Kennarten) mit Kopf und Zähler. */
  function groupBox(key: string, icon: string, label: string): { box: HTMLElement; grid: HTMLElement; count: HTMLElement } {
    const box = el('div', 'species-group');
    box.dataset.genus = key;
    const head = el('h4', 'species-group-title');
    const iconNode = el('span', 'species-group-icon', icon);
    iconNode.setAttribute('aria-hidden', 'true');
    const count = el('span', 'species-group-count');
    count.dataset.ref = `species-count-${key}`;
    head.append(iconNode, el('span', '', label), count);
    head.id = `species-genus-${key}`;
    const grid = el('ul', 'species-grid');
    grid.setAttribute('aria-labelledby', head.id);
    box.append(head, grid);
    return { box, grid, count };
  }

  function animalCell(index: number, grid: HTMLElement): Cell {
    const cell = baseCell('animal', index);
    const star = el('button', 'species-star');
    star.type = 'button';
    star.hidden = true;
    const starIcon = el('span', 'species-star-icon', '☆');
    starIcon.setAttribute('aria-hidden', 'true');
    star.append(starIcon);
    cell.star = star;
    cell.starIcon = starIcon;
    cell.li.append(star);
    star.addEventListener('click', () => {
      const id = cell.entry?.discovered ? cell.entry.key : null;
      if (id && !star.disabled) env.deps.actions.toggleRegular(id);
    });
    cell.button.addEventListener('click', () => tapAnimal(index, cell));
    speciesCells[index] = cell;
    cellGrid.set(cell, grid);
    return cell;
  }

  for (const [groupIndex, group] of groups.entries()) {
    const { box, grid, count } = groupBox(group.genus, group.icon, group.label);
    for (const index of group.indices) grid.append(animalCell(index, grid).li);
    animals.root.append(box);
    if (groupIndex >= firstGroups) later.push(placeholder(box, estimateGridHeight(group.indices.length)));
    groupCounts.push({ count, indices: group.indices });
  }

  // Reihe „Kennarten“ (26.7): erst mit der Landschaft – vorher stehen weder Reihe noch Zellen
  // im DOM (render hängt sie ein). Unentdeckt als Silhouette mit ihrem Wald.
  const kennarten = kennartIndices();
  const kennartRow = groupBox('kennarten', '🔎', 'Kennarten');
  kennartRow.box.classList.add('species-kennarten');
  kennartRow.box.dataset.ref = 'species-kennarten';
  for (const index of kennarten) animalCell(index, kennartRow.grid);
  groupCounts.push({ count: kennartRow.count, indices: kennarten });

  function tapAnimal(index: number, cell: Cell): void {
    const entry = cell.entry;
    if (!entry) return;
    if (entry.discovered) {
      env.open({ kind: 'animal', id: entry.key });
      return;
    }
    const hint = silhouetteHint(env.deps.state(), index);
    openNote(cell.button, { title: hint.title, lines: hint.lines, ref: 'species-note' });
  }

  // --- Pflanzen --------------------------------------------------------------------------
  const plants = sections.get('plants')!;
  const plantGrid = el('ul', 'species-grid species-plant-grid');
  plantGrid.setAttribute('aria-labelledby', 'species-heading-plants');
  const plantCells: Cell[] = PLANTS.map((_, index) => {
    const cell = baseCell('plant', index);
    cell.button.addEventListener('click', () => {
      if (!cell.entry) return;
      const text = plantNote(cell.entry);
      openNote(cell.button, { title: text.title, lines: text.lines, ref: 'plant-note' });
    });
    plantGrid.append(cell.li);
    return cell;
  });
  plants.root.append(plantGrid);

  // --- Gemeinschaften und Andenken (bei Änderung neu) ------------------------------------
  const communities = sections.get('communities')!;
  const communityList = el('ul', 'species-communities');
  communityList.setAttribute('aria-labelledby', 'species-heading-communities');
  communities.root.append(communityList);
  const keepsakes = sections.get('keepsakes')!;
  const treeTitle = el('h4', 'species-group-title', 'Hauptbaum-Arten');
  treeTitle.id = 'species-trees-title';
  const treeList = el('ul', 'species-trees');
  treeList.setAttribute('aria-labelledby', treeTitle.id);
  const memoryTitle = el('h4', 'species-group-title', 'Erinnerungen');
  memoryTitle.id = 'species-memories-title';
  const memoryList = el('ul', 'species-memories');
  memoryList.setAttribute('aria-labelledby', memoryTitle.id);
  const memoryEmpty = el('p', 'species-empty', 'Noch keine Erinnerungen – sie halten besondere Momente fest.');
  // Andenken der Waldchroniken (26.7) – erst mit der Landschaft.
  const chronicleTitle = el('h4', 'species-group-title', 'Chroniken');
  chronicleTitle.id = 'species-chronicles-title';
  const chronicleList = el('ul', 'species-memories species-chronicles');
  chronicleList.dataset.ref = 'species-chronicles';
  chronicleList.setAttribute('aria-labelledby', chronicleTitle.id);
  chronicleTitle.hidden = true;
  chronicleList.hidden = true;
  keepsakes.root.append(treeTitle, treeList, memoryTitle, memoryList, memoryEmpty, chronicleTitle, chronicleList);

  page.body.append(intro, jumps, ...[...sections.values()].map((s) => s.root));
  later.push(
    placeholder(plants.root, SECTION_HEAD_EST_PX + estimateGridHeight(PLANTS.length)),
    placeholder(communities.root, SECTION_HEAD_EST_PX + COMMUNITIES.length * COMMUNITY_EST_PX),
    placeholder(keepsakes.root, KEEPSAKES_EST_PX),
  );
  const deferred = createDeferredReveal(
    later.length,
    (i) => showBlock(later[i]!),
    // Zu sehen: nicht verborgen und nicht unter einer weggedrehten Seite (Unterseite offen).
    () => !page.element.hidden && !page.element.closest('.turned-away'),
  );
  // Seitensuche (Strg+F) findet etwas in einem gesperrten Block: alles sofort aufdecken.
  revealOnFind(later, () => deferred.all());
  if (canMeasure) performance.measure('album-species-build', { start: buildStart });

  // --- Darstellung -----------------------------------------------------------------------

  function renderAnimal(cell: Cell, entry: JournalEntryView, index: number): void {
    const prev = cell.entry;
    cell.entry = entry;
    const known = entry.discovered;
    // Nur entdeckte tragen ihre ID (Spoiler-Regel).
    if (known) {
      if (cell.li.dataset.species !== entry.key) cell.li.dataset.species = entry.key;
    } else if (cell.li.dataset.species !== undefined) delete cell.li.dataset.species;
    cell.li.classList.toggle('is-unknown', !known);
    cell.li.classList.toggle('is-present', entry.present);
    cell.li.classList.toggle('is-away', known && !entry.present);
    setAttr(cell.button, 'data-family', entry.family);
    setAttr(cell.button, 'data-rarity', entry.rarity ?? 'common');
    // Unentdeckte Kennart (26.7): ihr Wald statt „???“ – Standorte sind mit der Landschaft bekannt.
    const caption = known ? null : kennartCaption(index);
    if (!prev || prev.name !== entry.name) setText(cell.name, known ? hyphenate(entry.name) : caption ? hyphenate(caption) : '???');
    const rarity = RARITY_LABELS[entry.rarity ?? 'common'];
    setText(
      cell.sr,
      known
        ? [entry.name, rarity, entry.present ? 'lebt gerade hier' : '', entry.regular?.selected ? 'Stammgast' : ''].filter(Boolean).join(', ')
        : caption
          ? `Unentdeckte Kennart, ${caption}`
          : `Unentdeckte Art, ${rarity}`,
    );
    if (known) setAttr(cell.button, 'title', entry.facts.join(' · '));
    else cell.button.removeAttribute('title');
    // Bild: die echte ID nur im Skript (auch für die Silhouette).
    cell.drawId = SPECIES[index]?.id ?? '';
    cell.variant = speciesStickerVariant(entry);
    cell.family = entry.family;
    if (cell.visible) paint(cell);
    // Stammgast-Stern
    const star = cell.star!;
    const regular = entry.regular;
    if (star.hidden === Boolean(regular)) star.hidden = !regular;
    cell.li.classList.toggle('is-regular', regular?.selected === true);
    if (regular) {
      setText(cell.starIcon!, regular.selected ? '★' : '☆');
      setAttr(star, 'aria-pressed', String(regular.selected));
      star.disabled = regular.disabled;
      setAttr(star, 'aria-label', `${entry.name} als Stammgast${regular.disabled ? ' – alle Plätze belegt' : ''}`);
      setAttr(star, 'title', regular.disabled ? 'Alle Plätze für Stammgäste sind belegt' : regular.selected ? 'Stammgast' : 'Als Stammgast wählen');
    } else {
      // Kein Name am verborgenen Stern lassen (z. B. nach Import eines älteren Spielstands).
      for (const name of ['aria-label', 'title', 'aria-pressed']) star.removeAttribute(name);
    }
  }

  function renderPlant(cell: Cell, entry: JournalEntryView): void {
    cell.entry = entry;
    const known = entry.discovered;
    if (known) {
      if (cell.li.dataset.plant !== entry.key) cell.li.dataset.plant = entry.key;
    } else if (cell.li.dataset.plant !== undefined) delete cell.li.dataset.plant;
    cell.li.classList.toggle('is-unknown', !known);
    cell.li.classList.toggle('is-present', entry.present);
    cell.li.classList.toggle('is-away', known && !entry.present);
    setAttr(cell.button, 'data-family', entry.family);
    setAttr(cell.button, 'data-rarity', 'common');
    setText(cell.emoji!, entry.icon);
    setText(cell.name, known ? hyphenate(entry.name) : '???');
    setText(cell.sr, known ? [entry.name, entry.facts[0] ?? '', entry.present ? 'wächst gerade hier' : ''].filter(Boolean).join(', ') : 'Unentdeckte Pflanze');
  }

  function communityItem(c: JournalCommunityView): HTMLElement {
    const li = el('li', `species-community${c.discovered ? '' : ' is-unknown'}${c.active ? ' is-active' : ''}`);
    if (c.discovered) li.dataset.community = c.key;
    const icon = el('span', 'species-community-icon', c.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'species-community-body');
    const name = el('b', 'species-community-name', hyphenate(c.name));
    if (!c.discovered) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Unentdeckte Lebensgemeinschaft'));
    }
    body.append(name);
    if (c.active) body.append(el('span', 'species-community-active', 'besteht gerade'));
    if (c.members) body.append(el('span', 'species-community-line', c.members));
    if (c.effect) body.append(el('span', 'species-community-effect', c.effect));
    if (c.hint) body.append(el('span', 'species-community-hint', c.hint));
    if (c.progress) body.append(el('span', 'species-community-progress', c.progress));
    li.append(icon, body);
    return li;
  }

  function treeItem(t: JournalTreeView): HTMLElement {
    const known = !t.hidden;
    const status = t.current ? 'current' : t.grown ? 'grown' : t.unlocked ? 'unlocked' : 'locked';
    const li = el('li', `species-tree is-${status}${known ? '' : ' is-unknown'}`);
    if (known) li.dataset.tree = t.key;
    const icon = el('span', 'species-tree-icon', t.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'species-tree-body');
    const name = el('b', 'species-tree-name', hyphenate(t.name));
    if (!known) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Unbekannte Baumart'));
    }
    const badge = el('span', `species-tree-status ${status}`);
    const mark = el('span', '', t.current ? '★ ' : t.grown ? '✓ ' : t.unlocked ? '' : '🔒 ');
    mark.setAttribute('aria-hidden', 'true');
    badge.append(mark, t.current ? 'wächst in diesem Zyklus' : t.grown ? 'schon gewachsen' : t.unlocked ? 'freigeschaltet' : 'gesperrt');
    body.append(name, badge);
    if (t.summary) body.append(el('span', 'species-tree-line', t.summary));
    if (t.text) body.append(el('span', 'species-tree-text', t.text));
    if (t.hint) body.append(el('span', 'species-tree-hint', t.hint));
    li.append(icon, body);
    return li;
  }

  function memoryItem(k: JournalKeepsakeView): HTMLElement {
    const li = el('li', 'species-memory');
    li.dataset.keepsake = k.key;
    const icon = el('span', 'species-memory-icon', k.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'species-memory-body');
    body.append(el('b', 'species-memory-name', hyphenate(k.name)));
    if (k.text) body.append(el('span', 'species-memory-text', k.text));
    li.append(icon, body);
    return li;
  }

  function chronicleItem(k: ChronicleKeepsakeView): HTMLElement {
    const li = el('li', `species-memory species-chronicle${k.complete ? ' is-complete' : ' is-unknown'}`);
    li.dataset.chronicle = k.key;
    const icon = el('span', 'species-memory-icon', k.icon);
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'species-memory-body');
    const name = el('b', 'species-memory-name', k.complete ? hyphenate(k.name) : k.name);
    if (!k.complete) {
      name.setAttribute('aria-hidden', 'true');
      body.append(srOnly('Andenken noch offen'));
    }
    body.append(name, el('span', 'species-chronicle-site', k.site));
    if (k.text) body.append(el('span', 'species-memory-text', k.text));
    li.append(icon, body);
    return li;
  }

  let communitySig = '';
  let keepsakeSig = '';

  function render(view: JournalView): void {
    setText(counts, view.counts);
    setText(meta, view.meta);
    setText(regulars, view.regulars ?? '');
    regulars.hidden = !view.regulars;

    const found = view.species.filter((e) => e.discovered).length;
    page.setMeta(speciesPageHeader(found, view.species.length));
    const tabCounts: Record<SectionId, string> = {
      animals: view.tabCounts.species,
      plants: view.tabCounts.plants,
      communities: view.tabCounts.communities,
      keepsakes: view.tabCounts.keepsakes,
    };
    for (const { id } of SECTIONS) {
      setText(jumpCounts.get(id)!, tabCounts[id]);
      setText(sections.get(id)!.count, tabCounts[id]);
    }
    // Vor der Landschaft fehlen die Kennarten in `view.species` (toJournalView, 26.3) – sie
    // stehen hinten in SPECIES, die übrigen Indizes bleiben gleich. Ihre Plätze bleiben verborgen.
    for (const group of groupCounts) {
      const shown = group.indices.filter((i) => i < view.species.length);
      setText(group.count, ofCount(discoveredIn(view.species, shown), shown.length));
    }
    speciesCells.forEach((cell, i) => {
      const entry = view.species[i];
      if (!entry) {
        if (cell.li.isConnected) cell.li.remove();
        return;
      }
      // Hinten anhängen hält die Reihenfolge (Kennarten in SPECIES-Reihenfolge = Wälder).
      if (!cell.li.parentElement) cellGrid.get(cell)?.append(cell.li);
      renderAnimal(cell, entry, i);
    });
    // Reihe „Kennarten“ erst mit der Landschaft; nach dem Import eines älteren Stands wieder weg.
    const showKennarten = kennarten.some((i) => view.species[i] !== undefined);
    if (showKennarten && !kennartRow.box.isConnected) animals.root.append(kennartRow.box);
    else if (!showKennarten && kennartRow.box.isConnected) kennartRow.box.remove();
    view.plants.forEach((entry, i) => {
      const cell = plantCells[i];
      if (cell) renderPlant(cell, entry);
    });

    const nextCommunities = JSON.stringify(view.communities);
    if (nextCommunities !== communitySig) {
      communitySig = nextCommunities;
      communityList.replaceChildren(...view.communities.map(communityItem));
    }
    const nextKeepsakes = JSON.stringify([view.trees, view.keepsakes, view.chronicles]);
    if (nextKeepsakes !== keepsakeSig) {
      keepsakeSig = nextKeepsakes;
      chronicleList.replaceChildren(...view.chronicles.map(chronicleItem));
      chronicleTitle.hidden = view.chronicles.length === 0;
      chronicleList.hidden = view.chronicles.length === 0;
      treeList.replaceChildren(...view.trees.map(treeItem));
      memoryList.replaceChildren(...view.keepsakes.map(memoryItem));
      memoryList.hidden = view.keepsakes.length === 0;
      memoryEmpty.hidden = view.keepsakes.length > 0;
    }
  }

  // --- Aktualisieren ---------------------------------------------------------------------
  let shownSerial = -1;
  let lastEvaluation: unknown = null;
  let lastKey = '';
  let measured = false;

  let shownDpr = stickerDprEpoch();

  function update(_now: number, force = false): void {
    // Erstes Zeigen: den Rest der Seite stückweise aufdecken (läuft nur, solange sie zu sehen ist).
    deferred.start();
    // Pixeldichte gewechselt (Zoom, anderer Bildschirm): sichtbare Sticker gleich scharf neu –
    // der IntersectionObserver meldet sich erst beim nächsten Scrollen.
    if (shownDpr !== stickerDprEpoch()) {
      shownDpr = stickerDprEpoch();
      for (const cell of speciesCells) if (cell.visible) paint(cell);
    }
    // Ohne neue Ökosystem-Ansicht (gedrosselt, eco-refresh.ts) kann sich nichts geändert haben.
    if (!force && env.eco.serial === shownSerial) return;
    shownSerial = env.eco.serial;
    const state = env.deps.state();
    const ev = evaluate(state);
    const key = speciesPageKey(state);
    if (!force && ev === lastEvaluation && key === lastKey) return;
    lastEvaluation = ev;
    lastKey = key;
    const start = canMeasure && !measured ? performance.now() : 0;
    render(toJournalView(state, ev));
    if (start > 0) {
      measured = true;
      performance.measure('album-species-first-render', { start });
    }
  }

  // Vorwärmen (R3): Die erste Darstellung (Ansicht rechnen, alle Zellen beschriften, Gemeinschaften
  // bauen) kostet bei 4× Drosselung 25–45 ms. In Leerlaufzeit nach dem Start erledigt, bleibt dem
  // ersten Wechsel nur noch das Auslegen. Die verborgene Seite ist gesperrt (album.css) – das
  // Beschriften kostet dort kein Layout, und Bilder zeichnet erst der IntersectionObserver.
  if (typeof window !== 'undefined') {
    new IdleQueue().schedule('warm', () => {
      if (shownSerial === -1 && page.element.hidden) update(performance.now(), true);
    });
  }

  return { page, update };
}
