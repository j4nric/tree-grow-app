/** Kleine DOM-Helfer für die Komponenten (ohne innerHTML). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Setzt Text nur bei Änderung – spart Layout-Arbeit im Frame-Update. */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Setzt ein Attribut nur bei Änderung. */
export function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Setzt eine CSS-Variable nur bei Änderung. */
export function setVar(node: HTMLElement, name: string, value: string): void {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

/** Text nur für Screenreader. */
export function srOnly(text = ''): HTMLSpanElement {
  return el('span', 'sr-only', text);
}
