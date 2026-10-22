/**
 * Vollbild der Szene (docs/ALBUM_UI.md, C.6 und D.3): Das **vorhandene** Canvas wandert aus
 * dem Polaroid in diese Ebene (DOM-Umhängen, kein Neuanlegen) und wird per FLIP vom
 * Rechteck des Polaroids aufgezogen (`--flip-ms`, `--turn-ease`); bei reduzierter Bewegung
 * sofort. Schließen geht genau umgekehrt.
 *
 * **Größe und Caches:** Während der Animation behält das Canvas seine Layoutgröße (es wird
 * nur per `transform` skaliert). Der ResizeObserver des `CanvasSizer` meldet darum nichts,
 * und der Renderer baut seine Caches erst **nach** der Animation einmal neu. Bis dahin zeigt
 * `object-fit` das alte Bild unverzerrt (im Vollbild eingepasst, im Polaroid beschnitten) –
 * genau so, wie die Animation endet, also ohne Sprung.
 *
 * Bedienung: „✕ Zurück ins Album“ oben rechts, Kamera-Leiste (main.ts hängt sie in
 * `tools`) unten rechts, Bildunterschrift als Polaroid-Rand unten links; ein Wisch nach unten
 * (über 80 px, nur bei 1×, ein Finger) schließt ebenfalls. Die übrige Seite ist solange
 * `inert`, das Dokument scrollt nicht.
 */
import { el, setText } from '../dom';
import './fullscreen.css';

export interface FullscreenOptions {
  canvas: HTMLCanvasElement;
  /** Platz des Canvas im Polaroid (dorthin kehrt es zurück). */
  home: HTMLElement;
  /** Stempelschicht des Polaroids: liegt im Vollbild über der Szene. */
  stamps: HTMLElement;
  /** Wird solange unbedienbar (`inert`). */
  background: HTMLElement;
  reducedMotion(): boolean;
  /** „Zurück ins Album“ (über den Verlauf, damit Stapel und Verlauf gleich bleiben). */
  onClose(): void;
}

export interface Fullscreen {
  readonly element: HTMLElement;
  /** Platz für die Kamera-Leiste (unten rechts). */
  readonly tools: HTMLElement;
  /**
   * Aufgezogen (vom Ende des Aufziehens bis zum Ende des Zuziehens): Kamera und Tier-Tipp.
   * Beim Zuziehen ist die Ebene ohnehin nicht bedienbar (`fullscreen-moving`).
   */
  readonly open: boolean;
  /** Liegt das Canvas gerade im Vollbild (auch während des Auf- und Zuziehens)? */
  readonly shown: boolean;
  /** Öffnen bzw. schließen; erledigt, wenn die Animation durch ist. */
  setOpen(open: boolean): Promise<void>;
  /** Bildunterschrift: Stufe und Jahreszeit. */
  setCaption(stage: string, season: string): void;
}

type Phase = 'closed' | 'opening' | 'open' | 'closing';

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function ms(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.endsWith('ms') ? n : value.endsWith('s') ? n * 1000 : n;
}

/** Ab wann eine Animation als erledigt gilt, auch wenn `finished` ausbleibt (Hintergrund-Tab). */
const SAFETY_MS = 200;
/** Wisch nach unten zum Schließen: so weit (px) und deutlich senkrecht. */
export const SWIPE_CLOSE_PX = 80;

/** Ist die Bewegung (dx, dy) ein Wisch nach unten zum Schließen? */
export function isSwipeClose(dx: number, dy: number): boolean {
  return dy > SWIPE_CLOSE_PX && Math.abs(dx) * 2 < dy;
}

/**
 * Transform und Ausschnitt für den FLIP: Die Bühne (volle Fläche `W × H`) wird gleichmäßig
 * um `scale` verkleinert, ihre Mitte liegt auf der Mitte von `target`, und sie wird auf ein
 * mittiges Rechteck `clipW × clipH` (Bühnen-Koordinaten) beschnitten.
 */
