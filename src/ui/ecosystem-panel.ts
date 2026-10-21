/**
 * Ökosystem-Übersicht für die Seitenleiste (Design v2, Abschnitt 11.2).
 *
 * Das Grundgerüst wird einmal aufgebaut. `update()` darf jeden Frame laufen und setzt
 * nur Texte, Klassen und CSS-Variablen über gemerkte Referenzen. Neue Elemente entstehen
 * nur, wenn neue Gattungen, Nischen oder Plätze hinzukommen (selten).
 */
import { el, setAttr, setText, setVar, srOnly } from './dom';
import { hyphenate } from './hyphenate';
import { restartAnimation } from './feedback';
import { formatNumber, formatRate } from './format';
import type {
  AnimalView,
  CommunityListView,
  CommunityView,
  EcosystemView,
  FamilyView,
  HarmonyPartView,
  NicheView,
  PlantRingView,
  PlantSlotView,
} from './view-model';
import {
  RARITY_LABELS,
  familyCountLabel,
  familyDescription,
  familyProgress,
  formatHarmonyPart,
  formatMultiplier,
  formatPercent,
  happinessLevel,
  nicheSlotsLabel,
  toneOf,
} from './view-format';

export interface EcosystemPanel {
  update(view: EcosystemView): void;
  /** Knopf „Pflanze setzen“ – z. B. um den Fokus nach dem Schließen der Auswahl zurückzugeben. */
  readonly plantButton: HTMLButtonElement;
  /**
   * Überschrift einer Nische (per Skript fokussierbar) – Fokusziel, wenn eine Art bei
   * offenen Tierdetails auszieht und ihre Kachel verschwindet. null, wenn unbekannt.
   */
  nicheFocusTarget(nicheId: string): HTMLElement | null;
}

/**
 * Wird die Kachel zum Knopf für die Tierdetails? Nur bei eingezogenen Tieren (nicht bei
 * freien Plätzen oder durchreisenden Gästen) und nur, wenn jemand die Details öffnen kann.
 */
export function slotOpensDetails(animal: Pick<AnimalView, 'visitor'> | undefined, canOpen: boolean): boolean {
  return canOpen && animal !== undefined && !animal.visitor;
}

export interface EcosystemPanelCallbacks {
  /** „Pflanze setzen“ gedrückt: Auswahl öffnen. */
  onOpenPlantPicker?(): void;
  /** „N Begegnungen warten – ansehen“ gedrückt: Kartenwahl-Dialog öffnen. */
  onOpenEncounters?(): void;
  /**
   * Tier-Kachel gedrückt: Tierdetails öffnen. `index` = Platz in `state.niches[nicheId]`,
   * `button` = die Kachel (bekommt beim Schließen den Fokus zurück).
   */
  onOpenAnimal?(nicheId: string, index: number, speciesId: string, button: HTMLButtonElement): void;
  /** „Zur Pflege“ bei einer verschlossenen Nische (Waldtümpel): Pflegemaßnahme zeigen. */
  onShowCare?(careId: string): void;
}

interface PlantTile {
  root: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  sub: HTMLElement;
  plantId: string | null;
}

interface CommunityRow {
  root: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  note: HTMLElement;
  value: HTMLElement;
  bar: HTMLElement;
  sr: HTMLElement;
  /** Zuletzt gezeigter Zustand – für das Aufleuchten, wenn sie gerade entstanden ist. */
  state: CommunityView['state'] | null;
}

interface PartRow {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
}

interface FamilyChip {
  root: HTMLButtonElement;
  icon: HTMLElement;
  count: HTMLElement;
  pipBox: HTMLElement;
  pips: HTMLElement[];
  /** Schwellen, für die die Pips gebaut sind (z. B. „2|3|5“). */
  thresholdsKey: string;
  sr: HTMLElement;
  tier: number;
  description: string;
}

interface SlotTile {
  root: HTMLElement;
  /** Knopf über der ganzen Kachel (nur bei eingezogenen Tieren im DOM). */
  button: HTMLButtonElement;
  /** Inhalt der Kachel – liegt im Knopf (Tier) oder direkt im Listenpunkt (frei). */
  parts: HTMLElement[];
  ring: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  mood: HTMLElement;
  sr: HTMLElement;
  animalId: string | null;
}

