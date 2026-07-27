import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { ChangelogSource, WatchEvent } from "./types.js";

const CHANGELOG_CACHE_DIR = ".contractbot/cache/changelogs";

interface ChangelogEntry {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  body: string;
}

interface ChangelogCache {
  lastChecked: string;
  lastEntryId: string;
  entries: ChangelogEntry[];
}

/**
 * Monitors changelog sources (GitHub releases, RSS feeds, etc.)
 * for signals that an API has changed.
 */
export async function checkChangelogs(
  apiName: string,
  sources: ChangelogSource[],
): Promise<WatchEvent[]> {
  const events: WatchEvent[] = [];

  for (const source of sources) {
    const newEntries = await fetchNewEntries(apiName, source);

    for (const entry of newEntries) {
      const severity = classifyChangelogEntry(entry);
      events.push({
        apiName,
        strategy: "changelog",
        timestamp: new Date(entry.publishedAt),
        description: entry.title,
        severity,
        details: {
          url: entry.url,
          source: source.type,
          body: entry.body.slice(0, 500),
        },
      });
    }
  }

  return events;
}

async function fetchNewEntries(
  apiName: string,
  source: ChangelogSource,
): Promise<ChangelogEntry[]> {
  const cache = await loadChangelogCache(apiName, source);
  let entries: ChangelogEntry[] = [];

  switch (source.type) {
    case "github_releases":
      entries = await fetchGitHubReleases(source);
      break;
    case "rss":
    case "atom":
      entries = await fetchFeed(source);
      break;
    case "url":
      entries = await fetchRawChangelog(source);
      break;
  }

  const newEntries = cache
    ? entries.filter((e) => new Date(e.publishedAt) > new Date(cache.lastChecked))
    : entries.slice(0, 5);

  await saveChangelogCache(apiName, source, entries);

  return newEntries;
}

async function fetchGitHubReleases(
  source: ChangelogSource,
): Promise<ChangelogEntry[]> {
  const repo = source.repo ?? extractRepoFromUrl(source.url);
  if (!repo) return [];

  const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=10`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "contractbot",
  };

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });
    if (!response.ok) return [];

    const releases = (await response.json()) as Array<{
      id: number;
      name: string;
      html_url: string;
      published_at: string;
      body: string;
    }>;

    return releases.map((r) => ({
      id: String(r.id),
      title: r.name || "Untitled release",
      url: r.html_url,
      publishedAt: r.published_at,
      body: r.body ?? "",
    }));
  } catch {
    return [];
  }
}

async function fetchFeed(source: ChangelogSource): Promise<ChangelogEntry[]> {
  try {
    const response = await fetch(source.url);
    if (!response.ok) return [];

    const text = await response.text();
    return parseFeedXml(text);
  } catch {
    return [];
  }
}

function parseFeedXml(xml: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // RSS <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title") ?? "Untitled";
    const link = extractTag(itemXml, "link") ?? "";
    const pubDate = extractTag(itemXml, "pubDate") ?? new Date().toISOString();
    const description = extractTag(itemXml, "description") ?? "";
    const guid = extractTag(itemXml, "guid") ?? link;

    entries.push({
      id: guid,
      title,
      url: link,
      publishedAt: pubDate,
      body: stripHtml(description),
    });
  }

  // Atom <entry> elements
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const title = extractTag(entryXml, "title") ?? "Untitled";
    const link = extractAtomLink(entryXml) ?? "";
    const updated = extractTag(entryXml, "updated") ?? extractTag(entryXml, "published") ?? new Date().toISOString();
    const summary = extractTag(entryXml, "summary") ?? extractTag(entryXml, "content") ?? "";
    const id = extractTag(entryXml, "id") ?? link;

    entries.push({
      id,
      title,
      url: link,
      publishedAt: updated,
      body: stripHtml(summary),
    });
  }

  return entries;
}

async function fetchRawChangelog(
  source: ChangelogSource,
): Promise<ChangelogEntry[]> {
  try {
    const response = await fetch(source.url);
    if (!response.ok) return [];

    const text = await response.text();
    return parseMarkdownChangelog(text, source.url);
  } catch {
    return [];
  }
}

function parseMarkdownChangelog(text: string, sourceUrl: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const sectionRegex = /^#{1,3}\s+\[?v?(\d+\.\d+[^\]]*)\]?.*$/gm;

  let lastIndex = 0;
  let lastTitle = "";
  let lastDate = "";
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(text)) !== null) {
    if (lastTitle) {
      const body = text.slice(lastIndex, match.index).trim();
      entries.push({
        id: lastTitle,
        title: lastTitle,
        url: sourceUrl,
        publishedAt: lastDate || new Date().toISOString(),
        body: body.slice(0, 1000),
      });
    }
    lastTitle = match[0].replace(/^#+\s*/, "");
    lastIndex = match.index + match[0].length;

    const dateMatch = lastTitle.match(/\d{4}-\d{2}-\d{2}/);
    lastDate = dateMatch ? dateMatch[0] : new Date().toISOString();
  }

  if (lastTitle) {
    const body = text.slice(lastIndex).trim();
    entries.push({
      id: lastTitle,
      title: lastTitle,
      url: sourceUrl,
      publishedAt: lastDate || new Date().toISOString(),
      body: body.slice(0, 1000),
    });
  }

  return entries.slice(0, 10);
}

/**
 * Classifies a changelog entry by scanning its content for
 * breaking-change signals.
 */
function classifyChangelogEntry(entry: ChangelogEntry): "breaking" | "non-breaking" | "unknown" {
  const text = `${entry.title} ${entry.body}`.toLowerCase();

  const breakingSignals = [
    "breaking change",
    "breaking:",
    "removed",
    "deprecated and removed",
    "no longer support",
    "migration required",
    "incompatible",
    "renamed",
    "mandatory",
    "required field",
    "removed endpoint",
    "removed field",
    "type change",
  ];

  const nonBreakingSignals = [
    "added",
    "new feature",
    "new endpoint",
    "optional",
    "deprecated",
    "bug fix",
    "patch",
    "improvement",
  ];

  const hasBreaking = breakingSignals.some((s) => text.includes(s));
  const hasNonBreaking = nonBreakingSignals.some((s) => text.includes(s));

  if (hasBreaking) return "breaking";
  if (hasNonBreaking) return "non-breaking";
  return "unknown";
}

async function loadChangelogCache(
  apiName: string,
  source: ChangelogSource,
): Promise<ChangelogCache | null> {
  const path = cachePathFor(apiName, source);
  if (!existsSync(path)) return null;

  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as ChangelogCache;
}

async function saveChangelogCache(
  apiName: string,
  source: ChangelogSource,
  entries: ChangelogEntry[],
): Promise<void> {
  await mkdir(CHANGELOG_CACHE_DIR, { recursive: true });
  const path = cachePathFor(apiName, source);

  const cache: ChangelogCache = {
    lastChecked: new Date().toISOString(),
    lastEntryId: entries[0]?.id ?? "",
    entries: entries.slice(0, 20),
  };

  await writeFile(path, JSON.stringify(cache, null, 2), "utf-8");
}

function cachePathFor(apiName: string, source: ChangelogSource): string {
  const safeName = `${apiName}-${source.type}`.replace(/[^a-z0-9-]/gi, "_");
  return join(CHANGELOG_CACHE_DIR, `${safeName}.json`);
}

function extractRepoFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\.git$/, "") : null;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAtomLink(xml: string): string | null {
  const match = xml.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
  return match ? match[1] : null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}
