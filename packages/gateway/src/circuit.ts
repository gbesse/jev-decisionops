export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold: number, private readonly cooldownMs: number) {}
  canAttempt(now = Date.now()): boolean {
    if (!this.openedAt) return true;
    if (now - this.openedAt >= this.cooldownMs) { this.openedAt = 0; this.failures = Math.max(0, this.threshold - 1); return true; }
    return false;
  }
  success(): void { this.failures = 0; this.openedAt = 0; }
  failure(now = Date.now()): void { this.failures++; if (this.failures >= this.threshold) this.openedAt = now; }
  get state(): "closed" | "open" { return this.openedAt ? "open" : "closed"; }
}