export function flipFrame(
  stage: { left: number; top: number; width: number; height: number },
  target: { left: number; top: number; width: number; height: number },
  scale: number,
  clipW: number,
  clipH: number,
): { transform: string; clipPath: string } {
  const dx = target.left + target.width / 2 - (stage.left + stage.width / 2);
  const dy = target.top + target.height / 2 - (stage.top + stage.height / 2);
  const ix = Math.max(0, (stage.width - clipW) / 2);
  const iy = Math.max(0, (stage.height - clipH) / 2);
  return {
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(5)})`,
    clipPath: `inset(${iy.toFixed(2)}px ${ix.toFixed(2)}px)`,
  };
}

export function createFullscreen(options: FullscreenOptions): Fullscreen {
  const { canvas, home, stamps } = options;
  const stampsHome = stamps.parentElement;

  const layer = el('section', 'fullscreen');
  layer.dataset.ref = 'fullscreen';
  layer.setAttribute('aria-label', 'Szene im Vollbild');
  layer.hidden = true;
  const backdrop = el('div', 'fullscreen-backdrop');
  const stage = el('div', 'fullscreen-stage');
  const chrome = el('div', 'fullscreen-chrome');
  const close = el('button', 'fullscreen-close');
  close.type = 'button';
  close.dataset.ref = 'fullscreen-close';
  const closeIcon = el('span', 'fullscreen-close-icon', '✕');
  closeIcon.setAttribute('aria-hidden', 'true');
  close.append(closeIcon, el('span', '', 'Zurück ins Album'));
  close.addEventListener('click', () => options.onClose());
  const caption = el('p', 'fullscreen-caption');
  const captionStage = el('span', 'fullscreen-caption-stage');
  const captionSeason = el('span', 'fullscreen-caption-season');
  caption.append(captionStage, captionSeason);
  const tools = el('div', 'fullscreen-tools');
  chrome.append(close, caption, tools);
  layer.append(backdrop, stage, chrome);
  document.body.append(layer);

  // Im Polaroid ist das Canvas nur Bild im Knopf „Szene vergrößern“.
  canvas.setAttribute('aria-hidden', 'true');

  // Wisch nach unten (ein Finger, Kamera bei 1×) schließt. Die Kamera nimmt die Zeiger per
  // Capture – hier nur mithören (Capture-Phase, passiv).
  let swipe: { id: number; x: number; y: number; multi: boolean } | null = null;
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, multi: false };
      else if (swipe) swipe.multi = true;
    },
    { capture: true, passive: true },
  );
  const swipeEnd = (e: PointerEvent) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const start = swipe;
    swipe = null;
    if (e.type !== 'pointerup' || start.multi || phase !== 'open' || canvas.dataset.zoomed === 'true') return;
    if (isSwipeClose(e.clientX - start.x, e.clientY - start.y)) options.onClose();
  };
  stage.addEventListener('pointerup', swipeEnd, { capture: true, passive: true });
  stage.addEventListener('pointercancel', swipeEnd, { capture: true, passive: true });

  let phase: Phase = 'closed';
  let running: Animation[] = [];
  let chain: Promise<void> = Promise.resolve();

  async function play(animations: Animation[], duration: number): Promise<void> {
    running = animations;
    await Promise.race([
      Promise.all(animations.map((a) => a.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, duration + SAFETY_MS)),
    ]);
    running = [];
  }

  function rectOf(node: HTMLElement): DOMRect {
    return node.getBoundingClientRect();
  }

  function lockCanvas(width: number, height: number, stageW: number, stageH: number, scale: number): void {
    const s = canvas.style;
    s.position = 'absolute';
    s.width = `${width}px`;
    s.height = `${height}px`;
    s.left = `${(stageW - width) / 2}px`;
    s.top = `${(stageH - height) / 2}px`;
    s.transform = `scale(${scale})`;
  }

  function unlockCanvas(): void {
    const s = canvas.style;
    s.position = '';
    s.width = '';
    s.height = '';
    s.left = '';
    s.top = '';
    s.transform = '';
  }

  async function show(): Promise<void> {
    if (phase === 'open') return;
    const from = rectOf(home);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    phase = 'opening';
    layer.hidden = false;
    layer.classList.add('fullscreen-moving');
    document.documentElement.classList.add('album-fullscreen-open');
    options.background.inert = true;
    stage.append(canvas);
    layer.append(stamps);
    canvas.removeAttribute('aria-hidden');
    const box = rectOf(stage);
    const duration = ms(token('--flip-ms', '300ms'), 300);
    const animate = !options.reducedMotion() && w > 0 && h > 0 && box.width > 0 && box.height > 0 && typeof stage.animate === 'function';
    if (animate) {
      // Canvas bleibt so groß wie im Polaroid (kein Resize während der Animation) und wird
      // eingepasst in die Bühne skaliert; die Bühne startet genau auf dem Polaroid.
      const fit = Math.min(box.width / w, box.height / h);
      lockCanvas(w, h, box.width, box.height, fit);
      const start = flipFrame(box, from, 1 / fit, w * fit, h * fit);
      const easing = token('--turn-ease', 'cubic-bezier(.3,.7,.3,1)');
      stage.style.willChange = 'transform';
      await play(
        [
          stage.animate([start, { transform: 'none', clipPath: 'inset(0px 0px)' }], { duration, easing }),
          backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' }),
          chrome.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in' }),
        ],
        duration,
      );
      stage.style.willChange = '';
      // Ab jetzt die echte Größe: der CanvasSizer meldet sie, der Renderer baut einmal neu.
      unlockCanvas();
    }
    layer.classList.remove('fullscreen-moving');
    phase = 'open';
    canvas.focus({ preventScroll: true });
  }

  async function hide(): Promise<void> {
    if (phase === 'closed') return;
    phase = 'closing';
    layer.classList.add('fullscreen-moving');
    const hadFocus = layer.contains(document.activeElement) || document.activeElement === document.body;
    // Das Album ist noch `inert`, aber im Layout: dort liegt das Ziel.
    const to = rectOf(home);
    const box = rectOf(stage);
    const duration = ms(token('--flip-ms', '300ms'), 300);
    const animate = !options.reducedMotion() && to.width > 0 && to.height > 0 && box.width > 0 && typeof stage.animate === 'function';
    if (animate) {
      // Zurück ins Polaroid: die Szene beschnitten (wie `object-fit: cover` dort).
      const cover = Math.max(to.width / box.width, to.height / box.height);
      const end = flipFrame(box, to, cover, to.width / cover, to.height / cover);
      const easing = token('--turn-ease', 'cubic-bezier(.3,.7,.3,1)');
      stage.style.willChange = 'transform';
      const animations = [
        stage.animate([{ transform: 'none', clipPath: 'inset(0px 0px)' }, end], { duration, easing, fill: 'forwards' }),
        backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in', fill: 'forwards' }),
        chrome.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration / 2, easing: 'ease-out', fill: 'forwards' }),
      ];
      await play(animations, duration);
      home.append(canvas);
      for (const a of animations) a.cancel();
      stage.style.willChange = '';
    } else {
      home.append(canvas);
    }
    stampsHome?.append(stamps);
    canvas.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    layer.classList.remove('fullscreen-moving');
    document.documentElement.classList.remove('album-fullscreen-open');
    options.background.inert = false;
    phase = 'closed';
    if (hadFocus) home.focus({ preventScroll: true });
  }

  return {
    element: layer,
    tools,
    get open() {
      return phase === 'open' || phase === 'closing';
    },
    get shown() {
      return phase !== 'closed';
    },
    setOpen(open) {
      // Läuft gerade eine Animation, springt sie ans Ende; dann der Reihe nach.
      for (const a of running) a.finish();
      chain = chain.then(() => (open ? show() : hide()));
      return chain;
    },
    setCaption(stageName, season) {
      setText(captionStage, stageName);
      setText(captionSeason, season);
    },
  };
}
