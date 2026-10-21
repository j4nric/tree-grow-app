/**
 * Einfaches Rate-Limit im Speicher (festes Zeitfenster je Schlüssel, z. B. IP-Adresse).
 * Reicht für einen einzelnen Server-Prozess; nach einem Neustart beginnt es von vorn.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Zählt einen Versuch. Rückgabe: 0 = erlaubt, sonst Wartezeit in ms bis zum nächsten Fenster. */
  take(key: string, now: number): number {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      this.prune(now);
      return 0;
    }
    entry.count++;
    return entry.count > this.limit ? Math.max(1, entry.start + this.windowMs - now) : 0;
  }

  /** Abgelaufene Einträge entfernen, damit die Map nicht unbegrenzt wächst. */
  private prune(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (now - entry.start >= this.windowMs) this.hits.delete(key);
  }
}
