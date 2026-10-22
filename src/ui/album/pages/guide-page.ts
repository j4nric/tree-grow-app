/**
 * Spielanleitung im Album (docs/ALBUM_UI.md, B.7 und A.12 #127): Umschlag → „📖 Spielanleitung ›“
 * blättert zum Inhaltsverzeichnis (U:Anleitung, Ebene 1), ein Kapitel blättert weiter zur
 * Kapitelseite (Ebene 2). Auf der Kapitelseite blättern „‹ Kapitel davor“ und „nächstes
 * Kapitel ›“ weiter, ohne tiefer zu gehen (die oberste Seite wird ersetzt).
 *
 * Inhalt kommt unverändert aus guide-view.ts (alle Zahlen aus content/ und core/). Die
 * Sichtbarkeitsregel gilt weiter: Vor der Freischaltung der Waldlandschaft steht im Kapitel
 * „Waldlandschaft“ nur die Andeutung, und die Erfolge zählen deren Erfolge noch nicht mit.
 * Die Seiten fragen die Freischaltung beim Öffnen und beim Auffrischen (nur sichtbar) ab.
 *
 * DOM: Inhaltsverzeichnis und Kapitelseite werden einmal gebaut. Neu gefüllt wird nur beim
 * Öffnen eines anderen Kapitels oder bei der Freischaltung – nie im Frame.
 */
import { landscapeUnlocked } from '../../../core/landscape';
import { el, setText } from '../../dom';
import { restartAnimation } from '../../feedback';
import { guideSections, type GuideSection } from '../../guide-view';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber, type PageRef } from '../nav';
import type { PageEnv, Subpage } from './registry';
import './guide-page.css';

/** Kurzer Einleitungssatz über dem Inhaltsverzeichnis. */
export const GUIDE_LEAD = 'Kurz erklärt: So wächst dein Wald.';

/** Kapitel der Anleitung für den aktuellen Stand (Waldlandschaft sichtbar?). */
function chaptersFor(env: PageEnv): GuideSection[] {
  return guideSections({ landscape: landscapeUnlocked(env.deps.state()) });
}

