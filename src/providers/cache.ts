import { createHash } from "crypto";
import { mkdir, readFile, writeFile, readdir, stat, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const CACHE_DIR = ".apihealer/ai-cache";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_ENTRIES = 200;

export interface CacheEntry {
  promptHash: string;
  systemHash: string;
  response: string;
  createdAt: number;
  model: string;
}

export interface AiCacheOptions {
  enabled?: boolean;
  ttlMs?: number;
  maxEntries?: number;
  cacheDir?: string;
}

export class AiCache {
  private dir: string;
  private ttlMs: number;
  private maxEntries: number;
  private enabled: boolean;
  private hits = 0;
  private misses = 0;

  constructor(options: AiCacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.dir = options.cacheDir ?? CACHE_DIR;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  static hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private cacheKey(prompt: string, systemPrompt: string, model: string): string {
    const combined = `${model}:${AiCache.hashContent(systemPrompt)}:${AiCache.hashContent(prompt)}`;
    return AiCache.hashContent(combined);
  }

  async get(prompt: string, systemPrompt: string, model: string): Promise<string | null> {
    if (!this.enabled) return null;

    const key = this.cacheKey(prompt, systemPrompt, model);
    const path = join(this.dir, `${key}.json`);

    if (!existsSync(path)) {
      this.misses++;
      return null;
    }

    try {
      const raw = await readFile(path, "utf-8");
      const entry = JSON.parse(raw) as CacheEntry;

      if (Date.now() - entry.createdAt > this.ttlMs) {
        this.misses++;
        return null;
      }

      this.hits++;
      return entry.response;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(
    prompt: string,
    systemPrompt: string,
    model: string,
    response: string,
  ): Promise<void> {
    if (!this.enabled) return;

    await mkdir(this.dir, { recursive: true });

    const key = this.cacheKey(prompt, systemPrompt, model);
    const entry: CacheEntry = {
      promptHash: AiCache.hashContent(prompt),
      systemHash: AiCache.hashContent(systemPrompt),
      response,
      createdAt: Date.now(),
      model,
    };

    await writeFile(join(this.dir, `${key}.json`), JSON.stringify(entry), "utf-8");
    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    if (!existsSync(this.dir)) return;

    try {
      const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
      if (files.length <= this.maxEntries) return;

      const entries = await Promise.all(
        files.map(async (f) => {
          const filePath = join(this.dir, f);
          const s = await stat(filePath);
          return { filePath, mtimeMs: s.mtimeMs };
        }),
      );

      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toRemove = entries.slice(0, entries.length - this.maxEntries);
      await Promise.all(toRemove.map((e) => rm(e.filePath, { force: true })));
    } catch {
      // Non-critical — eviction failure shouldn't break the flow
    }
  }

  getStats(): { hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    const rate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + "%" : "N/A";
    return { hits: this.hits, misses: this.misses, hitRate: rate };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}
