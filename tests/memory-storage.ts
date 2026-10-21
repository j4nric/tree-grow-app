/** Storage im Speicher für Tests; `blocked` simuliert gesperrten Speicher (privater Modus). */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  blocked = false;
  get length() {
    return this.map.size;
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
    this.map.set(key, value);
  }
}
