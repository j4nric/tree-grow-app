/**
 * Schutz vor vollem Datenträger: Ist auf dem Daten-Volume weniger als `minFreeBytes` frei,
 * lehnt der Server Registrierungen und Schreibzugriffe ab (507) – damit andere Apps auf
 * demselben Server nicht leiden und SQLite nicht mitten im Schreiben scheitert.
 *
 * Der freie Platz wird zwischengespeichert und höchstens alle `maxAgeMs` im Hintergrund neu
 * gelesen (fs.statfs), damit keine Anfrage darauf warten muss.
 */
import { statfs } from 'node:fs/promises';

export const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;

export class DiskGuard {
  private free: number | null = null;
  private checkedAt = -Infinity;
  private running: Promise<void> | null = null;

  constructor(
    /** Liefert den freien Platz in Bytes. */
    private readonly measure: () => Promise<number>,
    private readonly minFreeBytes: number = DEFAULT_MIN_FREE_BYTES,
    private readonly maxAgeMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Genug Platz? Unbekannt (noch nicht gemessen, Messfehler) zählt als genug. */
  ok(): boolean {
    if (this.now() - this.checkedAt >= this.maxAgeMs) void this.refresh();
    return this.free === null || !(this.free < this.minFreeBytes);
  }

  /** Jetzt messen (z. B. beim Start). Parallele Aufrufe teilen sich eine Messung. */
  refresh(): Promise<void> {
    this.running ??= (async () => {
      try {
        const free = await this.measure();
        this.free = Number.isFinite(free) ? free : null;
      } catch {
        this.free = null;
      } finally {
        this.checkedAt = this.now();
        this.running = null;
      }
    })();
    return this.running;
  }
}

/** Freier Platz (für Nicht-Root nutzbar) des Dateisystems, auf dem `path` liegt. */
export function freeBytesOf(path: string): () => Promise<number> {
  return async () => {
    const s = await statfs(path);
    return Number(s.bavail) * Number(s.bsize);
  };
}
