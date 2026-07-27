import { LlmProvider } from "./types.js";
import { AiCache, AiCacheOptions } from "./cache.js";
import { UsageTracker } from "./usage.js";
import { RateLimiter, RateLimiterOptions } from "./rate-limiter.js";

export interface TrackedProviderOptions {
  cache?: AiCacheOptions;
  rateLimiter?: RateLimiterOptions;
  budgetUsd?: number;
  maxRequests?: number;
}

/**
 * Wraps any LlmProvider with caching, usage tracking, rate limiting,
 * and budget enforcement. Drop-in replacement — implements LlmProvider.
 */
export class TrackedProvider implements LlmProvider {
  private inner: LlmProvider;
  private model: string;
  readonly cache: AiCache;
  readonly usage: UsageTracker;
  readonly rateLimiter: RateLimiter;

  constructor(
    inner: LlmProvider,
    model: string,
    options: TrackedProviderOptions = {},
  ) {
    this.inner = inner;
    this.model = model;
    this.cache = new AiCache(options.cache);
    this.usage = new UsageTracker({
      budgetUsd: options.budgetUsd,
      maxRequests: options.maxRequests,
    });
    this.rateLimiter = new RateLimiter(options.rateLimiter);
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const sys = systemPrompt ?? "";

    // 1. Check cache first
    const cached = await this.cache.get(prompt, sys, this.model);
    if (cached !== null) {
      this.usage.record(this.model, prompt + sys, cached, true);
      return cached;
    }

    // 2. Check budget before making an API call
    const budgetCheck = this.usage.checkBudget();
    if (!budgetCheck.allowed) {
      throw new Error(budgetCheck.reason);
    }

    // 3. Wait for rate limit capacity
    const estimatedInputTokens = UsageTracker.estimateTokens(prompt + sys);
    await this.rateLimiter.waitForCapacity(estimatedInputTokens);

    // 4. Call the underlying provider
    const response = await this.inner.generate(prompt, systemPrompt);

    // 5. Record usage
    const totalTokens = estimatedInputTokens + UsageTracker.estimateTokens(response);
    this.rateLimiter.recordRequest(totalTokens);
    this.usage.record(this.model, prompt + sys, response, false);

    // 6. Cache the response
    await this.cache.set(prompt, sys, this.model, response);

    return response;
  }
}
