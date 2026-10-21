import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/formulas';
import { toJournalView } from '../src/ui/adapters';
import { CONFIRM_MIN_MS, REPEAT_GUARD_MS, isDeliberateConfirm, isKeyRepeat } from '../src/ui/confirm';
import { stateAt } from './helpers';

describe('Bestätigung per zweitem Klick', () => {
  it('zählt nur bewusst: kein Doppelklick, nicht schneller als CONFIRM_MIN_MS', () => {
    expect(isDeliberateConfirm({ detail: 1 }, 1000, 1000 + CONFIRM_MIN_MS)).toBe(true);
    // Tastatur (Enter/Leertaste) hat detail 0 – zählt, wenn genug Zeit verging.
    expect(isDeliberateConfirm({ detail: 0 }, 1000, 1000 + CONFIRM_MIN_MS + 1)).toBe(true);
    expect(isDeliberateConfirm({ detail: 2 }, 1000, 5000)).toBe(false);
    expect(isDeliberateConfirm({ detail: 1 }, 1000, 1000 + CONFIRM_MIN_MS - 1)).toBe(false);
    expect(isDeliberateConfirm({ detail: 0 }, 1000, 1050)).toBe(false);
  });

  it('Kauf-Sperre: eigener Mindestabstand, erster Kauf (−Infinity) immer frei', () => {
    expect(isDeliberateConfirm({ detail: 1 }, -Infinity, 0, REPEAT_GUARD_MS)).toBe(true);
    expect(isDeliberateConfirm({ detail: 1 }, 1000, 1000 + REPEAT_GUARD_MS, REPEAT_GUARD_MS)).toBe(true);
    expect(isDeliberateConfirm({ detail: 1 }, 1000, 1000 + REPEAT_GUARD_MS - 1, REPEAT_GUARD_MS)).toBe(false);
    expect(isDeliberateConfirm({ detail: 2 }, -Infinity, 0, REPEAT_GUARD_MS)).toBe(false);
    // NaN als Zeit sperrt lieber, als doppelt zu kaufen.
    expect(isDeliberateConfirm({ detail: 1 }, 1000, NaN, REPEAT_GUARD_MS)).toBe(false);
  });

  it('Tastenwiederholung nur bei gehaltenem Enter/Leertaste', () => {
    expect(isKeyRepeat({ key: 'Enter', repeat: true })).toBe(true);
    expect(isKeyRepeat({ key: ' ', repeat: true })).toBe(true);
    expect(isKeyRepeat({ key: 'Enter', repeat: false })).toBe(false);
    expect(isKeyRepeat({ key: 'Tab', repeat: true })).toBe(false);
  });
});

describe('Andenken mit geerbten Namen', () => {
  it('„__proto__“ und „toString“ finden keine geerbten Einträge', () => {
    const state = stateAt(0);
    state.meta.journal.keepsakes = ['__proto__', 'toString', 'old-oak'];
    const view = toJournalView(state, evaluate(state));
    expect(view.keepsakes[0]).toEqual({ key: '__proto__', icon: '🎁', name: 'Andenken', text: '' });
    expect(view.keepsakes[1]).toEqual({ key: 'toString', icon: '🎁', name: 'Andenken', text: '' });
    expect(view.keepsakes[2]!.name).toBe('Die alte Eiche');
  });
});
