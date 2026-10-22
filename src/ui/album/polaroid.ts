/**
 * Polaroid: weißer Rahmen mit Washi-Tape und Bildunterschrift um die Szene
 * (docs/ALBUM_UI.md, D.3). Schritt 1: nur der Rahmen – das vorhandene Canvas wird
 * hineingehängt (kein Neuanlegen), Kamera und Tier-Tipp bleiben wie bisher.
 *
 * Bildunterschrift links: Stufe (`data-ref="stage"`, vorgelesen „Stufe: Junger Baum“),
 * rechts: Jahreszeit und Wetter (Abzeichen aus season-badge.ts / weather-badge.ts).
 */
import { el, setText, srOnly } from '../dom';
import './polaroid.css';

export interface Polaroid {
  readonly element: HTMLElement;
  /** Bildfläche (Canvas, Stufen-Banner, Kamera-Knöpfe). */
  readonly photo: HTMLElement;
  /** Platz rechts in der Bildunterschrift (Jahreszeit, Wetter). */
  readonly season: HTMLElement;
  setStage(name: string): void;
}

export function createPolaroid(canvas: HTMLCanvasElement): Polaroid {
  const figure = el('figure', 'polaroid');
  figure.dataset.ref = 'polaroid';
  const tape = el('span', 'polaroid-tape');
  tape.setAttribute('aria-hidden', 'true');
  const photo = el('div', 'polaroid-photo scene');
  photo.append(canvas);
  const caption = el('figcaption', 'polaroid-caption');
  const stage = el('p', 'polaroid-stage');
  stage.dataset.ref = 'stage';
  const stageName = el('span', 'polaroid-stage-name');
  stage.append(srOnly('Stufe: '), stageName);
  const season = el('div', 'polaroid-season');
  season.id = 'season';
  caption.append(stage, season);
  figure.append(tape, photo, caption);

  return {
    element: figure,
    photo,
    season,
    setStage: (name) => setText(stageName, name),
  };
}
