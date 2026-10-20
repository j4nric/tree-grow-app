/**
 * Ökosystem-Übersicht für die Seitenleiste (Design v2, Abschnitt 11.2).
 *
 * Das Grundgerüst wird einmal aufgebaut. `update()` darf jeden Frame laufen und setzt
 * nur Texte, Klassen und CSS-Variablen über gemerkte Referenzen. Neue Elemente entstehen
 * nur, wenn neue Gattungen, Nischen oder Plätze hinzukommen (selten).
 */
import { el, setAttr, setText, setVar, srOnly } from './dom';
import { restartAnimation } from './feedback';
import { formatNumber, formatRate } from './format';
import type { AnimalView, EcosystemView, FamilyView, HarmonyPartView, NicheView } from './view-model';
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
  pips: HTMLElement[];
  sr: HTMLElement;
  tier: number;
  description: string;
}

interface SlotTile {
  root: HTMLElement;
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
  list: HTMLElement;
  slots: SlotTile[];
}

export function createEcosystemPanel(root: HTMLElement): EcosystemPanel {
  const panel = el('section', 'eco');
  panel.setAttribute('aria-label', 'Ökosystem');

  // Kopf: Stufe und Fortschritt zum nächsten Wegpunkt
  const head = el('header', 'eco-head');
  const stage = el('p', 'eco-stage');
  const progress = el('div', 'progress eco-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Fortschritt zum nächsten Wegpunkt');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const bar = el('div', 'progress-bar');
  progress.append(bar);
  const progressHint = el('p', 'hint');
  head.append(stage, progress, progressHint);

  // Kennzahlen
  const stats = el('div', 'eco-stats');
  const stat = (icon: string, label: string) => {
    const box = el('div', 'eco-stat');
    const top = el('span', 'eco-stat-label');
    const i = el('span', 'eco-stat-icon', icon);
    i.setAttribute('aria-hidden', 'true');
    top.append(i, el('span', '', label));
    const value = el('b', 'eco-stat-value');
    const sub = el('small', 'eco-stat-sub');
    box.append(top, value, sub);
    stats.append(box);
    return { box, value, sub };
  };
  const growth = stat('🌿', 'Wachstum');
  const seeds = stat('🌰', 'Samen');
  const harmony = stat('⚖️', 'Harmonie');
  harmony.box.classList.add('eco-stat-harmony');

  // Harmonie-Aufschlüsselung (aufklappbar)
  const details = el('details', 'eco-harmony');
  const summary = el('summary', '', 'Woraus sich die Harmonie zusammensetzt');
  const partsList = el('ul', 'eco-parts');
  const partsTotal = el('p', 'eco-parts-total');
  details.append(summary, partsList, partsTotal);
  const partRows: PartRow[] = [];

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

  panel.append(head, stats, details, familiesTitle, familyBar, familyDetail, nichesTitle, nicheList);
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
    const pips = family.thresholds.map((t) => {
      const pip = el('span', 'family-pip', String(t));
      pipBox.append(pip);
      return pip;
    });
    const sr = srOnly();
    button.append(icon, count, pipBox, sr);
    button.addEventListener('click', () => selectFamily(family.id));
    return { root: button, icon, count, pips, sr, tier: -1, description: '' };
  }

  function updateFamilies(families: FamilyView[]): void {
    const order = families.map((f) => f.id).join('|');
    for (const family of families) {
      let chip = familyChips.get(family.id);
      if (!chip) {
        chip = buildFamilyChip(family);
        familyChips.set(family.id, chip);
      }
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
    }
  }

  function buildSlot(): SlotTile {
    const li = el('li', 'slot empty');
    const ring = el('span', 'slot-ring');
    ring.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'slot-icon');
    ring.append(icon);
    const text = el('span', 'slot-text');
    const name = el('span', 'slot-name');
    const mood = el('span', 'slot-mood');
    text.append(name, mood);
    const sr = srOnly();
    li.append(ring, text, sr);
    return { root: li, ring, icon, name, mood, sr, animalId: null };
  }

  function updateSlot(tile: SlotTile, animal: AnimalView | undefined): void {
    if (!animal) {
      if (tile.animalId !== null || !tile.root.classList.contains('empty')) {
        tile.root.className = 'slot empty';
        tile.animalId = null;
      }
      setText(tile.icon, '');
      setText(tile.name, 'frei');
      setText(tile.mood, '');
      setText(tile.sr, '');
      return;
    }
    const level = happinessLevel(animal.happiness);
    const className = `slot filled rarity-${animal.rarity} family-${animal.family} happy-${level}${animal.visitor ? ' visitor' : ''}`;
    const arrived = tile.animalId !== null && tile.animalId !== animal.id;
    const firstFill = tile.animalId === null && tile.root.classList.contains('empty');
    // Laufende Ankunfts-Animation beim Vergleich ignorieren
    if (tile.root.className.replace(' arrive', '') !== className) tile.root.className = className;
    tile.animalId = animal.id;
    if (arrived || (firstFill && seenFirstUpdate)) restartAnimation(tile.root, 'arrive');
    setText(tile.icon, animal.familyIcon);
    setText(tile.name, animal.name);
    setText(tile.mood, `${formatPercent(animal.happiness)} · ${animal.mood}`);
    setVar(tile.ring, '--h', animal.happiness.toFixed(3));
    setText(tile.sr, `, ${RARITY_LABELS[animal.rarity]}${animal.visitor ? ', zu Gast' : ''}`);
  }

  function buildNiche(niche: NicheView): NicheRow {
    const li = el('li', 'niche');
    const headRow = el('div', 'niche-head');
    const title = el('span', 'niche-title', `${niche.icon} ${niche.label}`);
    const slotsLabel = el('span', 'niche-slots');
    headRow.append(title, slotsLabel);
    const hint = el('p', 'niche-hint');
    const list = el('ul', 'slot-list');
    list.setAttribute('aria-label', `Plätze in ${niche.label}`);
    li.append(headRow, hint, list);
    return { root: li, title, slotsLabel, hint, list, slots: [] };
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
      setText(row.hint, locked ? (niche.unlockHint ?? '') : '');
      row.hint.hidden = !locked || !niche.unlockHint;

      const needed = locked ? 0 : Math.max(niche.capacity, used);
      while (row.slots.length < needed) {
        const tile = buildSlot();
        row.slots.push(tile);
        row.list.append(tile.root);
      }
      row.slots.forEach((tile, i) => {
        tile.root.hidden = i >= needed;
        if (i < needed) updateSlot(tile, niche.animals[i]);
      });
    }
    if (order !== nicheOrder) {
      nicheOrder = order;
      nicheList.replaceChildren(...niches.map((n) => nicheRows.get(n.id)!.root));
    }
  }

  function update(view: EcosystemView): void {
    setText(stage, `Stufe: ${view.stageName}`);
    const pct = Math.min(100, Math.max(0, view.stageProgress * 100));
    const width = `${pct.toFixed(1)}%`;
    if (bar.style.width !== width) bar.style.width = width;
    setAttr(progress, 'aria-valuenow', String(Math.round(pct)));
    setText(progressHint, view.progressHint);

    setText(growth.value, formatRate(view.growthPerSec));
    setText(growth.sub, `mit ⚖️ ${formatMultiplier(view.harmonyMultiplier)}`);
    setText(seeds.value, formatNumber(Math.floor(view.seeds)));
    setText(seeds.sub, `+${formatRate(view.seedsPerSec)}`);
    const harmonyRounded = Math.round(view.harmony);
    setText(harmony.value, formatNumber(harmonyRounded));
    setText(harmony.sub, view.harmonyTier);
    if (lastHarmony !== null && harmonyRounded > lastHarmony) restartAnimation(harmony.value, 'pop');
    lastHarmony = harmonyRounded;

    updateParts(view.harmonyParts, view.harmony);
    updateFamilies(view.families);
    updateNiches(view.niches);
    seenFirstUpdate = true;
  }

  return { update };
}
