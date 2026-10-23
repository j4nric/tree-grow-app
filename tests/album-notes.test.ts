import { describe, expect, it } from 'vitest';
import { NOTE_EDGE, NOTE_GAP, notePosition } from '../src/ui/album/note-layout';
import { growthNoteView, harmonyNoteView, seedsNoteView, type LabelNoteInput } from '../src/ui/album/notes-text';
import { MAX_STAMPS, SLIP_MIN_CHARS, STAMP_GAP, stampDuration, stampKind, stampLift, stampsOnTop, stampsToDrop } from '../src/ui/album/stamp-rules';
import { stampDisplayText } from '../src/ui/album/stamps';

/** Haftnotizen und Stempel des Albums (docs/ALBUM_UI.md, C.4 und C.5). */

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
const phone = { width: 360, height: 740 };
const note = { width: 290, height: 180 };

describe('notePosition', () => {
  it('unter dem Auslöser, rechtsbündig an ihm', () => {
    const spot = notePosition(rect(200, 100, 120, 44), note, { width: 1200, height: 700 });
    expect(spot).toEqual({ left: 320 - 290, top: 144 + NOTE_GAP, above: false });
  });

  it('nie über den linken oder rechten Rand hinaus', () => {
    expect(notePosition(rect(10, 100, 60, 44), note, phone).left).toBe(NOTE_EDGE);
    const right = notePosition(rect(300, 100, 80, 44), note, phone);
    expect(right.left + note.width).toBeLessThanOrEqual(phone.width - NOTE_EDGE);
  });

  it('unten kein Platz: über dem Auslöser', () => {
    const spot = notePosition(rect(200, 600, 120, 44), note, phone);
    expect(spot.above).toBe(true);
    expect(spot.top + note.height).toBe(600 - NOTE_GAP);
  });

  it('weder oben noch unten ganz Platz: bleibt im Bild', () => {
    const tall = { width: 290, height: 600 };
    const spot = notePosition(rect(100, 300, 120, 44), tall, phone);
    expect(spot.above).toBe(false);
    expect(spot.top).toBeGreaterThanOrEqual(NOTE_EDGE);
    expect(spot.top + tall.height).toBeLessThanOrEqual(phone.height - NOTE_EDGE);
  });

  it('schmaler als die Notiz: am linken Rand', () => {
    expect(notePosition(rect(0, 0, 40, 40), { width: 400, height: 100 }, phone).left).toBe(NOTE_EDGE);
  });
});

describe('Stempel oder Zettel', () => {
  it('bis 90 Zeichen Stempel, darüber Zettel', () => {
    expect(stampKind('x'.repeat(SLIP_MIN_CHARS))).toBe('stamp');
    expect(stampKind('x'.repeat(SLIP_MIN_CHARS + 1))).toBe('slip');
    // Zeichen, nicht UTF-16-Einheiten: Emoji zählen einfach.
    expect(stampKind('🌰'.repeat(SLIP_MIN_CHARS))).toBe('stamp');
    // Vollständige Chronik (Playtest Phase 9, F4): immer ein Zettel mit Andenken.
    expect(stampKind('kurz', { keepsake: '🪵' })).toBe('slip');
  });

  it('bleibende Meldungen sind immer Zettel – auch kurze', () => {
    expect(stampKind('Kurz.', { keep: true })).toBe('slip');
    expect(stampKind('Kurz.', { error: true })).toBe('stamp');
  });

  it('Standzeit: Stempel wie der Toast, Zettel doppelt, bleibende ohne Ablauf', () => {
    expect(stampDuration('stamp', 6000)).toBe(6000);
    expect(stampDuration('slip', 6000)).toBe(12_000);
    expect(stampDuration('slip', 6000, { keep: true })).toBeNull();
  });

  it(`höchstens ${MAX_STAMPS} zugleich – die älteste weicht, bleibende zuletzt`, () => {
    expect(stampsToDrop([])).toEqual([]);
    expect(stampsToDrop([{ serial: 1, keep: false }])).toEqual([]);
    expect(stampsToDrop([{ serial: 1, keep: false }, { serial: 2, keep: false }])).toEqual([1]);
    expect(stampsToDrop([{ serial: 1, keep: true }, { serial: 2, keep: false }])).toEqual([2]);
    expect(stampsToDrop([{ serial: 3, keep: true }, { serial: 1, keep: true }])).toEqual([1]);
  });
});

