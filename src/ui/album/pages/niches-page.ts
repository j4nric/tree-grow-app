/**
 * Reiter „Nischen“ – „Wer wohnt wo?“ · „9 von 14 Plätzen“ (docs/ALBUM_UI.md, B.1 und A.4).
 *
 * Gattungen als Abzeichen mit Pips (Tipp → Haftnotiz), Stickerreihen je Nische am Baum und
 * je Lebensraum (verschlossen: grauer Name und Handschrift-Zeile, ggf. „Zur Forschung ›“), der
 * Pflanzring mit Messbändern und „🌱 Säen“, dazu die Lesezeichen-Links zu
 * U:Harmonie (Lebensgemeinschaften) und U:Nahrungsnetz. Tipp auf einen Sticker blättert zu
 * U:Tier um.
 *
 * Verschlossene Nischen ohne Pflege-Knopf (und der verschlossene Pflanzring) stehen
 * zusammengefasst in einer aufklappbaren Zeile „Noch 10 Nischen … verschlossen“; die beiden
 * Links erscheinen erst, wenn es dort etwas zu sehen gibt (Playtest Schritt 14, S10).
 *
 * Ausbau (DESIGN_V2.md 28.4/28.9, Phase 11, 4b; Bausteine aus `../upgrade-panel.ts`): Kaufmenge
 * ×1 / ×10 / Max im Seitenkopf (gemerkt in den Einstellungen), oben „🌳 Dein Baum“ mit
 * Jahresringen, Blattwerk und Pilzgeflecht, je offener Nische eine Fußzeile mit Stufe,
 * Meilenstein-Balken, Wirkung und Knopf, das Abzeichen am Etikett. Kauf: Aufleuchten,
 * „+1 Stufe“, ein neuer Platz klebt sich ein; den Meilenstein-Stempel zeigt main.ts. Die Liste
 * sortiert nie um; Kaufen geht nur, wenn die Samen für die gewählte Menge reichen.
 *
 * DOM einmal bauen; `update` läuft nur, solange die Seite sichtbar ist, und schreibt nur bei
 * neuer Ökosystem-Ansicht (Struktur) bzw. neuer Zahl (Pflanzring) – nie pro Frame neu.
 */
import { el, setAttr, setText, setVar, srOnly } from '../../dom';
import { restartAnimation } from '../../feedback';
import { formatNumber } from '../../format';
import { familyCountLabel, familyDescription, familyProgress, formatPercent, nicheSlotsLabel } from '../../view-format';
import type { AnimalView, CommunityListView, EcosystemView, FamilyView, FoodWebView, NicheView, PlantRingView } from '../../view-model';
import type { UpgradeOutcome } from '../../../core/tick';
import type { UpgradeTarget } from '../../../core/upgrades';
import { purchaseFor, upgradeFloatText } from '../../upgrade-adapters';
import { nicheFooterView, treeMilestoneHint, treePartView, type BuyAmount, type UpgradeContext } from '../../upgrade-view';
import { createBuyAmountSwitch, createNicheFooter, createTreeUpgrades, createUpgradeBadge, type NicheFooter, type UpgradeBadgeEl } from '../upgrade-panel';
import { createNote, openNote } from '../note';
import { createStickerSlot, type StickerKind, type StickerSlot } from '../sticker';
import {
  LOCKED_SUMMARY_HINT,
  ecosystemLinksVisible,
  isQuietLocked,
  lockedSummary,
  nichesPageHeader,
  slotOpensDetails,
  splitNiches,
} from './niches-view';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';
import './niches-page.css';

/** Kurzer Hinweis bis zum ersten Umblättern (B.1 Punkt 1), gemerkt im Browser. */
export const STICKER_TIP_KEY = 'tree-grow-sticker-tip-seen';
const STICKER_TIP = 'Tippe auf einen Sticker, um umzublättern.';
const VISITOR_TEXT = 'Zu Gast – zieht bald weiter und braucht keinen Platz.';