/** Inhaltsverzeichnis: ein Knopf je Kapitel (Symbol als Sticker, Titel, „›“). */
export function createGuidePage(env: PageEnv): Subpage {
  const page = createPage({
    kind: 'guide',
    title: 'Spielanleitung',
    number: pageNumber({ ...initialNav(), cover: true, stack: [{ kind: 'guide' }] }),
    className: 'album-subpage guide-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Umschlag');
  page.element.prepend(bookmark.element);

  const lead = el('p', 'guide-lead', GUIDE_LEAD);
  const list = el('ol', 'guide-toc');
  list.dataset.ref = 'guide-toc';
  page.body.append(lead, list);

  /** Knopf je Kapitel-ID (Titel können sich mit der Freischaltung ändern). */
  const links = new Map<string, { item: HTMLLIElement; title: HTMLElement; icon: HTMLElement }>();
  let shownUnlocked: boolean | null = null;

  function fill(): void {
    const unlocked = landscapeUnlocked(env.deps.state());
    if (unlocked === shownUnlocked) return;
    shownUnlocked = unlocked;
    const chapters = guideSections({ landscape: unlocked });
    page.setMeta(`${chapters.length} Kapitel`);
    const items: HTMLLIElement[] = [];
    chapters.forEach((chapter, index) => {
      let link = links.get(chapter.id);
      if (!link) {
        const item = el('li', 'guide-toc-item');
        const button = el('button', 'guide-toc-link');
        button.type = 'button';
        button.dataset.chapter = chapter.id;
        const icon = el('span', 'guide-toc-icon');
        icon.setAttribute('aria-hidden', 'true');
        const number = el('span', 'guide-toc-number');
        number.setAttribute('aria-hidden', 'true');
        const title = el('span', 'guide-toc-title');
        const more = el('span', 'guide-toc-more', '›');
        more.setAttribute('aria-hidden', 'true');
        button.append(number, icon, title, more);
        button.addEventListener('click', () => env.open({ kind: 'guide', section: chapter.id }));
        item.append(button);
        link = { item, title, icon };
        links.set(chapter.id, link);
      }
      setText(link.icon, chapter.icon);
      setText(link.title, chapter.title);
      setText(link.item.querySelector<HTMLElement>('.guide-toc-number')!, String(index + 1));
      items.push(link.item);
    });
    list.replaceChildren(...items);
  }

  return {
    page,
    bookmark,
    opened: fill,
    update: fill,
  };
}

/** Kapitelseite: Überschrift mit Symbol, Absätze, Blättern zum Kapitel davor bzw. danach. */
export function createGuideChapterPage(env: PageEnv): Subpage {
  const page = createPage({
    kind: 'guide-chapter',
    title: '',
    number: pageNumber({ ...initialNav(), cover: true, stack: [{ kind: 'guide' }, { kind: 'guide', section: 'x' }] }),
    className: 'album-subpage guide-page guide-chapter',
  });
  const bookmark = createBookmark(() => env.back());
  page.element.prepend(bookmark.element);
  const icon = el('span', 'guide-chapter-icon');
  icon.setAttribute('aria-hidden', 'true');
  page.header.prepend(icon);

  const article = el('article', 'guide-chapter-text');
  const soon = el('p', 'guide-soon');
  soon.hidden = true;
  const paragraphs = el('div', 'guide-paragraphs');
  article.append(soon, paragraphs);

  const nav = el('nav', 'guide-chapter-nav');
  nav.setAttribute('aria-label', 'Kapitel blättern');
  const prev = el('button', 'guide-turn guide-prev');
  prev.type = 'button';
  prev.dataset.ref = 'guide-prev';
  const next = el('button', 'guide-turn guide-next');
  next.type = 'button';
  next.dataset.ref = 'guide-next';
  nav.append(prev, next);
  page.body.append(article, nav);

  let shownId = '';
  let shownKey = '';
  /** Freischaltung beim letzten Füllen – im Frame nur das vergleichen (billig). */
  let shownUnlocked: boolean | null = null;
  let prevId = '';
  let nextId = '';
  prev.addEventListener('click', () => prevId && env.open({ kind: 'guide', section: prevId }));
  next.addEventListener('click', () => nextId && env.open({ kind: 'guide', section: nextId }));

  function fill(id: string): void {
    shownUnlocked = landscapeUnlocked(env.deps.state());
    const chapters = chaptersFor(env);
    const index = Math.max(0, chapters.findIndex((c) => c.id === id));
    const chapter = chapters[index];
    if (!chapter) return;
    // Nur neu füllen, wenn sich Kapitel oder Inhalt ändern (Freischaltung der Landschaft).
    const key = `${chapter.id}|${chapter.title}|${chapter.paragraphs.join('\n')}`;
    if (key === shownKey) return;
    const turned = shownId !== '' && shownId !== chapter.id && !page.element.hidden;
    shownKey = key;
    shownId = chapter.id;
    page.element.dataset.section = chapter.id;
    setText(icon, chapter.icon);
    page.setTitle(chapter.title);
    page.setMeta(`Kapitel ${index + 1} von ${chapters.length}`);
    soon.hidden = !chapter.soon;
    setText(soon, chapter.soon ? 'kommt bald' : '');
    paragraphs.replaceChildren(...chapter.paragraphs.map((text) => el('p', 'guide-text', text)));
    const before = chapters[index - 1];
    const after = chapters[index + 1];
    prevId = before?.id ?? '';
    nextId = after?.id ?? '';
    prev.hidden = !before;
    next.hidden = !after;
    setText(prev, before ? `‹ ${before.title}` : '');
    setText(next, after ? `${after.title} ›` : '');
    prev.setAttribute('aria-label', before ? `Kapitel davor: ${before.title}` : '');
    next.setAttribute('aria-label', after ? `Nächstes Kapitel: ${after.title}` : '');
    if (turned) {
      // Weitergeblättert auf derselben Seite: nach oben, kurz „umblättern“, Fokus auf den Titel.
      const scroller = page.element.closest<HTMLElement>('.spread-sub');
      if (scroller) scroller.scrollTop = 0;
      restartAnimation(page.element, 'guide-turned');
      page.focusTitle();
    }
  }

  return {
    page,
    bookmark,
    opened(ref?: PageRef) {
      if (ref?.kind === 'guide' && ref.section) fill(ref.section);
    },
    update() {
      if (shownId && landscapeUnlocked(env.deps.state()) !== shownUnlocked) fill(shownId);
    },
  };
}
