/**
 * Tierdetails: modaler Dialog im Stil der Begegnungskarte für eine eingezogene Art
 * (Klick auf eine Tier-Kachel in der Seitenleiste; später auch aus der Szene).
 *
 * Reine Darstellung: zeigt ein `AnimalDetailView` (animal-detail-view.ts). Keine
 * Spielaktionen – kein Ersetzen, kein Entlassen. Das Grundgerüst entsteht einmal; der
 * Inhalt wird nur neu gebaut, wenn sich die Ansicht wirklich ändert (gedrosselt aus
 * main.ts). Escape oder „Schließen“ schließen, der Fokus geht an den Auslöser zurück.
 */
import { el, setText } from './dom';
import { hyphenate } from './hyphenate';
import { renderConditions, renderPreviewChips } from './encounter-dialog';
import { RARITY_LABELS, formatPercent, happinessLevel, toneSymbol } from './view-format';
import type { AnimalDetailView } from './view-model';

export interface AnimalDetailDialog {
  /**
   * Öffnet den Dialog (oder zeigt im offenen eine andere Art). `returnFocus`: wohin der
   * Fokus beim Schließen zurückgeht – Standard ist das gerade fokussierte Element.
   */
  show(view: AnimalDetailView, returnFocus?: HTMLElement | null): void;
  /**
   * Aktualisiert den offenen Dialog; `null` (Art lebt nicht mehr hier) schließt ihn. Dann
   * bekommt `fallbackFocus` (z. B. die Nischen-Überschrift) den Fokus statt der Kachel,
   * die mit der Art verschwindet.
   */
  update(view: AnimalDetailView | null, fallbackFocus?: HTMLElement | null): void;
  hide(): void;
  notice(text: string): void;
  readonly open: boolean;
  /** Art im offenen Dialog (sonst null). */
  readonly speciesId: string | null;
  /** Nische der Art im offenen Dialog (sonst null). */
  readonly nicheId: string | null;
}

/** Abschnitt mit Überschrift; `body` wird bei Bedarf geleert und neu gefüllt. */
function section(prefix: string, key: string, title: string, body: HTMLElement): HTMLElement {
  const box = el('section', `detail-section detail-${key}`);
  box.dataset.ref = `detail-${key}`;
  const heading = el('h3', 'detail-heading', title);
  heading.id = `${prefix}-${key}`;
  box.setAttribute('aria-labelledby', heading.id);
  box.append(heading, body);
  return box;
}

