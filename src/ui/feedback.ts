/**
 * Kleine visuelle Rückmeldungen („Juice“): schwebende Zahlen und kurze CSS-Animationen.
 * Reine Darstellung – liest und verändert keinen Spielstand.
 */

/** Höchstens so viele schwebende Zahlen gleichzeitig; die ältesten werden ersetzt. */
const MAX_FLOATS = 16;
/** Sicherheitsnetz, falls `animationend` nicht feuert (z. B. Tab im Hintergrund). */
const FLOAT_FALLBACK_MS = 2000;

const reducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function prefersReducedMotion(): boolean {
  return reducedMotion?.matches ?? false;
}

/**
 * Startet eine CSS-Animation (über eine Klasse) neu, auch wenn sie gerade läuft.
 * Die Klasse wird nach Ende wieder entfernt.
 */
const cleanups = new WeakMap<HTMLElement, Map<string, () => void>>();

export function restartAnimation(el: HTMLElement, className: string): void {
  // Vorherigen Aufräum-Listener für diese Klasse entfernen, sonst sammeln sie sich
  // beim Dauerklicken an (ein Neustart löst kein animationend aus).
  let byClass = cleanups.get(el);
  if (!byClass) cleanups.set(el, (byClass = new Map()));
  byClass.get(className)?.();

  el.classList.remove(className);
  void el.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
  el.classList.add(className);
  const done = (event: AnimationEvent) => {
    if (event.target !== el || !el.classList.contains(className)) return;
    el.classList.remove(className);
    detach();
  };
  const detach = () => {
    el.removeEventListener('animationend', done);
    byClass.delete(className);
  };
  el.addEventListener('animationend', done);
  byClass.set(className, detach);
}

/** Ebene für schwebende Zahlen (über der ganzen Seite, nicht klickbar). Koordinaten wie clientX/Y. */
export function createFloatLayer(parent: HTMLElement) {
  const layer = document.createElement('div');
  layer.className = 'float-layer';
  layer.setAttribute('aria-hidden', 'true');
  parent.append(layer);

  function spawn(text: string, x: number, y: number): void {
    while (layer.childElementCount >= MAX_FLOATS) layer.firstElementChild!.remove();

    const el = document.createElement('span');
    el.className = 'float-number';
    el.textContent = text;
    // Leichte seitliche Drift, damit schnelle Klicks nicht exakt übereinanderliegen
    const drift = prefersReducedMotion() ? 0 : Math.round((Math.random() - 0.5) * 24);
    // Innerhalb des Fensters halten, damit bei 360 px nichts überläuft
    const clampedX = Math.min(Math.max(x, 40), window.innerWidth - 40);
    el.style.left = `${clampedX + window.scrollX}px`;
    el.style.top = `${y + window.scrollY}px`;
    el.style.setProperty('--drift', `${drift}px`);
    layer.append(el);

    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, FLOAT_FALLBACK_MS);
  }

  return { spawn };
}
