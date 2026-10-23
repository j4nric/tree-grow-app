/**
 * Abschnitt „Chronik“ auf U:Standort (DESIGN_V2.md 26.7, ROADMAP Phase 9, 3a): sechs kleine
 * Zettel im Raster – geschriebene mit Stempel und Datum („7. Zyklus · Winter“, ohne Datum
 * „schon früher“), offene blass mit einem Hinweis ohne Spoiler. Ist die Chronik vollständig,
 * klebt darunter das Andenken als großer Sticker.
 *
 * DOM einmal bauen (sechs Zettel fest), `show()` setzt nur Texte und Klassen. Ein Kapitel, das
 * bei offenem Standort neu geschrieben wird, bekommt den kleinen Stempel-Effekt (nicht beim
 * Wechsel des Standorts; ohne Bewegung bei reduzierter Bewegung, chronicle.css).
 */
import { CHRONICLE_CHAPTERS, type ChapterId } from '../../../content/chronicle';
import type { SiteId } from '../../../content/landscape';
import type { GameState } from '../../../core/state';
import { chronicleVisible, firstSnowWaitText, siteChronicleView } from '../../chronicle-view';
import { el, setText, srOnly } from '../../dom';
import { restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import './chronicle.css';

interface ChapterNode {
  li: HTMLLIElement;
  title: HTMLElement;
  stamp: HTMLElement;
  hint: HTMLElement;
  sr: HTMLElement;
  written: boolean;
}

export interface SiteChronicle {
  readonly element: HTMLElement;
  /** Chronik des Standorts zeigen (verborgen vor der Landschaft). */
  show(state: GameState, site: SiteId): void;
  /**
   * Nur den Verweilen-Hinweis nachziehen („❄️ Noch 1:19 min bis zum Winter …“, F3) – billig,
   * setzt Text nur bei Änderung; der Aufrufer drosselt.
   */
  tick(state: GameState, site: SiteId): void;
}

export function createSiteChronicle(): SiteChronicle {
  const section = el('section', 'site-chronicle');
  section.dataset.ref = 'site-chronicle';
  const title = el('h3', 'lsc-title chr-heading');
  title.id = 'site-chronicle-title';
  section.setAttribute('aria-labelledby', title.id);
  const name = el('span', '', 'Chronik');
  const count = el('span', 'chr-count');
  count.dataset.ref = 'site-chronicle-count';
  title.append(name, ' ', count);
  // Verweilen im Urwald (Playtest Phase 9, F3): worauf man wartet, wenn „Erster Schnee“ offen ist.
  const wait = el('p', 'chr-wait');
  wait.dataset.ref = 'chronicle-wait';
  wait.hidden = true;
  const list = el('ol', 'chr-list');
  list.dataset.ref = 'site-chronicle-list';
  const empty = el('p', 'lsc-hint chr-empty', 'Die Chronik beginnt mit der Gründung dieses Waldes – dann schreibt er sein Tagebuch in sechs Kapiteln.');

  const nodes = new Map<ChapterId, ChapterNode>();
  CHRONICLE_CHAPTERS.forEach((c, index) => {
    const li = el('li', 'chr-chapter');
    li.dataset.chapter = c.id;
    li.style.setProperty('--tilt', `${index % 2 === 0 ? -0.8 : 0.7}deg`);
    const icon = el('span', 'chr-icon', c.icon);
    icon.setAttribute('aria-hidden', 'true');
    const chapterTitle = el('b', 'chr-title');
    const stamp = el('span', 'chr-stamp');
    stamp.dataset.ref = 'chapter-stamp';
    const hint = el('span', 'chr-hint');
    const sr = srOnly();
    li.append(icon, chapterTitle, sr, stamp, hint);
    list.append(li);
    nodes.set(c.id, { li, title: chapterTitle, stamp, hint, sr, written: false });
  });

  // Andenken der vollständigen Chronik: großer Sticker mit Text.
  const keepsake = el('figure', 'chr-keepsake');
  keepsake.dataset.ref = 'site-keepsake';
  const keepsakeIcon = el('span', 'chr-keepsake-icon');
  keepsakeIcon.setAttribute('aria-hidden', 'true');
  const caption = el('figcaption', 'chr-keepsake-caption');
  const keepsakeLabel = el('span', 'chr-keepsake-label', 'Andenken');
  const keepsakeName = el('b', 'chr-keepsake-name');
  const keepsakeText = el('span', 'chr-keepsake-text');
  caption.append(keepsakeLabel, keepsakeName, keepsakeText);
  keepsake.append(keepsakeIcon, caption);

  section.append(title, wait, list, keepsake, empty);
  section.hidden = true;

  let shownSite: SiteId | null = null;

  function updateWait(state: GameState, site: SiteId): void {
    const text = firstSnowWaitText(state, site);
    wait.hidden = text === null;
    setText(wait, text ?? '');
  }

  return {
    element: section,
    tick(state, site) {
      if (section.hidden) return;
      updateWait(state, site);
    },
    show(state, site) {
      const visible = chronicleVisible(state);
      section.hidden = !visible;
      if (!visible) {
        shownSite = null;
        return;
      }
      const view = siteChronicleView(state, site);
      const sameSite = shownSite === site;
      shownSite = site;
      list.hidden = view === null;
      updateWait(state, site);
      empty.hidden = view !== null;
      setText(count, view ? `${view.written} / ${view.total}` : '');
      section.classList.toggle('complete', view?.complete === true);
      for (const c of view?.chapters ?? []) {
        const node = nodes.get(c.id);
        if (!node) continue;
        const fresh = sameSite && c.written && !node.written;
        node.written = c.written;
        node.li.classList.toggle('written', c.written);
        setText(node.title, hyphenate(c.title));
        setText(node.stamp, c.date ?? '');
        node.stamp.hidden = !c.written;
        setText(node.hint, c.hint ?? '');
        node.hint.hidden = c.written;
        setText(node.sr, c.written ? `, geschrieben: ${c.date ?? ''}` : ', noch offen');
        if (fresh) restartAnimation(node.li, 'chr-fresh');
      }
      const k = view?.keepsake ?? null;
      keepsake.hidden = k === null;
      setText(keepsakeIcon, k?.icon ?? '');
      setText(keepsakeName, k ? hyphenate(k.name) : '');
      setText(keepsakeText, k?.text ?? '');
    },
  };
}
