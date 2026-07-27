/**
 * Approximate cost per 1M tokens (USD) for common models.
 * Input/output pricing where available; falls back to blended average.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
};

const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface UsageRecord {
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  cached: boolean;
}

export interface UsageSummary {
  totalRequests: number;
  cachedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  byModel: Map<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private budgetUsd: number | null = null;
  private maxRequests: number | null = null;

  constructor(options: { budgetUsd?: number; maxRequests?: number } = {}) {
    this.budgetUsd = options.budgetUsd ?? null;
    this.maxRequests = options.maxRequests ?? null;
  }

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  static estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = findPricing(model);
    if (!pricing) return 0;

    return (inputTokens / 1_000_000) * pricing.input +
           (outputTokens / 1_000_000) * pricing.output;
  }

  record(
    model: string,
    inputText: string,
    outputText: string,
    cached: boolean,
  ): UsageRecord {
    const inputTokens = UsageTracker.estimateTokens(inputText);
    const outputTokens = UsageTracker.estimateTokens(outputText);
    const estimatedCostUsd = cached ? 0 : UsageTracker.estimateCost(model, inputTokens, outputTokens);

    const entry: UsageRecord = {
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      cached,
    };

    this.records.push(entry);
    return entry;
  }

  checkBudget(): { allowed: boolean; reason?: string } {
    if (this.maxRequests !== null) {
      const nonCached = this.records.filter((r) => !r.cached).length;
      if (nonCached >= this.maxRequests) {
        return {
          allowed: false,
          reason: `Request limit reached: ${nonCached}/${this.maxRequests} API calls used`,
        };
      }
    }

    if (this.budgetUsd !== null) {
      const spent = this.getTotalCost();
      if (spent >= this.budgetUsd) {
        return {
          allowed: false,
          reason: `Budget limit reached: $${spent.toFixed(4)} of $${this.budgetUsd.toFixed(2)} spent`,
        };
      }
    }

    return { allowed: true };
  }

  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  }

  getSummary(): UsageSummary {
    const byModel = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number }>();

    for (const r of this.records) {
      const existing = byModel.get(r.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      existing.requests++;
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.costUsd += r.estimatedCostUsd;
      byModel.set(r.model, existing);
    }

    return {
      totalRequests: this.records.length,
      cachedRequests: this.records.filter((r) => r.cached).length,
      totalInputTokens: this.records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      estimatedCostUsd: this.getTotalCost(),
      byModel,
    };
  }

  formatSummary(): string {
    const s = this.getSummary();
    const lines: string[] = [];

    lines.push(`AI Usage: ${s.totalRequests} request(s) (${s.cachedRequests} cached)`);
    lines.push(`  Tokens: ~${s.totalInputTokens.toLocaleString()} input, ~${s.totalOutputTokens.toLocaleString()} output`);

    if (s.estimatedCostUsd > 0) {
      lines.push(`  Estimated cost: $${s.estimatedCostUsd.toFixed(4)}`);
    } else {
      lines.push("  Estimated cost: $0 (local/free model or all cached)");
    }

    if (this.budgetUsd !== null) {
      const pct = ((s.estimatedCostUsd / this.budgetUsd) * 100).toFixed(1);
      lines.push(`  Budget: $${s.estimatedCostUsd.toFixed(4)} / $${this.budgetUsd.toFixed(2)} (${pct}%)`);
    }

    return lines.join("\n");
  }
}

function findPricing(model: string): { input: number; output: number } | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) || model.includes(key)) return pricing;
  }

  if (model.startsWith("gpt-")) return MODEL_PRICING["gpt-4o-mini"];
  if (model.startsWith("claude-")) return MODEL_PRICING["claude-sonnet-4-20250514"];

  // Ollama/local models are free
  return null;
}