interface NicheRow {
  root: HTMLElement;
  title: HTMLElement;
  slotsLabel: HTMLElement;
  hint: HTMLElement;
  hintText: HTMLElement;
  careButton: HTMLButtonElement;
  list: HTMLElement;
  slots: SlotTile[];
}

/** Ab so vielen Zeichen wird eine Kennzahl kleiner gesetzt (ausgeschriebene Zahlen, z. B. „99.999.999“). */
const LONG_STAT_CHARS = 9;

/** Kennzahl setzen; lange Werte bekommen eine kleinere Schrift, damit sie in der Kachel bleiben. */
function setStatValue(node: HTMLElement, text: string): void {
  setText(node, text);
  node.classList.toggle('long', text.length >= LONG_STAT_CHARS);
}

/** Anteil 0–1; NaN/Infinity aus dem Kern werden zu 0, damit keine kaputten Breiten entstehen. */
function unitInterval(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function createEcosystemPanel(root: HTMLElement, callbacks: EcosystemPanelCallbacks = {}): EcosystemPanel {
  const panel = el('section', 'eco');
  panel.setAttribute('aria-label', 'Ökosystem');

  // Kopf: Stufe und Fortschritt zum nächsten Wegpunkt
  const head = el('header', 'eco-head');
  const stage = el('p', 'eco-stage');
  stage.dataset.ref = 'stage';
  const progress = el('div', 'progress eco-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Fortschritt zum nächsten Wegpunkt');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const bar = el('div', 'progress-bar');
  progress.append(bar);
  const progressHint = el('p', 'hint');
  progressHint.dataset.ref = 'progress-hint';
  // Warten Begegnungen, steht statt des Countdowns ein Knopf, der den Stapel öffnet – auf
  // dem Handy ist der Stapel in der Szene beim Lesen der Seitenleiste oft weggescrollt.
  const pendingButton = el('button', 'pending-button');
  pendingButton.type = 'button';
  pendingButton.dataset.ref = 'pending-encounters';
  pendingButton.setAttribute('aria-haspopup', 'dialog');
  pendingButton.hidden = true;
  const pendingIcon = el('span', 'pending-icon', '🐾');
  pendingIcon.setAttribute('aria-hidden', 'true');
  const pendingText = el('span', 'pending-text');
  const pendingCta = el('span', 'pending-cta', 'ansehen');
  pendingButton.append(pendingIcon, pendingText, pendingCta);
  pendingButton.addEventListener('click', () => callbacks.onOpenEncounters?.());
  head.append(stage, progress, progressHint, pendingButton);

  // Kennzahlen
  const stats = el('div', 'eco-stats');
  const stat = (icon: string, label: string, ref: string) => {
    const box = el('div', 'eco-stat');
    const top = el('span', 'eco-stat-label');
    const i = el('span', 'eco-stat-icon', icon);
    i.setAttribute('aria-hidden', 'true');
    top.append(i, el('span', '', label));
    const value = el('b', 'eco-stat-value');
    value.dataset.ref = ref;
    const sub = el('small', 'eco-stat-sub');
    box.append(top, value, sub);
    stats.append(box);
    return { box, value, sub };
  };
  const growth = stat('🌿', 'Wachstum', 'growth-rate');
  const seeds = stat('🌰', 'Samen', 'seeds');
  const harmony = stat('⚖️', 'Harmonie', 'harmony');
  harmony.box.classList.add('eco-stat-harmony');

  // Harmonie-Aufschlüsselung (aufklappbar)
  const details = el('details', 'eco-harmony');
  const summary = el('summary', '', 'Woraus sich die Harmonie zusammensetzt');
  const partsList = el('ul', 'eco-parts');
  const partsTotal = el('p', 'eco-parts-total');
  details.append(summary, partsList, partsTotal);
  const partRows: PartRow[] = [];

  // Lebensgemeinschaften (aufklappbar): aktive, fast fertige, noch unentdeckte „???“
  const communities = el('details', 'eco-harmony eco-communities');
  communities.dataset.ref = 'communities';
  const communitySummary = el('summary');
  const communityTitle = el('span', 'eco-communities-title', 'Lebensgemeinschaften');
  const communityCount = el('span', 'eco-communities-count');
  communityCount.dataset.ref = 'communities-summary';
  // Sichtbar mit ⚖️, vorgelesen als „+8 Harmonie“.
  communityCount.setAttribute('aria-hidden', 'true');
  const communityCountSr = srOnly();
  communitySummary.append(communityTitle, communityCount, communityCountSr);
  const communityList = el('ul', 'community-list');
  communityList.setAttribute('aria-label', 'Lebensgemeinschaften');
  communities.append(communitySummary, communityList);
  const communityRows = new Map<string, CommunityRow>();
  let communityOrder = '';

  // Gattungsleiste
  const familiesTitle = el('h2', 'eco-title', 'Gattungen');
  const familyBar = el('div', 'family-bar');
  const familyDetail = el('p', 'family-detail');
  familyDetail.setAttribute('aria-live', 'polite');
  const familyChips = new Map<string, FamilyChip>();
  let familyOrder = '';
  let selectedFamily: string | null = null;

  // Nischen
  const nichesTitle = el('h2', 'eco-title', 'Nischen');
  const nicheList = el('ul', 'niche-list');
  const nicheRows = new Map<string, NicheRow>();
  let nicheOrder = '';

  // Pflanzring: Plätze, Versorgung mit Licht und Wasser, Gruppen, „Pflanze setzen“
  const ringTitle = el('h2', 'eco-title ring-title');
  const ringTitleText = el('span', '', 'Pflanzring');
  const ringSlots = el('span', 'niche-slots');
  ringSlots.dataset.ref = 'plant-slots';
  ringTitle.append(ringTitleText, ringSlots);
  const ring = el('section', 'plant-ring');
  ring.dataset.ref = 'plant-ring';
  ring.setAttribute('aria-label', 'Pflanzring');
  const ringHint = el('p', 'niche-hint');
  const supplyBox = el('div', 'plant-supply');
  const supplyText = el('p', 'plant-supply-text');
  supplyText.dataset.ref = 'plant-supply';
  const meterBox = el('div', 'plant-meters');
  meterBox.setAttribute('aria-hidden', 'true');
  const meters = new Map<string, { root: HTMLElement; bar: HTMLElement; detail: HTMLElement }>();
  for (const key of ['light', 'water']) {
    const m = el('div', `plant-meter meter-${key}`);
    const track = el('div', 'plant-meter-track');
    const fill = el('div', 'plant-meter-bar');
    track.append(fill);
    const detail = el('span', 'plant-meter-detail');
    m.append(track, detail);
    meterBox.append(m);
    meters.set(key, { root: m, bar: fill, detail });
  }
  const supplyDetail = srOnly();
  const shortage = el('p', 'plant-shortage');
  shortage.dataset.ref = 'plant-shortage';
  supplyBox.append(supplyText, meterBox, supplyDetail, shortage);
  const plantList = el('ul', 'slot-list plant-slots');
  plantList.setAttribute('aria-label', 'Plätze im Pflanzring');
  const plantTiles: PlantTile[] = [];
  const groupCaption = el('p', 'plant-groups-caption', 'Pflanzen je Gruppe – der Hauptbaum zählt als Baum');
  groupCaption.setAttribute('aria-hidden', 'true');
  const groupBox = el('ul', 'plant-groups');
  groupBox.setAttribute('aria-label', 'Pflanzen je Gruppe (Hauptbaum zählt als Baum)');
  const groupChips = new Map<string, { root: HTMLElement; count: HTMLElement; sr: HTMLElement }>();
  const action = el('div', 'plant-action');
  const plantButton = el('button', 'plant-button');
  plantButton.type = 'button';
  plantButton.dataset.ref = 'plant-open';
  plantButton.setAttribute('aria-haspopup', 'dialog');
  const plantButtonIcon = el('span', 'plant-button-icon', '🌱');
  plantButtonIcon.setAttribute('aria-hidden', 'true');
  const plantButtonText = el('span', '', 'Pflanze setzen');
  const plantButtonCost = el('span', 'plant-button-cost');
  plantButton.append(plantButtonIcon, plantButtonText, plantButtonCost);
  plantButton.addEventListener('click', () => callbacks.onOpenPlantPicker?.());
  const plantHint = el('p', 'plant-hint');
  plantHint.dataset.ref = 'plant-hint';
  action.append(plantButton, plantHint);
  ring.append(ringHint, supplyBox, plantList, groupCaption, groupBox, action);

  panel.append(head, stats, details, communities, ringTitle, ring, familiesTitle, familyBar, familyDetail, nichesTitle, nicheList);
  root.append(panel);

  let lastHarmony: number | null = null;
  /** Nach dem ersten Update – vorher keine Animationen (kein Aufleuchten beim Laden). */
  let seenFirstUpdate = false;

  function updateParts(parts: HarmonyPartView[], total: number): void {
    while (partRows.length < parts.length) {
      const li = el('li');
      const label = el('span');
      const value = el('b');
      li.append(label, value);
      partsList.append(li);
      partRows.push({ root: li, label, value });
    }
    partRows.forEach((row, i) => {
      const part = parts[i];
      row.root.hidden = !part;
      if (!part) return;
      setText(row.label, part.label);
      setText(row.value, formatHarmonyPart(part.value));
      const className = `tone-${toneOf(part.value)}`;
      if (row.root.className !== className) row.root.className = className;
    });
    setText(partsTotal, `Summe: ${formatNumber(Math.round(total))}`);
  }

  function buildCommunityRow(id: string): CommunityRow {
    const li = el('li', 'community');
    li.dataset.community = id;
    const icon = el('span', 'community-icon');
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'community-text');
    const name = el('span', 'community-name');
    const note = el('span', 'community-note');
    text.append(name, note);
    const value = el('span', 'community-value');
    value.setAttribute('aria-hidden', 'true');
    const track = el('span', 'community-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = el('span', 'community-bar');
    track.append(bar);
    const sr = srOnly();
    // Vorgelesen: Zustand (sr) direkt nach dem verborgenen Symbol, dann Name und Notiz.
    li.append(icon, sr, text, value, track);
    return { root: li, icon, name, note, value, bar, sr, state: null };
  }

  function updateCommunities(view: CommunityListView): void {
    setText(communityCount, view.summary);
    setText(communityCountSr, `: ${view.summaryText}`);
    for (const item of view.items) {
      let row = communityRows.get(item.id);
      if (!row) {
        row = buildCommunityRow(item.id);
        communityRows.set(item.id, row);
      }
      const className = `community state-${item.state}${item.discovered ? '' : ' undiscovered'}`;
      if (row.root.className.replace(' formed', '') !== className) row.root.className = className;
      // Gerade entstanden: kurz aufleuchten (nicht beim ersten Aufbau)
      if (item.state === 'active' && row.state !== null && row.state !== 'active' && seenFirstUpdate) {
        restartAnimation(row.root, 'formed');
      }
      row.state = item.state;
      setText(row.icon, item.icon);
      setText(row.name, hyphenate(item.name));
      const note =
        item.state === 'active' ? item.effects : (item.missingText ?? (item.discovered ? '' : (item.hint ?? '')));
      setText(row.note, note);
      row.note.hidden = !note;
      const active = item.state === 'active';
      setText(row.value, active ? `+${formatNumber(item.harmony)} ⚖️` : `${formatNumber(item.present)}/${formatNumber(item.total)}`);
      const width = `${(unitInterval(item.progress) * 100).toFixed(1)}%`;
      if (row.bar.style.width !== width) row.bar.style.width = width;
      // „???“ liest ein Screenreader schlecht vor – dort steht „noch unentdeckt“.
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

  function selectFamily(id: string | null): void {
    selectedFamily = selectedFamily === id ? null : id;
    for (const [key, chip] of familyChips) {
      setAttr(chip.root, 'aria-pressed', String(key === selectedFamily));
    }
    familyDetail.textContent = selectedFamily ? (familyChips.get(selectedFamily)?.description ?? '') : '';
    familyDetail.hidden = !selectedFamily;
  }
  familyDetail.hidden = true;

  function buildFamilyChip(family: FamilyView): FamilyChip {
    const button = el('button', `family-chip family-${family.id}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const icon = el('span', 'family-icon', family.icon);
    icon.setAttribute('aria-hidden', 'true');
    const count = el('span', 'family-count');
    count.setAttribute('aria-hidden', 'true');
    const pipBox = el('span', 'family-pips');
    pipBox.setAttribute('aria-hidden', 'true');
    const sr = srOnly();
    button.append(icon, count, pipBox, sr);
    button.addEventListener('click', () => selectFamily(family.id));
    const chip: FamilyChip = { root: button, icon, count, pipBox, pips: [], thresholdsKey: '', sr, tier: -1, description: '' };
    buildPips(chip, family.thresholds);
    return chip;
  }

  /** Baut die Schwellen-Pips (nur beim Anlegen oder wenn sich die Schwellen ändern). */
  function buildPips(chip: FamilyChip, thresholds: number[]): void {
    chip.thresholdsKey = thresholds.join('|');
    chip.pips = thresholds.map((t) => el('span', 'family-pip', String(t)));
    chip.pipBox.replaceChildren(...chip.pips);
  }

  function updateFamilies(families: FamilyView[]): void {
    const order = families.map((f) => f.id).join('|');
    for (const family of families) {
      let chip = familyChips.get(family.id);
      if (!chip) {
        chip = buildFamilyChip(family);
        familyChips.set(family.id, chip);
      }
      if (family.thresholds.join('|') !== chip.thresholdsKey) buildPips(chip, family.thresholds);
      const { activeTier } = familyProgress(family.count, family.thresholds);
      setText(chip.count, familyCountLabel(family.count, family.thresholds));
      chip.pips.forEach((pip, i) => pip.classList.toggle('reached', i <= activeTier));
      chip.root.classList.toggle('active', activeTier >= 0);
      chip.root.classList.toggle('empty', family.count === 0);
      const description = familyDescription(family.label, family.count, family.thresholds, family.bonuses);
      if (description !== chip.description) {
        chip.description = description;
        setText(chip.sr, description);
        chip.root.title = description;
        if (selectedFamily === family.id) familyDetail.textContent = description;
      }
      // Neue Schwelle erreicht: kurz aufleuchten (nicht beim ersten Aufbau)
      if (activeTier > chip.tier && seenFirstUpdate) restartAnimation(chip.root, 'tier-up');
      chip.tier = activeTier;
    }
    if (order !== familyOrder) {
      familyOrder = order;
      familyBar.replaceChildren(...families.map((f) => familyChips.get(f.id)!.root));
      // Verschwundene Gattungen vergessen; war eine davon ausgewählt, Detailzeile leeren.
      const present = new Set(families.map((f) => f.id));
      for (const id of [...familyChips.keys()]) {
        if (present.has(id)) continue;
        familyChips.delete(id);
        if (selectedFamily === id) selectFamily(id);
      }
    }
  }

  function buildSlot(nicheId: string, index: number): SlotTile {
    const li = el('li', 'slot empty');
    const ring = el('span', 'slot-ring');
    ring.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'slot-icon');
    ring.append(icon);
    const text = el('span', 'slot-text');
    const name = el('span', 'slot-name');
    // Gekürzte Gründe: voller Text im Tooltip und in den Tierdetails (Tippen auf die Kachel).
    const mood = el('span', 'slot-mood');
    text.append(name, mood);
    const sr = srOnly();
    // Die ganze Kachel eines Tiers ist ein Knopf → Tierdetails. Freie Plätze bleiben schlicht.
    const button = el('button', 'slot-open');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    const tile: SlotTile = { root: li, button, parts: [ring, text, sr], ring, icon, name, mood, sr, animalId: null };
    button.addEventListener('click', () => {
      if (tile.animalId) callbacks.onOpenAnimal?.(nicheId, index, tile.animalId, button);
    });
    li.append(...tile.parts);
    return tile;
  }

  /** Inhalt in den Knopf (Tier) bzw. direkt in den Listenpunkt (freier Platz) hängen. */
  function placeParts(tile: SlotTile, interactive: boolean): void {
    const inButton = tile.button.parentElement === tile.root;
    if (interactive === inButton) return;
    if (interactive) {
      tile.button.append(...tile.parts);
      tile.root.replaceChildren(tile.button);
    } else {
      tile.root.replaceChildren(...tile.parts);
    }
  }

  function updateSlot(tile: SlotTile, animal: AnimalView | undefined): void {
    if (!animal) {
      if (tile.animalId !== null || !tile.root.classList.contains('empty')) {
        tile.root.className = 'slot empty';
        tile.animalId = null;
        delete tile.root.dataset.species;
      }
      setText(tile.icon, '');
      setText(tile.name, 'frei');
      setText(tile.mood, '');
      tile.mood.removeAttribute('title');
      setText(tile.sr, '');
      placeParts(tile, false);
      return;
    }
    const happiness = unitInterval(animal.happiness);
    const level = happinessLevel(happiness);
    const className = `slot filled rarity-${animal.rarity} family-${animal.family} happy-${level}${animal.visitor ? ' visitor' : ''}`;
    const arrived = tile.animalId !== null && tile.animalId !== animal.id;
    const firstFill = tile.animalId === null && tile.root.classList.contains('empty');
    // Laufende Ankunfts-Animation beim Vergleich ignorieren
    if (tile.root.className.replace(' arrive', '') !== className) tile.root.className = className;
    tile.animalId = animal.id;
    if (tile.root.dataset.species !== animal.id) tile.root.dataset.species = animal.id;
    if (arrived || (firstFill && seenFirstUpdate)) restartAnimation(tile.root, 'arrive');
    setText(tile.icon, animal.familyIcon);
    setText(tile.name, hyphenate(animal.name));
    const mood = `${formatPercent(happiness)} · ${animal.mood}`;
    setText(tile.mood, mood);
    // Lange Gründe sind optisch auf zwei Zeilen gekürzt – voller Text im Tooltip und in den Tierdetails.
    setAttr(tile.mood, 'title', mood);
    setVar(tile.ring, '--h', happiness.toFixed(3));
    const opens = slotOpensDetails(animal, Boolean(callbacks.onOpenAnimal));
    setText(tile.sr, `, ${RARITY_LABELS[animal.rarity]}${animal.visitor ? ', zu Gast' : ''}${opens ? '. Details ansehen' : ''}`);
    placeParts(tile, opens);
  }

  function buildNiche(niche: NicheView): NicheRow {
    const li = el('li', 'niche');
    li.dataset.niche = niche.id;
    const headRow = el('div', 'niche-head');
    const title = el('span', 'niche-title', `${niche.icon} ${niche.label}`);
    const slotsLabel = el('span', 'niche-slots');
    headRow.append(title, slotsLabel);
    const hint = el('p', 'niche-hint');
    const hintText = el('span', 'niche-hint-text');
    // Playtest Amphibien: Der Weg zum Waldtümpel führt über die Pflege – oft zugeklappt
    // und weiter unten. Der Knopf öffnet sie direkt bei der Maßnahme.
    const careButton = el('button', 'niche-care-link', 'Zur Pflege');
    careButton.type = 'button';
    careButton.dataset.ref = 'niche-care-link';
    careButton.hidden = true;
    careButton.addEventListener('click', () => {
      const id = careButton.dataset.careLink;
      if (id) callbacks.onShowCare?.(id);
    });
    hint.append(hintText, careButton);
    const list = el('ul', 'slot-list');
    list.setAttribute('aria-label', `Plätze in ${niche.label}`);
    li.append(headRow, hint, list);
    return { root: li, title, slotsLabel, hint, hintText, careButton, list, slots: [] };
  }

  function updateNiches(niches: NicheView[]): void {
    const order = niches.map((n) => n.id).join('|');
    for (const niche of niches) {
      let row = nicheRows.get(niche.id);
      if (!row) {
        row = buildNiche(niche);
        nicheRows.set(niche.id, row);
      }
      const locked = niche.capacity <= 0 && niche.animals.length === 0;
      row.root.classList.toggle('locked', locked);
      const used = niche.animals.length;
      const full = niche.capacity > 0 && used >= niche.capacity;
      row.root.classList.toggle('full', full);
      setText(row.slotsLabel, nicheSlotsLabel(used, niche.capacity));
      // Hinweis bei verschlossenen Nischen – und bei offenen, in die noch niemand einziehen darf.
      const showHint = !!niche.unlockHint && (locked || used === 0);
      setText(row.hintText, showHint ? niche.unlockHint! : '');
      row.hint.hidden = !showHint;
      const link = locked && niche.careLink && callbacks.onShowCare ? niche.careLink : '';
      if (row.careButton.dataset.careLink !== link) {
        row.careButton.dataset.careLink = link;
        row.careButton.hidden = !link;
        row.careButton.setAttribute('aria-label', `Zur Pflege: ${niche.label} öffnen`);
      }

      const needed = locked ? 0 : Math.max(niche.capacity, used);
      while (row.slots.length < needed) {
        const tile = buildSlot(niche.id, row.slots.length);
        row.slots.push(tile);
        row.list.append(tile.root);
      }
      row.slots.forEach((tile, i) => {
        tile.root.hidden = i >= needed;
        // Versteckte Plätze leeren, damit kein altes Tier im DOM zurückbleibt (z. B. nach Löschen)
        updateSlot(tile, i < needed ? niche.animals[i] : undefined);
      });
    }
    if (order !== nicheOrder) {
      nicheOrder = order;
      nicheList.replaceChildren(...niches.map((n) => nicheRows.get(n.id)!.root));
      const present = new Set(niches.map((n) => n.id));
      for (const id of [...nicheRows.keys()]) if (!present.has(id)) nicheRows.delete(id);
    }
  }

  function buildPlantTile(): PlantTile {
    const li = el('li', 'slot empty plant-slot');
    const ringEl = el('span', 'slot-ring');
    ringEl.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'slot-icon');
    ringEl.append(icon);
    const text = el('span', 'slot-text');
    const name = el('span', 'slot-name');
    const sub = el('span', 'slot-mood');
    text.append(name, sub);
    li.append(ringEl, text);
    return { root: li, icon, name, sub, plantId: null };
  }

  function updatePlantTile(tile: PlantTile, plant: PlantSlotView | undefined): void {
    if (!plant) {
      if (tile.plantId !== null || !tile.root.classList.contains('empty')) {
        tile.root.className = 'slot empty plant-slot';
        tile.plantId = null;
        delete tile.root.dataset.plant;
      }
      setText(tile.icon, '');
      setText(tile.name, 'frei');
      setText(tile.sub, '');
      return;
    }
    const className = `slot filled plant-slot family-${plant.group}`;
    const changed = tile.plantId !== plant.id;
    if (tile.root.className.replace(' arrive', '') !== className) tile.root.className = className;
    if (changed && seenFirstUpdate) restartAnimation(tile.root, 'arrive');
    tile.plantId = plant.id;
    if (tile.root.dataset.plant !== plant.id) tile.root.dataset.plant = plant.id;
    setText(tile.icon, plant.groupIcon);
    setText(tile.name, hyphenate(plant.name));
    setText(tile.sub, plant.groupLabel);
  }

  function updatePlantRing(view: PlantRingView): void {
    const locked = view.capacity <= 0;
    ring.classList.toggle('locked', locked);
    setText(ringSlots, nicheSlotsLabel(view.plants.length, view.capacity));
    ringTitle.classList.toggle('full', !locked && view.plants.length >= view.capacity);
    setText(ringHint, locked ? (view.unlockHint ?? '') : '');
    ringHint.hidden = !locked || !view.unlockHint;
    supplyBox.hidden = locked;

    setText(supplyText, view.supplyText);
    for (const meter of view.meters) {
      const refs = meters.get(meter.key);
      if (!refs) continue;
      const ratio = unitInterval(meter.ratio);
      const width = `${(ratio * 100).toFixed(1)}%`;
      if (refs.bar.style.width !== width) refs.bar.style.width = width;
      refs.root.classList.toggle('short', ratio < 0.995);
      setText(refs.detail, `${meter.icon} ${meter.detail}`);
    }
    setText(supplyDetail, view.meters.map((m) => `${m.label}: ${m.detail}`).join('. '));
    setText(shortage, view.shortageHint ?? '');
    shortage.hidden = !view.shortageHint;

    const needed = locked ? 0 : Math.max(view.capacity, view.plants.length);
    while (plantTiles.length < needed) {
      const tile = buildPlantTile();
      plantTiles.push(tile);
      plantList.append(tile.root);
    }
    plantTiles.forEach((tile, i) => {
      tile.root.hidden = i >= needed;
      updatePlantTile(tile, i < needed ? view.plants[i] : undefined);
    });
    plantList.hidden = locked;

    for (const group of view.groups) {
      let chip = groupChips.get(group.id);
      if (!chip) {
        const li = el('li', `plant-group family-${group.id}`);
        const icon = el('span', 'plant-group-icon', group.icon);
        icon.setAttribute('aria-hidden', 'true');
        const count = el('b', 'plant-group-count');
        count.setAttribute('aria-hidden', 'true');
        const sr = srOnly();
        li.append(icon, count, sr);
        li.title = group.label;
        groupBox.append(li);
        chip = { root: li, count, sr };
        groupChips.set(group.id, chip);
      }
      setText(chip.count, formatNumber(group.count));
      setText(chip.sr, `${group.label}: ${formatNumber(group.count)}`);
      chip.root.classList.toggle('empty', group.count === 0);
    }
    groupBox.hidden = locked;
    groupCaption.hidden = locked;

    plantButton.hidden = !view.canOpenPicker;
    setText(plantButtonCost, `${view.plantCostLabel} 🌰`);
    plantButton.classList.toggle('affordable', view.affordable);
    setAttr(
      plantButton,
      'aria-label',
      `Pflanze setzen – kostet ${view.plantCostLabel} Samen${view.affordable ? '' : ', noch nicht genug'}`,
    );
    setText(plantHint, view.plantHint);
    plantHint.hidden = !view.plantHint;
    action.hidden = locked;
  }

  function update(view: EcosystemView): void {
    setText(stage, `Stufe: ${view.stageName}`);
    const pct = unitInterval(view.stageProgress) * 100;
    const width = `${pct.toFixed(1)}%`;
    if (bar.style.width !== width) bar.style.width = width;
    setAttr(progress, 'aria-valuenow', String(Math.round(pct)));
    const pending = callbacks.onOpenEncounters ? view.pendingEncounters : 0;
    setText(progressHint, view.progressHint);
    progressHint.hidden = pending > 0;
    pendingButton.hidden = pending <= 0;
    if (pending > 0) {
      setText(pendingText, view.progressHint);
      setAttr(pendingButton, 'aria-label', `${view.progressHint} – ansehen`);
    }

    setStatValue(growth.value, formatRate(view.growthPerSec));
    setText(growth.sub, `mit ⚖️ ${formatMultiplier(view.harmonyMultiplier)}`);
    setStatValue(seeds.value, formatNumber(Math.floor(view.seeds)));
    setText(seeds.sub, `+${formatRate(view.seedsPerSec)}`);
    const harmonyRounded = Math.round(view.harmony);
    setStatValue(harmony.value, formatNumber(harmonyRounded));
    setText(harmony.sub, view.harmonyTier);
    if (lastHarmony !== null && harmonyRounded > lastHarmony) restartAnimation(harmony.value, 'pop');
    lastHarmony = harmonyRounded;

    updateParts(view.harmonyParts, view.harmony);
    updateCommunities(view.communities);
    updatePlantRing(view.plantRing);
    updateFamilies(view.families);
    updateNiches(view.niches);
    seenFirstUpdate = true;
  }

  function nicheFocusTarget(nicheId: string): HTMLElement | null {
    const row = nicheRows.get(nicheId);
    if (!row || !row.root.isConnected) return null;
    if (!row.title.hasAttribute('tabindex')) row.title.setAttribute('tabindex', '-1');
    return row.title;
  }

  return { update, plantButton, nicheFocusTarget };
}
