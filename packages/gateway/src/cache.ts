export class TtlLruCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.values.delete(key); return undefined; }
    this.values.delete(key);
    this.values.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, { value: structuredClone(value), expiresAt: Date.now() + this.ttlMs });
    while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value as string);
  }

  get size(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
}
