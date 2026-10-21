/**
 * Spielstand exportieren und importieren als Text-Code (Bereich „Spielstand“ unten in der
 * Seitenleiste, neben „Spielstand löschen“).
 *
 * Reine Darstellung: Den Code erzeugt bzw. prüft und lädt main.ts über core/save.ts
 * (`exportCode` / `importCode`). Überschreiben braucht einen zweiten Klick (kein confirm()).
 * Ein ungültiger Code ändert nichts – die Meldung sagt, warum.
 */
import type { ImportError } from '../core/save';
import { el } from './dom';

export interface SaveTransferCallbacks {
  /** Aktueller Spielstand als Text-Code. */
  getCode(): string;
  /** Prüft einen Code, ohne etwas zu ändern: null = ladbar, sonst die Meldung. */
  validate(code: string): string | null;
  /** Lädt den Code (nach Bestätigung): null = geladen, sonst die Meldung. */
  onImport(code: string): string | null;
}

export interface SaveTransfer {
  readonly element: HTMLElement;
}

/** So lange bleibt „Zum Bestätigen erneut klicken“ scharf. */
const ARM_MS = 5000;

const KEEP = 'Dein Spielstand bleibt unverändert.';

/** Meldungen für ungültige Codes (ImportError aus core/save.ts). */
export const IMPORT_ERROR_TEXTS: Readonly<Record<ImportError, string>> = {
  empty: 'Bitte füge zuerst einen Spielstand-Code ein.',
  'too-large': `Dieser Text ist viel zu lang für einen Spielstand-Code. ${KEEP}`,
  format: `Das ist kein Spielstand-Code von „Vom Samen zum Wald“ (er beginnt mit „VSZW1:“). ${KEEP}`,
  checksum: `Der Code ist unvollständig oder verändert. Kopiere ihn bitte noch einmal ganz. ${KEEP}`,
  invalid: `Der Code enthält keinen lesbaren Spielstand. ${KEEP}`,
};

export function createSaveTransfer(root: HTMLElement, callbacks: SaveTransferCallbacks): SaveTransfer {
  const details = el('details', 'save-transfer');
  details.dataset.ref = 'save-transfer';
  const summary = el('summary', '', 'Spielstand exportieren oder importieren');

  // Exportieren
  const exportBox = el('div', 'save-block');
  const exportTitle = el('h3', 'save-title', 'Exportieren');
  const exportHint = el('p', 'save-hint', 'Sichere deinen Wald als Text-Code – zum Aufheben oder für ein anderes Gerät.');
  const exportButton = el('button', 'save-button', 'Code erzeugen');
  exportButton.type = 'button';
  exportButton.dataset.ref = 'export';
  const exportLabel = el('label', 'save-label');
  exportLabel.append(el('span', '', 'Dein Spielstand-Code'));
  const exportArea = el('textarea', 'save-code');
  exportArea.readOnly = true;
  exportArea.rows = 3;
  exportArea.spellcheck = false;
  exportArea.dataset.ref = 'export-code';
  exportLabel.append(exportArea);
  const copyButton = el('button', 'save-button', 'Kopieren');
  copyButton.type = 'button';
  copyButton.dataset.ref = 'export-copy';
  const exportRow = el('div', 'save-row');
  exportRow.append(exportButton, copyButton);
  exportBox.append(exportTitle, exportHint, exportRow, exportLabel);
  exportLabel.hidden = true;
  copyButton.hidden = true;

  // Importieren
  const importBox = el('div', 'save-block');
  const importTitle = el('h3', 'save-title', 'Importieren');
  const importLabel = el('label', 'save-label');
  importLabel.append(el('span', '', 'Spielstand-Code einfügen'));
  const importArea = el('textarea', 'save-code');
  importArea.rows = 3;
  importArea.spellcheck = false;
  importArea.placeholder = 'VSZW1:…';
  importArea.dataset.ref = 'import-code';
  importLabel.append(importArea);
  const importButton = el('button', 'save-button', 'Importieren');
  importButton.type = 'button';
  importButton.dataset.ref = 'import';
  importBox.append(importTitle, importLabel, importButton);

  const status = el('p', 'save-status');
  status.setAttribute('role', 'status');
  status.dataset.ref = 'save-status';

  details.append(summary, exportBox, importBox, status);
  root.prepend(details);

  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function say(text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    status.textContent = text;
    status.className = `save-status tone-${tone}`;
  }

  function disarm(): void {
    clearTimeout(armTimer);
    armTimer = undefined;
    importButton.textContent = 'Importieren';
    importButton.classList.remove('armed');
  }

  exportButton.addEventListener('click', () => {
    exportArea.value = callbacks.getCode();
    exportLabel.hidden = false;
    copyButton.hidden = false;
    exportButton.textContent = 'Code neu erzeugen';
    say('Code erzeugt – kopiere ihn und bewahre ihn gut auf.');
  });

  function selectCode(): void {
    exportArea.focus();
    exportArea.select();
  }

  copyButton.addEventListener('click', () => {
    const code = exportArea.value;
    const fallback = () => {
      selectCode();
      say('Kopieren ging nicht automatisch – der Code ist markiert, kopiere ihn mit Strg+C bzw. „Kopieren“.');
    };
    if (!navigator.clipboard?.writeText) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(code).then(() => say('Code kopiert.', 'good'), fallback);
  });

  importArea.addEventListener('input', disarm);

  importButton.addEventListener('click', () => {
    const code = importArea.value;
    if (armTimer === undefined) {
      // Erst prüfen: Ein ungültiger Code braucht keine Bestätigung.
      const problem = callbacks.validate(code);
      if (problem) {
        say(problem, 'bad');
        return;
      }
      importButton.textContent = 'Aktuellen Spielstand überschreiben? Zum Bestätigen erneut klicken';
      importButton.classList.add('armed');
      say('Der Code ist gültig. Ein zweiter Klick ersetzt deinen aktuellen Spielstand.');
      armTimer = setTimeout(disarm, ARM_MS);
      return;
    }
    disarm();
    const problem = callbacks.onImport(code);
    if (problem) {
      say(problem, 'bad');
      return;
    }
    importArea.value = '';
    say('Spielstand geladen.', 'good');
  });

  return { element: details };
}