export function createAnimalDetailDialog(root: HTMLElement): AnimalDetailDialog {
  const prefix = 'animal-detail';
  const dialog = el('dialog', 'encounter animal-detail');
  dialog.dataset.ref = 'animal-detail';
  dialog.setAttribute('aria-labelledby', `${prefix}-title`);
  dialog.setAttribute('aria-describedby', `${prefix}-mood`);

  const inner = el('div', 'encounter-inner');
  const card = el('article', 'encounter-card detail-card');

  const band = el('div', 'card-band');
  const family = el('span', 'card-family');
  const familyIcon = el('span', 'card-family-icon');
  familyIcon.setAttribute('aria-hidden', 'true');
  const familyLabel = el('span');
  family.append(familyIcon, familyLabel);
  const gem = el('span', 'card-rarity');
  const gemIcon = el('span', 'gem', '◆');
  gemIcon.setAttribute('aria-hidden', 'true');
  const gemLabel = el('span');
  gem.append(gemIcon, gemLabel);
  band.append(family, gem);

  // Kopf: großes Symbol mit Zufriedenheitsring, Name, Nische, Zufriedenheit und Stimmung
  const head = el('header', 'detail-head');
  const ring = el('span', 'detail-ring');
  ring.setAttribute('aria-hidden', 'true');
  const heroIcon = el('span', 'detail-hero-icon');
  ring.append(heroIcon);
  const headText = el('div', 'detail-head-text');
  const kind = el('p', 'encounter-kind', 'Tierdetails');
  const title = el('h2', 'card-name detail-name');
  title.id = `${prefix}-title`;
  const niche = el('p', 'card-niche detail-niche');
  const mood = el('p', 'detail-mood');
  mood.id = `${prefix}-mood`;
  mood.dataset.ref = 'detail-happiness';
  const moodValue = el('b', 'detail-happiness');
  const moodText = el('span', 'detail-mood-text');
  mood.append(moodValue, moodText);
  headText.append(kind, title, niche, mood);
  head.append(ring, headText);

  const contribution = el('ul', 'card-preview detail-contribution');
  contribution.setAttribute('aria-label', 'Beitrag zum Ökosystem');
  const contributionNote = el('p', 'detail-note');
  contributionNote.dataset.ref = 'detail-contribution-note';
  const contributionBody = el('div');
  contributionBody.append(contribution, contributionNote);

  const conditions = el('ul', 'card-conditions');
  conditions.setAttribute('aria-label', 'Futter und Wünsche');
  const factors = el('ul', 'card-effects detail-factors');
  factors.setAttribute('aria-label', 'Weitere Einflüsse');
  const happyBody = el('div', 'detail-stack');
  happyBody.append(conditions, factors);

  // Räuber und Beute: Bestand, wen sie ernährt, wie es um ihr Futter steht (DESIGN_V2.md 22.7).
  const predation = el('ul', 'card-effects detail-predation-list');
  const effects = el('ul', 'card-effects');
  const abilities = el('ul', 'detail-abilities');
  const communities = el('ul', 'detail-communities');
  const regular = el('p', 'detail-regular');
  regular.dataset.ref = 'detail-regular';
  const flavor = el('p', 'card-flavor');

  const sections = {
    contribution: section(prefix, 'contribution', 'Beitrag gerade', contributionBody),
    reasons: section(prefix, 'reasons', 'Zufriedenheit – warum?', happyBody),
    predation: section(prefix, 'predation', 'Räuber und Beute', predation),
    effects: section(prefix, 'effects', 'Wirkungen', effects),
    abilities: section(prefix, 'abilities', 'Fähigkeiten', abilities),
    communities: section(prefix, 'communities', 'Lebensgemeinschaften', communities),
  };
  card.append(
    band,
    head,
    sections.contribution,
    sections.reasons,
    sections.predation,
    sections.effects,
    sections.abilities,
    sections.communities,
    regular,
    flavor,
  );

  const noticeBox = el('p', 'encounter-notice');
  noticeBox.setAttribute('role', 'status');
  noticeBox.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const actions = el('div', 'encounter-actions');
  const close = el('button', 'encounter-button secondary', 'Schließen');
  close.type = 'button';
  close.dataset.ref = 'detail-close';
  actions.append(noticeBox, close);

  inner.append(card, actions);
  dialog.append(inner);
  root.append(dialog);

  let current: string | null = null;
  let currentNiche: string | null = null;
  let signature = '';
  let returnFocus: HTMLElement | null = null;

  function render(view: AnimalDetailView): void {
    const next = JSON.stringify(view);
    if (next === signature) return;
    signature = next;
    current = view.id;
    currentNiche = view.nicheId;
    dialog.dataset.species = view.id;

    const level = happinessLevel(view.happiness);
    card.className = `encounter-card detail-card family-${view.family} rarity-${view.rarity} happy-${level}`;
    setText(familyIcon, view.familyIcon);
    setText(familyLabel, view.familyLabel);
    setText(gemLabel, RARITY_LABELS[view.rarity]);
    setText(heroIcon, view.familyIcon);
    ring.style.setProperty('--h', Math.min(1, Math.max(0, view.happiness)).toFixed(3));
    const shown = hyphenate(view.name);
    setText(title, shown);
    if (shown !== view.name) title.setAttribute('aria-label', view.name);
    else title.removeAttribute('aria-label');
    setText(niche, `Nische: ${view.nicheLabel}`);
    setText(moodValue, `😊 ${formatPercent(view.happiness)}`);
    setText(moodText, view.mood);
    moodValue.setAttribute('aria-label', `Zufriedenheit ${formatPercent(view.happiness)}`);

    renderPreviewChips(contribution, view.contribution);
    setText(contributionNote, view.contributionNote);
    renderConditions(conditions, view.conditions);
    factors.replaceChildren(
      ...view.factors.map((factor) => {
        const li = el('li', `tone-${factor.tone}`);
        li.dataset.factor = factor.key;
        const icon = el('span', 'mark', factor.icon);
        icon.setAttribute('aria-hidden', 'true');
        li.append(icon, el('span', '', factor.label));
        return li;
      }),
    );

    predation.replaceChildren(
      ...view.predation.map((row) => {
        const li = el('li', `tone-${row.tone}`);
        li.dataset.predation = row.key;
        const icon = el('span', 'mark', row.icon);
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'detail-predation-text');
        text.append(el('span', '', row.label));
        if (row.hint) text.append(el('span', 'detail-predation-hint', row.hint));
        li.append(icon, text);
        return li;
      }),
    );
    sections.predation.hidden = view.predation.length === 0;

    effects.replaceChildren(
      ...view.effects.map((effect) => {
        const li = el('li', `tone-${effect.tone}`);
        const mark = el('span', 'mark', toneSymbol(effect.tone));
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', '', effect.label));
        return li;
      }),
    );
    sections.effects.hidden = view.effects.length === 0;

    abilities.replaceChildren(
      ...view.abilities.map((ability) => {
        const li = el('li');
        li.append(el('b', '', ability.name), el('span', '', ` – ${ability.text}`));
        return li;
      }),
    );
    sections.abilities.hidden = view.abilities.length === 0;

    communities.replaceChildren(
      ...view.communities.map((c) => {
        const li = el('li', `detail-community${c.active ? ' active' : ''}${c.discovered ? '' : ' undiscovered'}`);
        // Nur entdeckte tragen ihre ID – Unentdeckte verraten nichts (wie im Tagebuch).
        if (c.discovered) li.dataset.community = c.key;
        const icon = el('span', 'community-icon', c.icon);
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'community-text');
        text.append(el('span', 'community-name', c.name));
        const state = c.active ? 'besteht gerade' : (c.progress ?? '');
        if (state) text.append(el('span', 'community-note', state));
        if (c.effect) text.append(el('span', 'community-note', c.effect));
        if (c.hint) text.append(el('span', 'community-note detail-hint', c.hint));
        li.append(icon, text);
        return li;
      }),
    );
    sections.communities.hidden = view.communities.length === 0;

    setText(regular, view.regular ?? '');
    regular.hidden = view.regular === null;
    setText(flavor, view.text ?? '');
    flavor.hidden = !view.text;
  }

  function show(view: AnimalDetailView, focusTarget?: HTMLElement | null): void {
    const wasOpen = dialog.open;
    if (!wasOpen) {
      returnFocus =
        focusTarget !== undefined ? focusTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (focusTarget) {
      returnFocus = focusTarget;
    }
    render(view);
    if (!wasOpen) {
      dialog.showModal();
      dialog.scrollTop = 0;
      close.focus({ preventScroll: true });
    }
  }

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    noticeBox.hidden = true;
    noticeBox.textContent = '';
  }

  function cleanup(): void {
    clearNotice();
    current = null;
    currentNiche = null;
    signature = '';
    delete dialog.dataset.species;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.closest('[hidden]')) target.focus();
  }

  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
  }

  close.addEventListener('click', hide);
  // Escape schließt (Standard des <dialog>); aufräumen und Fokus zurück in `close`.
  dialog.addEventListener('close', cleanup);
  // Klick auf den abgedunkelten Hintergrund schließt ebenfalls – aber nur, wenn er dort
  // auch begann (sonst schlösse eine Textauswahl, die außerhalb der Karte endet).
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (event) => {
    downOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    const fromBackdrop = downOnBackdrop;
    downOnBackdrop = false;
    if (event.target === dialog && fromBackdrop) hide();
  });

  return {
    show,
    update(view, fallbackFocus) {
      if (!dialog.open) return;
      if (view) {
        render(view);
        return;
      }
      // Die Kachel der Art verschwindet gleich – sonst landete der Fokus auf <body>.
      if (fallbackFocus) returnFocus = fallbackFocus;
      hide();
    },
    hide,
    notice(text) {
      clearTimeout(noticeTimer);
      noticeBox.textContent = text;
      noticeBox.hidden = false;
      noticeTimer = setTimeout(clearNotice, 4000);
    },
    get open() {
      return dialog.open;
    },
    get speciesId() {
      return dialog.open ? current : null;
    },
    get nicheId() {
      return dialog.open ? currentNiche : null;
    },
  };
}