/** Was der Reiter außer der Navigation braucht: Säen und Pflege (verbindet album/index.ts). */
export interface NichesActions {
  /** „🌱 Säen“ bzw. „Aussaat offen ›“ (DESIGN_V2.md 27.6). */
  sow(): void;
  /** „Zur Forschung ›“: Reiter Forschung beim Knoten. */
  showCare(careId: string): void;
  /**
   * „Ausbauen“ (DESIGN_V2.md 28.4/28.9): `count` Stufen einer Nische bzw. eines Baumteils
   * (Infinity = Max). Ergebnis für die Rückmeldung an der Zeile; null ohne Kauf.
   */
  upgrade(target: UpgradeTarget, count: number): UpgradeOutcome | null;
}

export interface NichesPage extends TabPage {
  /** Aktionen verbinden (album/index.ts). */
  connect(actions: NichesActions): void;
  /** Knopf „🌱 Säen“. */
  readonly plantButton: HTMLButtonElement;
  /**
   * Sprung der Zielzeile (28.7, Phase 11, 4c): Zeile der Nische bzw. des Baumteils – oder beim
   * Säen den Pflanzring – ins Bild holen, kurz aufleuchten lassen und den Fokus auf den Namen
   * setzen. false, wenn es die Zeile (noch) nicht gibt.
   */
  reveal(target: UpgradeTarget | 'sow'): boolean;
}

interface NicheRow {
  root: HTMLLIElement;
  title: HTMLElement;
  count: HTMLElement;
  list: HTMLUListElement;
  hint: HTMLElement;
  hintText: HTMLElement;
  care: HTMLButtonElement;
  slots: StickerSlot[];
  /** Zuletzt gezeigte Zahl der Plätze (neue Plätze kleben sich ein). */
  shownSlots: number;
  footer: NicheFooter;
  badge: UpgradeBadgeEl;
}

interface FamilyBadge {
  root: HTMLButtonElement;
  icon: HTMLElement;
  label: string;
  count: HTMLElement;
  pipBox: HTMLElement;
  pips: HTMLElement[];
  thresholdsKey: string;
  sr: HTMLElement;
  tier: number;
  description: string;
}

