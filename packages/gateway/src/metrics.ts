export class GatewayMetrics {
  requests = 0;
  successes = 0;
  errors = 0;
  rejected = 0;
  cacheHits = 0;
  upstreamCalls = 0;
  fallbackCalls = 0;
  latencyMsTotal = 0;

  render(): string {
    const rows: Array<[string, number]> = [
      ["jev_gateway_requests_total", this.requests], ["jev_gateway_successes_total", this.successes],
      ["jev_gateway_errors_total", this.errors], ["jev_gateway_rejected_total", this.rejected],
      ["jev_gateway_cache_hits_total", this.cacheHits], ["jev_gateway_upstream_calls_total", this.upstreamCalls],
      ["jev_gateway_fallback_calls_total", this.fallbackCalls], ["jev_gateway_latency_ms_total", this.latencyMsTotal],
    ];
    return `${rows.map(([key, value]) => `# TYPE ${key} counter\n${key} ${value}`).join("\n")}\n`;
  }
}