/** Wie DOMRect: Felder nur als Getter am Prototyp (Spread ergäbe {}). */
class Box {
  constructor(
    private x: number,
    private y: number,
    private w: number,
    private h: number,
  ) {}
  get left() {
    return this.x;
  }
  get right() {
    return this.x + this.w;
  }
  get top() {
    return this.y;
  }
  get bottom() {
    return this.y + this.h;
  }
}

describe('Lage der Meldungen (Playtest Schritt 14: M2, S2)', () => {
  // 390 × 844: Stempel unten (y 754–838), „Schließen“ im Umschlag (y 778–822).
  const layer = new Box(11, 754, 368, 84);

  it('rückt über „Schließen“ bzw. die scharfe Bestätigung – mit Abstand', () => {
    const close = new Box(20, 778, 145, 44);
    const lift = stampLift(layer, [close], 120);
    expect(lift).toBe(838 - (778 - STAMP_GAP));
    expect(layer.bottom - lift).toBeLessThanOrEqual(close.top - STAMP_GAP);
  });

  it('nichts zu tun, wenn nichts darunter liegt (auch nicht seitlich daneben)', () => {
    expect(stampLift(layer, [], 120)).toBe(0);
    expect(stampLift(layer, [new Box(11, 300, 300, 44)], 120)).toBe(0);
    expect(stampLift(new Box(642, 585, 418, 86), [new Box(98, 606, 145, 44)], 96)).toBe(0);
  });

  it('über mehrere Knöpfe übereinander hinweg, aber nie über die Navigation oben', () => {
    const lift = stampLift(layer, [new Box(20, 790, 300, 44), new Box(20, 700, 300, 44)], 120);
    expect(layer.bottom - lift).toBeLessThanOrEqual(700 - STAMP_GAP);
    expect(stampLift(layer, [new Box(20, 150, 300, 44), new Box(20, 200, 300, 600)], 120)).toBe(754 - 120);
  });

  it('oben bleibt oben, bis die Knöpfe unter dem Bild heranrücken – zurück erst bei der nächsten Meldung', () => {
    // Neue Meldung: oben, wenn über der Bildunterschrift Platz ist.
    expect(stampsOnTop(true, false, 310, 114)).toBe(true);
    expect(stampsOnTop(true, false, 100, 114)).toBe(false);
    // Sichtbar und oben: bleibt beim Scrollen (kein Sprung bei 48 px) …
    expect(stampsOnTop(false, true, 262, 114)).toBe(true);
    // … bis die Bildunterschrift den Stempel erreicht.
    expect(stampsOnTop(false, true, 118, 114)).toBe(false);
    // Unten bleibt unten, solange die Meldung zu sehen ist (auch ganz oben).
    expect(stampsOnTop(false, false, 310, 114)).toBe(false);
  });

  it('Zahl und Symbol brechen nicht auseinander („+24 🌰“)', () => {
    expect(stampDisplayText('✅ Tagesziel: 2 Begegnungen entschieden · +10.255 🌰')).toBe('✅ Tagesziel: 2 Begegnungen entschieden · +10.255\u00a0🌰');
    expect(stampDisplayText('Willkommen zurück! 3 Std.')).toBe('Willkommen zurück! 3 Std.');
  });
});

describe('Notizen der Etiketten', () => {
  const input: LabelNoteInput = {
    growthPerSec: 48.3,
    seedsPerSec: 3.2,
    harmony: 62,
    harmonyTier: 'ausgewogen',
    harmonyMultiplier: 1.32,
    night: { growth: ['Waldkauz'], seeds: [] },
  };

  it('Harmonie: Text wie im Prototyp, Kernzahl und Stufe', () => {
    const view = harmonyNoteView(input);
    expect(view.title).toBe('Harmonie · ausgewogen');
    expect(view.text).toMatch(/^Wie gut dein Wald zusammenpasst/);
    expect(view.emphasis).toBe('jetzt: Wachstum ×1,32');
  });

  it('Nachtwirkung nur, solange sie gilt', () => {
    expect(growthNoteView(input).night).toBe('🌙 Nachtbonus: Waldkauz');
    expect(seedsNoteView(input).night).toBe('');
  });

  it('Raten im deutschen Format', () => {
    expect(growthNoteView(input).emphasis).toContain('48,3');
    expect(seedsNoteView(input).emphasis).toContain('+3,2');
  });
});
