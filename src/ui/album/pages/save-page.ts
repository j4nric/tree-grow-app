/**
 * Unterseite „Spielstand“ aus dem Umschlag (docs/ALBUM_UI.md, B.7 und A.12 #131, #10):
 * Exportieren und Importieren (save-transfer.ts) und „Spielstand löschen“ mit zweitem
 * Klick zur Bestätigung (ohne confirm()). Das Löschen selbst macht main.ts (`resetGame`).
 */
import { el } from '../../dom';
import { isDeliberateConfirm } from '../../confirm';
import { createSaveTransfer, type SaveTransfer } from '../../save-transfer';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber } from '../nav';
import type { PageEnv, Subpage } from './registry';

const RESET_TEXT = 'Spielstand löschen';
const RESET_CONFIRM_TEXT = 'Wirklich alles löschen? Zum Bestätigen erneut klicken';
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
  const footer = el('div', 'save-page-reset');
  const reset = el('button', 'link-button', RESET_TEXT);
  reset.type = 'button';
  reset.id = 'reset';
  reset.dataset.ref = 'reset';
  footer.append(reset);
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
      reset.textContent = RESET_CONFIRM_TEXT;
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
