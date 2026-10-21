/**
 * Einfaches Rate-Limit im Speicher (festes Zeitfenster je Schlüssel, z. B. IP-Adresse).
 * Reicht für einen einzelnen Server-Prozess; nach einem Neustart beginnt es von vorn.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  private lastPrune = -Infinity;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Zählt einen Versuch. Rückgabe: 0 = erlaubt, sonst Wartezeit in ms bis zum nächsten Fenster. */
  take(key: string, now: number): number {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      // Neu einfügen (nicht nur überschreiben), damit die Map nach Alter sortiert bleibt.
      this.hits.delete(key);
      this.hits.set(key, { start: now, count: 1 });
      this.prune(now);
      return 0;
    }
    entry.count++;
    return entry.count > this.limit ? Math.max(1, entry.start + this.windowMs - now) : 0;
  }

  /** Wie lange `key` noch gesperrt ist (ms, 0 = frei) – ohne einen Versuch zu zählen. */
  blockedFor(key: string, now: number): number {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs || entry.count < this.limit) return 0;
    return Math.max(1, entry.start + this.windowMs - now);
  }

  /** Zähler für `key` vergessen (z. B. nach erfolgreicher Anmeldung). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /**
   * Begrenzt die Map: Ab `maxKeys` Einträgen höchstens einmal je Sekunde Abgelaufenes
   * entfernen; reicht das nicht, fällt der älteste Eintrag weg (kein Scan je Anfrage).
   */
  private prune(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    if (now - this.lastPrune >= 1000 || now < this.lastPrune) {
      this.lastPrune = now;
      for (const [key, entry] of this.hits) if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}
