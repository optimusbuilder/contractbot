const DEFAULT_RPM = 20;
const DEFAULT_TPM = 100_000;

export interface RateLimiterOptions {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

/**
 * Sliding-window rate limiter for AI provider calls.
 * Tracks both request count and estimated token throughput.
 */
export class RateLimiter {
  private requestTimestamps: number[] = [];
  private tokenTimestamps: Array<{ ts: number; tokens: number }> = [];
  private rpm: number;
  private tpm: number;

  constructor(options: RateLimiterOptions = {}) {
    this.rpm = options.requestsPerMinute ?? DEFAULT_RPM;
    this.tpm = options.tokensPerMinute ?? DEFAULT_TPM;
  }

  async waitForCapacity(estimatedTokens: number = 0): Promise<number> {
    const waited = await this.waitForRequestSlot();
    const tokenWait = await this.waitForTokenSlot(estimatedTokens);
    return waited + tokenWait;
  }

  recordRequest(tokens: number): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    if (tokens > 0) {
      this.tokenTimestamps.push({ ts: now, tokens });
    }
  }

  private async waitForRequestSlot(): Promise<number> {
    let totalWaited = 0;
    while (true) {
      this.pruneOldEntries();
      if (this.requestTimestamps.length < this.rpm) return totalWaited;

      const oldest = this.requestTimestamps[0];
      const waitMs = oldest + 60_000 - Date.now() + 50; // +50ms buffer
      if (waitMs <= 0) return totalWaited;

      await sleep(waitMs);
      totalWaited += waitMs;
    }
  }

  private async waitForTokenSlot(estimatedTokens: number): Promise<number> {
    if (estimatedTokens === 0) return 0;

    let totalWaited = 0;
    while (true) {
      this.pruneOldEntries();
      const currentTokens = this.tokenTimestamps.reduce((s, e) => s + e.tokens, 0);
      if (currentTokens + estimatedTokens <= this.tpm) return totalWaited;

      const oldest = this.tokenTimestamps[0];
      if (!oldest) return totalWaited;

      const waitMs = oldest.ts + 60_000 - Date.now() + 50;
      if (waitMs <= 0) return totalWaited;

      await sleep(waitMs);
      totalWaited += waitMs;
    }
  }

  private pruneOldEntries(): void {
    const cutoff = Date.now() - 60_000;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > cutoff);
    this.tokenTimestamps = this.tokenTimestamps.filter((e) => e.ts > cutoff);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
