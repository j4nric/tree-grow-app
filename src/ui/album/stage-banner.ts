/**
 * Stufen-Stempel über dem Bild (docs/ALBUM_UI.md, C.6): neue Stufe, dazu ein gleichzeitig
 * freigeschalteter Erfolg als dritte Zeile. Liegt in der Stempelschicht des Polaroids und
 * wandert mit ins Vollbild. Aussehen und Ablauf: polaroid.css (`.stage-banner`).
 */
import type { StageBannerView } from '../adapters';
import { el } from '../dom';

export interface StageBanner {
  readonly element: HTMLElement;
  show(view: StageBannerView): void;
}

export function createStageBanner(parent: HTMLElement): StageBanner {
  const banner = el('div', 'stage-banner');
  banner.id = 'stage-banner';
  banner.setAttribute('aria-live', 'polite');
  parent.append(banner);
  banner.addEventListener('animationend', () => banner.classList.remove('visible'));

  return {
    element: banner,
    show(view) {
      const parts: HTMLElement[] = [el('strong', '', view.title), el('span', '', view.text)];
      if (view.extra) parts.push(el('span', 'stage-banner-extra', view.extra));
      banner.replaceChildren(...parts);
      banner.classList.toggle('long', Boolean(view.extra));
      banner.classList.remove('visible');
      void banner.offsetWidth; // Animation neu starten
      banner.classList.add('visible');
    },
  };
}
