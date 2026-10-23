/**
 * Unterseite „Einstellungen“ aus dem Umschlag (docs/ALBUM_UI.md, B.7 und A.12 #129): Bewegung,
 * Zahlenformat, Hinweise länger, Klang und Tageszeit – dieselben Gruppen echter Radio-Knöpfe
 * wie früher im Dialog (Pfeiltasten wählen, Tab springt zur nächsten Gruppe). Jede Wahl gilt
 * sofort und nur für dieses Gerät (localStorage, nicht im Spielstand).
 *
 * DOM einmal gebaut; die Radio-Knöpfe werden beim Öffnen auf den gespeicherten Stand gesetzt.
 */
import { el } from '../../dom';
import { formatNumber, type NumberStyle } from '../../format';
import { LONG_TOAST_MS, TOAST_MS, type DaytimeSetting, type MotionSetting, type Settings, type SoundLevel } from '../../settings';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber } from '../nav';
import type { PageEnv, Subpage } from './registry';
import './settings-page.css';

interface Choice<T extends string> {
  value: T;
  label: string;
}

interface Group {
  readonly element: HTMLFieldSetElement;
  /** Gewählten Knopf auf den gespeicherten Wert setzen. */
  sync(settings: Readonly<Settings>): void;
}

/** Eine Gruppe echter Radio-Knöpfe als Karteikarte mit Handschrift-Überschrift. */
function radioGroup<T extends string>(
  name: string,
  icon: string,
  legend: string,
  choices: readonly Choice<T>[],
  current: (settings: Readonly<Settings>) => T,
  onPick: (value: T) => void,
): Group {
  const fieldset = el('fieldset', 'setting-card');
  fieldset.dataset.setting = name;
  const legendEl = el('legend', 'setting-legend');
  const iconEl = el('span', 'setting-icon', icon);
  iconEl.setAttribute('aria-hidden', 'true');
  legendEl.append(iconEl, el('span', 'setting-legend-text', legend));
  fieldset.append(legendEl);
  const inputs: HTMLInputElement[] = [];
  for (const choice of choices) {
    const label = el('label', 'setting-choice');
    const input = el('input');
    input.type = 'radio';
    input.name = `setting-${name}`;
    input.value = choice.value;
    input.addEventListener('change', () => {
      if (input.checked) onPick(choice.value);
    });
    inputs.push(input);
    label.append(input, el('span', 'setting-choice-text', choice.label));
    fieldset.append(label);
  }
  return {
    element: fieldset,
    sync(settings) {
      const value = current(settings);
      for (const input of inputs) input.checked = input.value === value;
    },
  };
}

export function createSettingsPage(env: PageEnv): Subpage {
  const prefs = env.deps.preferences;
  const page = createPage({
    kind: 'settings',
    title: 'Einstellungen',
    number: pageNumber({ ...initialNav(), cover: true, stack: [{ kind: 'settings' }] }),
    className: 'album-subpage settings-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Umschlag');
  page.element.prepend(bookmark.element);

  const example = 1_234_567;
  const seconds = (ms: number) => `${formatNumber(ms / 1000)} s`;
  const groups: Group[] = [
    radioGroup<MotionSetting>(
      'motion',
      '🍃',
      'Bewegung reduzieren',
      [
        { value: 'auto', label: 'Automatisch (wie im System eingestellt)' },
        { value: 'on', label: 'An – ruhige Szene, keine Animationen' },
        { value: 'off', label: 'Aus – alle Animationen' },
      ],
      (s) => s.motion,
      (motion) => prefs.update({ motion }),
    ),
    radioGroup<NumberStyle>(
      'numbers',
      '🔢',
      'Zahlenformat',
      [
        { value: 'short', label: `Kurz („${formatNumber(example, 'short')}“)` },
        { value: 'long', label: `Ausgeschrieben („${formatNumber(example, 'long')}“)` },
      ],
      (s) => s.numbers,
      (numbers) => prefs.update({ numbers }),
    ),
    radioGroup<'no' | 'yes'>(
      'toasts',
      '📌',
      'Hinweise länger anzeigen',
      [
        { value: 'no', label: `Nein (${seconds(TOAST_MS)})` },
        { value: 'yes', label: `Ja (${seconds(LONG_TOAST_MS)})` },
      ],
      (s) => (s.longToasts ? 'yes' : 'no'),
      (value) => prefs.update({ longToasts: value === 'yes' }),
    ),
    radioGroup<SoundLevel>(
      'sound',
      '🎵',
      'Klang',
      [
        { value: 'off', label: 'Aus (Standard, kein Ton)' },
        { value: 'quiet', label: 'Leise – Wind, Vögel und sanfte Töne' },
        { value: 'normal', label: 'Normal – etwas lauter' },
      ],
      (s) => s.sound,
      (sound) => prefs.update({ sound }),
    ),
    radioGroup<DaytimeSetting>(
      'daytime',
      '🌙',
      'Tageszeit',
      [
        { value: 'cycle', label: 'Wechsel – Tag, Dämmerung und Nacht' },
        { value: 'day', label: 'Immer Tag' },
      ],
      (s) => s.daytime,
      (daytime) => prefs.update({ daytime }),
    ),
  ];
  const lead = el('p', 'settings-lead', 'Gilt nur für dieses Gerät und diesen Browser – dein Spielstand bleibt unberührt.');
  const list = el('div', 'settings-list');
  list.append(...groups.map((g) => g.element));
  page.body.append(lead, list);
  const sync = () => {
    for (const group of groups) group.sync(prefs.settings);
  };
  sync();

  return { page, bookmark, opened: sync };
}
