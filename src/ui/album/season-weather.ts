/**
 * Jahreszeit und Wetter in der Bildunterschrift des Polaroids (docs/ALBUM_UI.md, A.2 #29/#30):
 * zwei Knöpfe, jeder öffnet eine Haftnotiz – Jahreszeit mit Stimmung und Wirkungen, Wetter
 * mit Stimmung, Wirkung heute, Dämpfung, Tipp, Vorhersage, Tag/Nacht und „Immer Tag“.
 * Ersetzt season-badge.ts und weather-badge.ts; `data-ref` der Knöpfe und Zeilen bleiben.
 * `update()` darf jeden Frame laufen – das DOM ändert sich nur bei neuen Texten.
 */
import { el, setAttr, setText } from '../dom';
import type { SeasonBadgeView } from '../season-view';
import type { WeatherBadgeView } from '../weather-view';
import { attachNote, createNote } from './note';

export interface SeasonWeather {
  readonly season: HTMLButtonElement;
  readonly weather: HTMLButtonElement;
  update(season: SeasonBadgeView, weather: WeatherBadgeView): void;
}

export function createSeasonWeather(root: HTMLElement): SeasonWeather {
  const season = el('button', 'season-badge note-trigger');
  season.type = 'button';
  season.dataset.ref = 'season';
  const weather = el('button', 'weather-badge note-trigger');
  weather.type = 'button';
  weather.dataset.ref = 'weather';
  root.append(season, weather);

  const seasonNote = createNote({ id: 'season', title: 'Jahreszeit', ref: 'season-note' });
  const seasonMood = seasonNote.line();
  const seasonEffects = seasonNote.line('note-emphasis', 'season-effects');
  const seasonLeft = seasonNote.line('note-soft');
  attachNote(season, seasonNote);

  const weatherNote = createNote({ id: 'weather', title: 'Wetter heute', ref: 'weather-details' });
  const mood = weatherNote.line('', 'weather-mood');
  const effects = weatherNote.line('note-emphasis', 'weather-effects');
  const damping = weatherNote.line('', 'weather-damping');
  const tip = weatherNote.line('note-soft', 'weather-tip');
  const forecast = weatherNote.line('', 'weather-forecast');
  const daytime = weatherNote.line('', 'weather-daytime');
  const note = weatherNote.line('note-soft', 'weather-daytime-note');
  attachNote(weather, weatherNote);

  const setLine = (p: HTMLElement, text: string | null) => {
    setText(p, text ?? '');
    if (p.hidden !== !text) p.hidden = !text;
  };

  function update(s: SeasonBadgeView, w: WeatherBadgeView): void {
    setText(season, s.text);
    setAttr(season, 'title', s.title);
    setAttr(season, 'data-season', s.id);
    seasonNote.setTitle(`${s.icon} ${s.name}`);
    setText(seasonMood, s.mood);
    setText(seasonEffects, s.title);
    // „🌱 Frühling · noch 2:58 min“ → „noch 2:58 min“
    setLine(seasonLeft, s.text.split(' · ').slice(1).join(' · '));

    setText(weather, w.text);
    setAttr(weather, 'aria-label', w.label);
    setAttr(weather, 'title', w.title);
    setAttr(weather, 'data-weather', w.id);
    weather.classList.toggle('rough', w.rough);
    setLine(mood, w.mood);
    setLine(effects, w.effects);
    setLine(damping, w.damping);
    setLine(tip, w.tip);
    setLine(forecast, w.forecast);
    setLine(daytime, w.daytime);
    setLine(note, w.daytimeNote);
    if (weatherNote.isOpen) weatherNote.position();
  }

  return { season, weather, update };
}
