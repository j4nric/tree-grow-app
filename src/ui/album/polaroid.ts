/**
 * Polaroid: weißer Rahmen mit Washi-Tape und Bildunterschrift um die Szene
 * (docs/ALBUM_UI.md, C.6 und D.3). Das vorhandene Canvas wird hineingehängt (kein
 * Neuanlegen); die Bildfläche ist ein Knopf „Szene vergrößern“ und öffnet das Vollbild.
 * Im Polaroid gibt es keine Kamera und keinen Tier-Tipp (G-15).
 *
 * **Schärfe:** Nur das Papier (Rahmen, Schatten) und das Tape sind gedreht
 * (`--tilt-photo`), Bild und Bildunterschrift stehen gerade. Ein gedrehtes Live-Canvas
 * tastet der Browser in jedem Frame neu ab – bei Pixeldichte 1 verlor das Bild dabei rund
 * ein Drittel seiner Kantenschärfe (gemessen, siehe PR). Gerade bleibt es pixelgenau.
 *
 * Bildunterschrift links: Stufe (`data-ref="stage"`, vorgelesen „Stufe: Junger Baum“),
 * rechts: Jahreszeit und Wetter (Abzeichen aus season-badge.ts / weather-badge.ts).
 * Über dem Bild liegt die Stempelschicht (Stufen-Stempel); sie wandert mit ins Vollbild.
 */
import { el, setText, srOnly } from '../dom';
import './polaroid.css';

export interface Polaroid {
  readonly element: HTMLElement;
  /** Bildfläche (Knopf mit dem Canvas, Stempelschicht). */
  readonly photo: HTMLElement;
  /** Knopf „Szene vergrößern“ – hier wohnt das Canvas, solange kein Vollbild offen ist. */
  readonly button: HTMLButtonElement;
  /** Stempelschicht über dem Bild (Stufen-Stempel). */
  readonly stamps: HTMLElement;
  /** Platz rechts in der Bildunterschrift (Jahreszeit, Wetter). */
  readonly season: HTMLElement;
  setStage(name: string): void;
}

export function createPolaroid(canvas: HTMLCanvasElement, onOpen: () => void): Polaroid {
  const figure = el('figure', 'polaroid');
  figure.dataset.ref = 'polaroid';
  const paper = el('span', 'polaroid-paper');
  paper.setAttribute('aria-hidden', 'true');
  const tape = el('span', 'polaroid-tape');
  tape.setAttribute('aria-hidden', 'true');
  const photo = el('div', 'polaroid-photo scene');
  const button = el('button', 'polaroid-open');
  button.type = 'button';
  button.dataset.ref = 'polaroid-open';
  button.setAttribute('aria-label', 'Szene vergrößern');
  button.addEventListener('click', onOpen);
  button.append(canvas);
  const stamps = el('div', 'scene-stamps');
  photo.append(button, stamps);
  const caption = el('figcaption', 'polaroid-caption');
  const stage = el('p', 'polaroid-stage');
  stage.dataset.ref = 'stage';
  const stageName = el('span', 'polaroid-stage-name');
  stage.append(srOnly('Stufe: '), stageName);
  const season = el('div', 'polaroid-season');
  season.id = 'season';
  caption.append(stage, season);
  figure.append(paper, tape, photo, caption);

  return {
    element: figure,
    photo,
    button,
    stamps,
    season,
    setStage: (name) => setText(stageName, name),
  };
}
