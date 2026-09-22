export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}
  consume(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + this.windowMs }; this.buckets.set(key, bucket); }
    bucket.count++;
    if (this.buckets.size > 10_000) for (const [id, entry] of this.buckets) if (entry.resetAt <= now) this.buckets.delete(id);
    return { allowed: bucket.count <= this.limit, remaining: Math.max(0, this.limit - bucket.count), resetAt: bucket.resetAt };
  }
}

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly maximum: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
  get current(): number { return this.active; }
}
