import { describe, expect, it } from 'vitest';
import { IdleQueue, type IdlePost } from '../src/render/idle';
import { createIdleScheduler } from '../src/ui/album/sticker';

/**
 * Leerlauf-Zeichnen der Sticker (album/sticker.ts, `scheduleIdle`): ein Rückruf zeichnet
 * weitere wartende Sticker, bis das Zeitbudget verbraucht ist; eine werfende Aufgabe beendet
 * nur ihren Rückruf – danach arbeitet der nächste wieder mit vollem Budget.
 */

/** Warteschlange mit manuell ausgelösten Leerlauf-Rückrufen. */
function setup(budgetMs: number) {
  const pending: (() => void)[] = [];
  const post: IdlePost = (run) => void pending.push(run);
  const queue = new IdleQueue(post);
  let clock = 0;
  const schedule = createIdleScheduler(queue, budgetMs, () => clock);
  const runIdle = (): void => {
    const run = pending.shift();
    if (!run) throw new Error('kein Leerlauf-Rückruf geplant');
    run();
  };
  return { queue, schedule, runIdle, pending, tick: (ms: number) => (clock += ms) };
}

describe('Sticker: Leerlauf mit Zeitbudget', () => {
  it('ein Rückruf zeichnet weitere Sticker, solange das Budget reicht', () => {
    const { queue, schedule, runIdle, tick } = setup(4);
    const done: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      schedule(id, () => {
        done.push(id);
        tick(1.5); // jeder Sticker kostet 1,5 ms
      });
    }
    runIdle();
    // a (Rückruf selbst), dann weitere, solange beim Start noch Budget übrig ist (4 ms ab dem
    // Ende von a: b, c und d beginnen bei 0, 1,5 und 3 ms); e wartet auf den nächsten Rückruf.
    expect(done).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.size).toBe(1);
    runIdle();
    expect(done).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(queue.size).toBe(0);
  });

  it('ohne Budget genau ein Sticker je Rückruf', () => {
    const { queue, schedule, runIdle } = setup(0);
    const done: string[] = [];
    for (const id of ['a', 'b', 'c']) schedule(id, () => done.push(id));
    runIdle();
    expect(done).toEqual(['a']);
    expect(queue.size).toBe(2);
  });

  it('wirft eine Aufgabe, gilt das Budget im nächsten Rückruf trotzdem (draining zurückgesetzt)', () => {
    const { queue, schedule, runIdle, tick } = setup(10);
    const done: string[] = [];
    schedule('a', () => done.push('a'));
    schedule('boom', () => {
      throw new Error('kaputt');
    });
    schedule('b', () => done.push('b'));
    schedule('c', () => done.push('c'));
    // „a“ läuft, beim Weiterarbeiten wirft „boom“ – der Rückruf endet mit dem Fehler.
    expect(() => runIdle()).toThrow('kaputt');
    expect(done).toEqual(['a']);
    expect(queue.size).toBe(2);
    // Nächster Rückruf: „b“ und – mit Budget – auch „c“; ohne Zurücksetzen bliebe „c“ liegen.
    tick(1);
    runIdle();
    expect(done).toEqual(['a', 'b', 'c']);
    expect(queue.size).toBe(0);
  });
});
