/**
 * Storage im Speicher für Tests; `blocked` simuliert gesperrten Speicher (privater Modus),
 * `limit` einen vollen Speicher (Zeichen aller Schlüssel und Werte, wie die Quota im Browser),
 * `failNext` einzelne fehlschlagende Schreibvorgänge je Schlüssel.
 */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  blocked = false;
  limit = Infinity;
  /** Schlüssel → so viele der nächsten setItem-Aufrufe scheitern. */
  readonly failNext = new Map<string, number>();
  get length() {
    return this.map.size;
  }
  /** Belegte Zeichen (Schlüssel + Werte). */
  get used(): number {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    if (this.blocked) throw new Error('blocked');
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw new Error('blocked');
    const fails = this.failNext.get(key) ?? 0;
    if (fails > 0) {
      this.failNext.set(key, fails - 1);
      throw new Error('QuotaExceededError');
    }
    const before = this.map.get(key);
    const next = this.used - (before === undefined ? 0 : key.length + before.length) + key.length + value.length;
    if (next > this.limit) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
}
