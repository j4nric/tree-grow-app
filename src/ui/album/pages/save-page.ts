/**
 * Unterseite „Spielstand“ aus dem Umschlag (docs/ALBUM_UI.md, B.7 und A.12 #131, #10):
 * Exportieren und Importieren (save-transfer.ts) und „Spielstand löschen“ mit zweitem
 * Klick zur Bestätigung (ohne confirm()). Das Löschen selbst macht main.ts (`resetGame`).
 */
import { el } from '../../dom';
import { confirmAgainText, isDeliberateConfirm } from '../../confirm';
import { createSaveTransfer, type SaveTransfer } from '../../save-transfer';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber } from '../nav';
import type { PageEnv, Subpage } from './registry';
import './forms.css';
import './save-page.css';

const RESET_TEXT = 'Spielstand löschen';
const RESET_ARM_MS = 4000;

export interface SavePage extends Subpage {
  readonly transfer: SaveTransfer;
  /** Offene Bestätigung von „Spielstand löschen“ zurücknehmen. */
  disarm(): void;
}

export function createSavePage(env: PageEnv): SavePage {
  const page = createPage({
    kind: 'save',
    title: 'Spielstand',
    number: pageNumber({ ...initialNav(), cover: true, stack: [{ kind: 'save' }] }),
    className: 'album-subpage',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Umschlag');
  page.element.prepend(bookmark.element);

  const box = el('div', 'save-page');
  const footer = el('section', 'save-block save-page-reset');
  footer.setAttribute('aria-labelledby', 'save-reset-title');
  const resetTitle = el('h3', 'save-title', 'Neu anfangen');
  resetTitle.id = 'save-reset-title';
  const resetHint = el('p', 'save-hint', 'Löscht deinen Wald auf diesem Gerät. Exportiere ihn vorher, wenn du ihn aufheben willst.');
  const reset = el('button', 'save-button save-reset', RESET_TEXT);
  reset.type = 'button';
  reset.id = 'reset';
  reset.dataset.ref = 'reset';
  footer.append(resetTitle, resetHint, reset);
  box.append(footer);
  page.body.append(box);
  // Export und Import stehen vor „Spielstand löschen“ (save-transfer.ts hängt sich vorn an).
  const transfer = createSaveTransfer(box, env.deps.saveTransfer);

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Wann der Knopf scharf geschaltet wurde (performance.now) – gegen Doppelklicks. */
  let armedAt = 0;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    reset.textContent = RESET_TEXT;
    reset.classList.remove('armed');
  };
  reset.addEventListener('click', (event) => {
    if (timer === undefined) {
      if (event.detail > 1) return;
      reset.textContent = confirmAgainText('Wirklich alles löschen?');
      reset.classList.add('armed');
      armedAt = performance.now();
      timer = setTimeout(disarm, RESET_ARM_MS);
      return;
    }
    // Doppelklick oder gehaltene Enter-Taste bestätigen nicht.
    if (!isDeliberateConfirm(event, armedAt, performance.now())) return;
    disarm();
    env.deps.actions.resetGame();
  });

  return {
    page,
    bookmark,
    transfer,
    disarm,
    reset() {
      disarm();
      transfer.reset();
    },
  };
}
