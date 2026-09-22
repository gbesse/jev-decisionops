import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditRecord } from "./types.js";

export class AuditLogger {
  private pending = Promise.resolve();
  constructor(private readonly path: string | undefined) {}
  write(record: AuditRecord): Promise<void> {
    if (!this.path) return Promise.resolve();
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path!), { recursive: true });
      await appendFile(this.path!, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    return this.pending;
  }
  flush(): Promise<void> { return this.pending; }
}
