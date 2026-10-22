import { describe, expect, it } from 'vitest';
import { TOAST_GAP, toastTopFor } from '../src/ui/toast-place';

/** Toast im einspaltigen Layout: unter allem, was oben zu sehen ist (Playtest Phase 6). */
describe('toastTopFor', () => {
  it('ohne Hindernis: 0 (Rand aus dem CSS)', () => {
    expect(toastTopFor([], 400)).toBe(0);
  });

  it('unter dem tiefsten Hindernis oben, mit Abstand', () => {
    const hint = { top: 12, bottom: 64 };
    const banner = { top: 72, bottom: 150.4 };
    expect(toastTopFor([hint], 400)).toBe(64 + TOAST_GAP);
    expect(toastTopFor([hint, banner], 400)).toBe(Math.ceil(150.4 + TOAST_GAP));
    expect(toastTopFor([banner, hint], 400)).toBe(Math.ceil(150.4 + TOAST_GAP));
  });

  it('aus dem Bild gescrollt, tief unten oder leer: zählt nicht', () => {
    expect(toastTopFor([{ top: -300, bottom: -250 }], 400)).toBe(0);
    expect(toastTopFor([{ top: 700, bottom: 760 }], 400)).toBe(0);
    expect(toastTopFor([{ top: 0, bottom: 0 }], 400)).toBe(0);
  });
});