function readTipSeen(): boolean {
  try {
    return localStorage.getItem(STICKER_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function section(title: string, className: string): { root: HTMLElement; head: HTMLElement } {
  const root = el('section', `niches-section ${className}`);
  const head = el('h3', 'niches-heading', title);
  root.append(head);
  return { root, head };
}

/** Kaufmenge → Stufen für die Aktion (Max = so viele, wie die Samen reichen). */
function countOf(amount: BuyAmount): number {
  return amount === 'max' ? Infinity : amount;
}

export function createNichesPage(env: PageEnv): NichesPage {
  const page = createTabPanel('niches');
  page.element.classList.add('niches-page');
  let actions: NichesActions | null = null;
  /** Letzte gezeigte Ansicht (für Gäste- und Pflanzen-Notizen). */
  let current: EcosystemView | null = null;

  // --- Hinweis ---------------------------------------------------------------------------
  const tip = el('p', 'niches-tip', STICKER_TIP);
  tip.hidden = readTipSeen();
  const hideTip = () => {
    if (tip.hidden) return;
    tip.hidden = true;
    try {
      localStorage.setItem(STICKER_TIP_KEY, '1');
    } catch {
      // Privater Modus: Hinweis kommt beim nächsten Start wieder – unschädlich.
    }
  };

  // --- Gattungen -------------------------------------------------------------------------
  const families = section('Gattungen', 'niches-families');
  const familyRow = el('div', 'family-row');
  familyRow.dataset.noSwipe = '';
  families.root.append(familyRow);
  const familyNote = createNote({ id: 'family', title: '', ref: 'family-note' });
  const familyNoteText = familyNote.line('', 'family-detail');
  const familyBadges = new Map<string, FamilyBadge>();
  let familyOrder = '';
  let selectedFamily: string | null = null;

  // --- Ausbau: Kaufmenge und „Dein Baum“ (28.4/28.9) -------------------------------------
  const preferences = env.deps.preferences;
  let amount: BuyAmount = preferences.settings.buyAmount;
  const amountSwitch = createBuyAmountSwitch((next) => {
    if (next === amount) return;
    amount = next;
    preferences.update({ buyAmount: next });
    if (current) updateUpgrades(current);
  });
  amountSwitch.element.hidden = true;
  page.header.append(amountSwitch.element);
  const ownTree = createTreeUpgrades((id) => buyUpgrade({ kind: 'tree', id: id as Extract<UpgradeTarget, { kind: 'tree' }>['id'] }));
  ownTree.element.hidden = true;

  // --- Nischen und Lebensräume -----------------------------------------------------------
  const tree = section('Am Baum', 'niches-tree');
  const treeList = el('ul', 'nrow-list');
  tree.root.append(treeList);
  const habitats = section('Lebensräume', 'niches-habitats');
  const habitatList = el('ul', 'nrow-list');
  habitats.root.append(habitatList);
  const rows = new Map<string, NicheRow>();
  let treeOrder = '';
  let habitatOrder = '';

  // --- Verschlossenes, zusammengefasst ----------------------------------------------------
  const locked = el('details', 'niches-locked');
  locked.dataset.ref = 'niches-locked';
  const lockedSummaryEl = el('summary', 'niches-locked-summary');
  const lockedIcon = el('span', 'niches-locked-icon', '🔒');
  lockedIcon.setAttribute('aria-hidden', 'true');
  const lockedText = el('span', 'niches-locked-text');
  lockedText.dataset.ref = 'niches-locked-text';
  const lockedHint = el('span', 'niches-locked-hint', LOCKED_SUMMARY_HINT);
  const lockedArrow = el('span', 'niches-locked-arrow', '›');
  lockedArrow.setAttribute('aria-hidden', 'true');
  lockedSummaryEl.append(lockedIcon, lockedText, lockedHint, lockedArrow);
  const lockedList = el('ul', 'nrow-list niches-locked-list');
  // Pflanzring, solange er verschlossen ist: eine Zeile wie die Nischen.
  const ringLockedRow = el('li', 'nrow is-locked');
  ringLockedRow.dataset.ref = 'plant-ring-locked';
  const ringLockedLabel = el('div', 'nrow-label');
  ringLockedLabel.append(el('span', 'nrow-title', '🌱 Pflanzring'), el('span', 'nrow-count', 'verschlossen'));
  const ringLockedHint = el('span', 'nrow-hint-text');
  const ringLockedContent = el('div', 'nrow-content');
  const ringLockedP = el('p', 'nrow-hint');
  ringLockedP.append(ringLockedHint);
  ringLockedContent.append(ringLockedP);
  ringLockedRow.append(ringLockedLabel, ringLockedContent);
  locked.append(lockedSummaryEl, lockedList);
  let lockedOrder = '';
  /** Verschlossene Nischen ohne Pflege-Knopf, in der Reihenfolge der Ansicht. */
  let quietIds: string[] = [];
  let ringLocked = false;

  // --- Pflanzring ------------------------------------------------------------------------
  const ring = section('Pflanzring', 'niches-ring');
  ring.root.dataset.ref = 'plant-ring';
  ring.head.tabIndex = -1;
  ring.root.setAttribute('aria-label', 'Pflanzring');
  const ringCount = el('span', 'niches-heading-meta');
  ringCount.dataset.ref = 'plant-slots';
  ring.head.append(' ', ringCount);
  const ringHint = el('p', 'nrow-hint-text ring-hint');
  const supply = el('div', 'ring-supply');
  const supplyText = el('p', 'ring-supply-text');
  supplyText.dataset.ref = 'plant-supply';
  const meterBox = el('div', 'ring-meters');
  meterBox.setAttribute('aria-hidden', 'true');
  const meters = new Map<string, { root: HTMLElement; fill: HTMLElement; detail: HTMLElement }>();
  for (const key of ['light', 'water']) {
    const meter = el('div', `ring-meter meter-${key}`);
    const track = el('span', 'ring-meter-track');
    const fill = el('span', 'ring-meter-fill');
    track.append(fill);
    const detail = el('span', 'ring-meter-detail');
    meter.append(track, detail);
    meterBox.append(meter);
    meters.set(key, { root: meter, fill, detail });
  }
  const supplyDetail = srOnly();
  const shortage = el('p', 'ring-shortage');
  shortage.dataset.ref = 'plant-shortage';
  supply.append(supplyText, meterBox, supplyDetail, shortage);
  const plantList = el('ul', 'sticker-list ring-stickers');
  plantList.setAttribute('aria-label', 'Plätze im Pflanzring');
  const plantSlots: StickerSlot[] = [];
  const groupBox = el('ul', 'ring-groups');
  groupBox.setAttribute('aria-label', 'Pflanzen je Gruppe (Hauptbaum zählt als Baum)');
  const groupChips = new Map<string, { root: HTMLElement; count: HTMLElement; sr: HTMLElement }>();
  const plantAction = el('div', 'ring-action');
  const plantButton = el('button', 'ring-button');
  plantButton.type = 'button';
  plantButton.dataset.ref = 'sow';
  // Säen öffnet die Aussaat in U:Begegnung (Kartenwahl wie bei Tieren, einfache Fassung bis 4a).
  const plantButtonText = el('span', '', '🌱 Säen');
  const plantButtonCost = el('span', 'ring-button-cost');
  plantButton.append(plantButtonText, plantButtonCost);
  plantButton.addEventListener('click', () => actions?.sow());
  const plantHint = el('p', 'ring-plant-hint');
  plantHint.dataset.ref = 'plant-hint';
  plantAction.append(plantButton, plantHint);
  ring.root.append(ringHint, supply, plantList, groupBox, plantAction);

  // --- Lesezeichen-Links -----------------------------------------------------------------
  const links = el('nav', 'niches-links');
  links.setAttribute('aria-label', 'Mehr über das Ökosystem');
  const link = (ref: string, label: string, summaryRef: string, open: () => void) => {
    const button = el('button', 'niches-link');
    button.type = 'button';
    button.dataset.ref = ref;
    const title = el('span', 'niches-link-title', label);
    const summary = el('span', 'niches-link-summary');
    summary.dataset.ref = summaryRef;
    const arrow = el('span', 'niches-link-arrow', '›');
    arrow.setAttribute('aria-hidden', 'true');
    // Kurzfassung und Pfeil bleiben zusammen – sonst rutscht „›“ bei 360 px allein in eine Zeile.
    const tail = el('span', 'niches-link-tail');
    tail.append(summary, arrow);
    button.append(title, tail);
    button.addEventListener('click', open);
    links.append(button);
    return { button, summary };
  };
  const communityLink = link('communities-link', 'Lebensgemeinschaften', 'communities-summary', () => {
    env.open({ kind: 'harmony' });
  });
  const communitySr = srOnly();
  communityLink.button.append(communitySr);
  communityLink.summary.setAttribute('aria-hidden', 'true');
  const foodWebLink = link('food-web-link', 'Nahrungsnetz', 'food-web-summary', () => env.open({ kind: 'foodweb' }));

  page.body.append(tip, links, families.root, ownTree.element, tree.root, habitats.root, ring.root, locked);

  let shownSerial = -1;
  let shownView: EcosystemView | null = null;
  /** Nach dem ersten Füllen – vorher keine Animationen (kein Einkleben beim Laden). */
  let filled = false;

  // --- Sticker-Tipp ------------------------------------------------------------------------
  function onSticker(id: string, kind: StickerKind, button: HTMLButtonElement): void {
    if (kind !== 'plant') {
      const animal = findAnimal(id);
      if (slotOpensDetails(animal, true)) {
        hideTip();
        env.open({ kind: 'animal', id });
        return;
      }
      openNote(button, {
        title: animal?.name ?? '',
        lines: [VISITOR_TEXT, animal ? `${formatPercent(animal.happiness)} zufrieden · ${animal.mood}` : ''],
        ref: 'visitor-note',
      });
      return;
    }
    const plant = current?.plantRing.plants.find((p) => p.id === id);
    if (plant) openNote(button, { title: `${plant.groupIcon} ${plant.name}`, lines: [plant.groupLabel], ref: 'plant-note' });
  }

  function findAnimal(id: string): AnimalView | undefined {
    for (const niche of current?.niches ?? []) {
      const animal = niche.animals.find((a) => a.id === id);
      if (animal) return animal;
    }
    return undefined;
  }

  // --- Gattungen ---------------------------------------------------------------------------
  function toggleFamily(id: string, wasOpen: boolean): void {
    const badge = familyBadges.get(id);
    if (!badge) return;
    if (wasOpen) {
      familyNote.hide(true);
      return;
    }
    selectedFamily = id;
    familyNote.setTitle(`${badge.icon.textContent ?? ''} ${badge.label}`.trim());
    setText(familyNoteText, badge.description);
    familyNote.show(badge.root);
  }

  function buildFamily(family: FamilyView): FamilyBadge {
    const button = el('button', 'family-badge');
    button.dataset.family = family.id;
    button.type = 'button';
    button.classList.add('note-trigger');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', familyNote.element.id);
    const icon = el('span', 'family-badge-icon', family.icon);
    icon.setAttribute('aria-hidden', 'true');
    const count = el('span', 'family-badge-count');
    count.setAttribute('aria-hidden', 'true');
    const pipBox = el('span', 'family-badge-pips');
    pipBox.setAttribute('aria-hidden', 'true');
    const sr = srOnly();
    button.append(icon, count, pipBox, sr);
    let openOnPress: boolean | null = null;
    const isOpen = () => familyNote.isOpen && selectedFamily === family.id;
    button.addEventListener('pointerdown', () => (openOnPress = isOpen()));
    button.addEventListener('click', () => {
      const wasOpen = openOnPress ?? isOpen();
      openOnPress = null;
      toggleFamily(family.id, wasOpen);
    });
    const badge: FamilyBadge = { root: button, icon, label: family.label, count, pipBox, pips: [], thresholdsKey: '', sr, tier: -1, description: '' };
    buildPips(badge, family.thresholds);
    return badge;
  }

  function buildPips(badge: FamilyBadge, thresholds: number[]): void {
    badge.thresholdsKey = thresholds.join('|');
    badge.pips = thresholds.map(() => el('span', 'badge-pip'));
    badge.pipBox.replaceChildren(...badge.pips);
  }

  function updateFamilies(list: FamilyView[]): void {
    for (const family of list) {
      let badge = familyBadges.get(family.id);
      if (!badge) {
        badge = buildFamily(family);
        familyBadges.set(family.id, badge);
      }
      if (family.thresholds.join('|') !== badge.thresholdsKey) buildPips(badge, family.thresholds);
      const { activeTier } = familyProgress(family.count, family.thresholds);
      setText(badge.count, familyCountLabel(family.count, family.thresholds));
      badge.pips.forEach((pip, i) => pip.classList.toggle('reached', i <= activeTier));
      badge.root.classList.toggle('active', activeTier >= 0);
      badge.root.classList.toggle('empty', family.count === 0);
      const description = familyDescription(family.label, family.count, family.thresholds, family.bonuses);
      if (description !== badge.description) {
        badge.description = description;
        setText(badge.sr, description);
        badge.root.title = description;
        if (selectedFamily === family.id) setText(familyNoteText, description);
      }
      if (activeTier > badge.tier && filled) restartAnimation(badge.root, 'tier-up');
      badge.tier = activeTier;
    }
    const order = list.map((f) => f.id).join('|');
    if (order !== familyOrder) {
      familyOrder = order;
      familyRow.replaceChildren(...list.map((f) => familyBadges.get(f.id)!.root));
      const present = new Set(list.map((f) => f.id));
      for (const id of [...familyBadges.keys()]) {
        if (present.has(id)) continue;
        familyBadges.delete(id);
        if (selectedFamily === id && familyNote.isOpen) familyNote.hide();
      }
    }
    families.root.hidden = list.length === 0;
  }

  // --- Nischen -----------------------------------------------------------------------------
  function buildRow(niche: NicheView): NicheRow {
    const li = el('li', 'nrow');
    li.dataset.niche = niche.id;
    const label = el('div', 'nrow-label');
    const title = el('span', 'nrow-title', `${niche.icon} ${niche.label}`);
    title.tabIndex = -1;
    const count = el('span', 'nrow-count');
    label.append(title, count);
    const content = el('div', 'nrow-content');
    const list = el('ul', 'sticker-list');
    list.setAttribute('aria-label', `Plätze in ${niche.label}`);
    const hint = el('p', 'nrow-hint');
    const hintText = el('span', 'nrow-hint-text');
    const care = el('button', 'nrow-care', 'Zur Forschung ›');
    care.type = 'button';
    care.dataset.ref = 'niche-care-link';
    care.hidden = true;
    care.setAttribute('aria-label', `Zur Forschung: ${niche.label} öffnen`);
    care.addEventListener('click', () => {
      const id = care.dataset.careLink;
      if (id) actions?.showCare(id);
    });
    hint.append(hintText, care);
    content.append(list, hint);
    const badge = createUpgradeBadge();
    label.append(badge.element);
    const target = { kind: 'niche', id: niche.id } as UpgradeTarget;
    const footer = createNicheFooter(() => buyUpgrade(target));
    li.append(label, content, footer.element);
    return { root: li, title, count, list, hint, hintText, care, slots: [], shownSlots: -1, footer, badge };
  }

  function updateRow(row: NicheRow, niche: NicheView): void {
    const locked = niche.capacity <= 0 && niche.animals.length === 0;
    row.root.classList.toggle('is-locked', locked);
    const used = niche.animals.length;
    row.root.classList.toggle('is-full', niche.capacity > 0 && used >= niche.capacity);
    setText(row.count, nicheSlotsLabel(used, niche.capacity));
    const showHint = !!niche.unlockHint && (locked || used === 0);
    setText(row.hintText, showHint ? niche.unlockHint! : '');
    const careLink = locked && niche.careLink ? niche.careLink : '';
    if ((row.care.dataset.careLink ?? '') !== careLink) {
      row.care.dataset.careLink = careLink;
      row.care.hidden = !careLink;
    }
    if (row.hint.hidden === (showHint || !!careLink)) row.hint.hidden = !(showHint || !!careLink);

    const needed = locked ? 0 : Math.max(niche.capacity, used);
    while (row.slots.length < needed) {
      const slot = createStickerSlot({ onTap: onSticker });
      row.slots.push(slot);
      row.list.append(slot.element);
    }
    // Neuer Platz (Ausbau-Meilenstein, Stufe, Ereignis): der leere Platz klebt sich ein (28.9).
    const arrive = filled && row.shownSlots > 0 ? row.shownSlots : needed;
    row.slots.forEach((slot, i) => {
      const hidden = i >= needed;
      if (slot.element.hidden !== hidden) slot.element.hidden = hidden;
      const animal = hidden ? undefined : niche.animals[i];
      if (animal) slot.setAnimal(animal, i, filled);
      else slot.setEmpty();
      if (!hidden && !animal && i >= arrive) restartAnimation(slot.element, 'slot-arrive');
    });
    row.shownSlots = needed;
    if (row.list.hidden !== (needed === 0)) row.list.hidden = needed === 0;
  }

  /** Zeilen aller Nischen anlegen bzw. auffrischen (wohin sie gehören, entscheidet `place`). */
  function updateRows(list: readonly NicheView[]): void {
    for (const niche of list) {
      let row = rows.get(niche.id);
      if (!row) {
        row = buildRow(niche);
        rows.set(niche.id, row);
      }
      updateRow(row, niche);
    }
  }

  /** Zeilen in eine Liste hängen – nur, wenn sich Auswahl oder Reihenfolge ändert. */
  function place(target: HTMLElement, ids: readonly string[], order: string, extra: HTMLElement[] = []): string {
    const next = [...ids, ...extra.map(() => '+')].join('|');
    if (next !== order) target.replaceChildren(...ids.map((id) => rows.get(id)!.root), ...extra);
    return next;
  }

  /** Zusammenfassung „Noch … verschlossen“: Zeilen, Text, ganz weg ohne Verschlossenes. */
  function placeLocked(): void {
    lockedOrder = place(lockedList, quietIds, lockedOrder, ringLocked ? [ringLockedRow] : []);
    setText(lockedText, lockedSummary(quietIds.length, ringLocked));
    const none = quietIds.length === 0 && !ringLocked;
    if (locked.hidden !== none) locked.hidden = none;
    if (none && locked.open) locked.open = false;
  }

  // --- Pflanzring --------------------------------------------------------------------------
  function updateRing(view: PlantRingView): void {
    const locked = view.capacity <= 0;
    // Verschlossen: als Zeile in der Zusammenfassung statt als eigener Abschnitt.
    ring.root.hidden = locked;
    setText(ringLockedHint, view.unlockHint ?? '');
    ringLockedP.hidden = !view.unlockHint;
    ringLocked = locked;
    ring.root.classList.toggle('is-locked', locked);
    setText(ringCount, nicheSlotsLabel(view.plants.length, view.capacity));
    setText(ringHint, locked ? (view.unlockHint ?? '') : '');
    ringHint.hidden = !locked || !view.unlockHint;
    supply.hidden = locked;
    setText(supplyText, view.supplyText);
    for (const meter of view.meters) {
      const refs = meters.get(meter.key);
      if (!refs) continue;
      const ratio = Number.isFinite(meter.ratio) ? Math.min(1, Math.max(0, meter.ratio)) : 0;
      setVar(refs.fill, '--fill', ratio.toFixed(3));
      refs.root.classList.toggle('short', ratio < 0.995);
      setText(refs.detail, `${meter.icon} ${meter.detail}`);
    }
    setText(supplyDetail, view.meters.map((m) => `${m.label}: ${m.detail}`).join('. '));
    setText(shortage, view.shortageHint ?? '');
    shortage.hidden = !view.shortageHint;

    const needed = locked ? 0 : Math.max(view.capacity, view.plants.length);
    while (plantSlots.length < needed) {
      const slot = createStickerSlot({ onTap: onSticker });
      plantSlots.push(slot);
      plantList.append(slot.element);
    }
    plantSlots.forEach((slot, i) => {
      const hidden = i >= needed;
      if (slot.element.hidden !== hidden) slot.element.hidden = hidden;
      const plant = hidden ? undefined : view.plants[i];
      if (plant) slot.setPlant(plant, i, filled);
      else slot.setEmpty();
    });
    plantList.hidden = locked;

    for (const group of view.groups) {
      let chip = groupChips.get(group.id);
      if (!chip) {
        const li = el('li', 'ring-group');
        li.dataset.group = group.id;
        const icon = el('span', 'ring-group-icon', group.icon);
        icon.setAttribute('aria-hidden', 'true');
        const count = el('b', 'ring-group-count');
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

    plantButton.hidden = !view.canSow;
    setText(plantButtonText, view.sowLabel);
    const price = view.sowCost > 0 ? `${view.sowCostLabel} 🌰` : view.sowCostLabel;
    setText(plantButtonCost, view.sowOpen ? '' : `· ${price}${view.sowSeason ? ' · Saatzeit' : ''}`);
    plantButton.classList.toggle('affordable', view.affordable);
    setAttr(
      plantButton,
      'aria-label',
      view.sowOpen
        ? 'Aussaat offen – ansehen'
        : `${view.sowLabel.replace('🌱 ', '')} – ${view.sowCost > 0 ? `kostet ${view.sowCostLabel} Samen` : 'gratis'}${view.affordable ? '' : ', noch nicht genug'}`,
    );
    setText(plantHint, view.plantHint);
    plantHint.hidden = !view.plantHint;
    plantAction.hidden = locked;
  }

  // --- Ausbau: jeden Durchlauf (Samen ändern „reicht es?“), nur geänderte Texte schreiben -----
  function updateUpgrades(view: EcosystemView): void {
    const ctx: UpgradeContext = { seeds: view.seeds, seedsPerSecond: view.seedsPerSec, amount };
    let open = false;
    for (const niche of view.niches) {
      const row = rows.get(niche.id);
      const up = niche.upgrade;
      if (!row) continue;
      if (!up) {
        row.footer.element.hidden = true;
        row.badge.update(null);
        continue;
      }
      const footer = nicheFooterView({ ...up, purchase: up.open ? purchaseFor(up.purchases, amount) : null }, ctx);
      row.footer.update(footer);
      row.badge.update(footer.badge);
      open ||= up.open;
    }
    const parts = view.treeUpgrades.map((p) => ({ ...p, purchase: purchaseFor(p.purchases, amount) }));
    ownTree.update(
      parts.map((p) => treePartView(p, ctx)),
      treeMilestoneHint(parts),
    );
    ownTree.element.hidden = parts.length === 0;
    open ||= parts.length > 0;
    amountSwitch.update(amount);
    if (amountSwitch.element.hidden === open) amountSwitch.element.hidden = !open;
  }

  /** Kauf mit der gewählten Menge; Rückmeldung an der Zeile (Aufleuchten, „+1 Stufe“). */
  function buyUpgrade(target: UpgradeTarget): void {
    const outcome = actions?.upgrade(target, countOf(amount)) ?? null;
    if (!outcome) return;
    const anchor = target.kind === 'tree' ? ownTree.row(target.id) : (rows.get(target.id)?.footer.element ?? null);
    if (target.kind === 'tree') ownTree.flash(target.id);
    else rows.get(target.id)?.footer.flash();
    const rect = anchor?.getBoundingClientRect();
    if (rect && rect.width > 0) env.float(upgradeFloatText(outcome.bought), rect.right - 56, rect.top);
  }

  // --- Links ---------------------------------------------------------------------------------
  function updateLinks(communities: CommunityListView, foodWeb: FoodWebView, niches: readonly NicheView[]): void {
    const discovered = communities.items.filter((c) => c.discovered).length;
    links.hidden = !ecosystemLinksVisible(niches, discovered);
    setText(communityLink.summary, communities.summary);
    setText(communitySr, `: ${communities.summaryText}`);
    setText(foodWebLink.summary, foodWeb.summary);
    foodWebLink.button.classList.toggle('alert', foodWeb.rows.some((r) => r.state === 'overhunted'));
  }

  function update(): void {
    const view = env.eco.view;
    if (!view || env.eco.serial === shownSerial) return;
    shownSerial = env.eco.serial;
    current = view;
    if (view !== shownView) {
      shownView = view;
      page.setMeta(nichesPageHeader(view.niches));
      updateFamilies(view.families);
      updateRows(view.niches);
      const split = splitNiches(view.niches);
      const openIds = (list: NicheView[]) => list.filter((n) => !isQuietLocked(n)).map((n) => n.id);
      const treeIds = openIds(split.tree);
      const habitatIds = openIds(split.habitats);
      treeOrder = place(treeList, treeIds, treeOrder);
      habitatOrder = place(habitatList, habitatIds, habitatOrder);
      tree.root.hidden = treeIds.length === 0;
      habitats.root.hidden = habitatIds.length === 0;
      quietIds = [...split.tree, ...split.habitats].filter(isQuietLocked).map((n) => n.id);
      const present = new Set(view.niches.map((n) => n.id));
      for (const id of [...rows.keys()]) if (!present.has(id)) rows.delete(id);
      updateLinks(view.communities, view.foodWeb, view.niches);
    }
    updateRing(view.plantRing);
    updateUpgrades(view);
    placeLocked();
    filled = true;
  }

  function reveal(target: UpgradeTarget | 'sow'): boolean {
    // Seite zuerst füllen (der Sprung kann vor dem ersten Auffrischen kommen).
    update();
    let row: HTMLElement | null;
    let focus: HTMLElement | null;
    if (target === 'sow') {
      row = ring.root.hidden ? null : ring.root;
      focus = ring.head;
    } else if (target.kind === 'tree') {
      row = ownTree.element.hidden ? null : ownTree.row(target.id);
      focus = row?.querySelector<HTMLElement>('.upgrade-part-title') ?? null;
    } else {
      const r = rows.get(target.id);
      row = r && r.root.isConnected && !r.footer.element.hidden ? r.root : null;
      focus = r?.title ?? null;
    }
    if (!row) return false;
    const reduce = env.deps.preferences.reducedMotion;
    row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    focus?.focus({ preventScroll: true });
    // Nur Farbe, keine Bewegung – darum auch bei reduzierter Bewegung (wie nach einem Kauf).
    restartAnimation(row, 'goal-flash');
    return true;
  }

  return {
    page,
    plantButton,
    reveal,
    update,
    connect(next) {
      actions = next;
    },
  };
}
