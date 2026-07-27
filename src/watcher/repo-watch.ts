import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { RepoWatchConfig, WatchEvent } from "./types.js";

const REPO_CACHE_DIR = ".contractbot/cache/repos";

interface RepoCacheEntry {
  lastCommitSha: string;
  lastChecked: string;
  specPath: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string };
  };
  html_url: string;
}

interface GitHubCompareFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GitHubCompareResponse {
  total_commits: number;
  commits: GitHubCommit[];
  files: GitHubCompareFile[];
}

/**
 * Watches GitHub repos that host OpenAPI specs for new commits.
 * When the spec file changes, it reports the commit info as a watch event.
 */
export async function checkRepoChanges(
  apiName: string,
  config: RepoWatchConfig,
): Promise<WatchEvent[]> {
  const branch = config.branch ?? "main";
  const latestCommit = await getLatestCommit(config.repo, branch, config.specPath);

  if (!latestCommit) return [];

  const cache = await loadRepoCache(apiName);

  if (!cache) {
    await saveRepoCache(apiName, {
      lastCommitSha: latestCommit.sha,
      lastChecked: new Date().toISOString(),
      specPath: config.specPath,
    });
    return [];
  }

  if (cache.lastCommitSha === latestCommit.sha) return [];

  const changes = await getCommitsBetween(
    config.repo,
    cache.lastCommitSha,
    latestCommit.sha,
    config.specPath,
  );

  await saveRepoCache(apiName, {
    lastCommitSha: latestCommit.sha,
    lastChecked: new Date().toISOString(),
    specPath: config.specPath,
  });

  const events: WatchEvent[] = [];

  for (const commit of changes) {
    const severity = classifyCommitMessage(commit.commit.message);
    events.push({
      apiName,
      strategy: "repo_watch",
      timestamp: new Date(commit.commit.author.date),
      description: `Spec updated: ${commit.commit.message.split("\n")[0]}`,
      severity,
      details: {
        sha: commit.sha,
        url: commit.html_url,
        repo: config.repo,
        specPath: config.specPath,
      },
    });
  }

  return events;
}

/**
 * Discovers known spec repos for popular APIs.
 * Returns a mapping of API name -> repo watch config.
 */
export function getKnownSpecRepos(): Map<string, RepoWatchConfig> {
  const repos = new Map<string, RepoWatchConfig>();

  repos.set("stripe", {
    repo: "stripe/openapi",
    specPath: "openapi/spec3.json",
    branch: "master",
  });

  repos.set("github", {
    repo: "github/rest-api-description",
    specPath: "descriptions/api.github.com/api.github.com.json",
    branch: "main",
  });

  repos.set("twilio", {
    repo: "twilio/twilio-oai",
    specPath: "spec/json/twilio_api_v2010.json",
    branch: "main",
  });

  repos.set("discord", {
    repo: "discord/discord-api-spec",
    specPath: "specs/openapi.json",
    branch: "main",
  });

  repos.set("cloudflare", {
    repo: "cloudflare/api-schemas",
    specPath: "openapi.json",
    branch: "main",
  });

  repos.set("plaid", {
    repo: "plaid/plaid-openapi",
    specPath: "2020-09-14.yml",
    branch: "master",
  });

  return repos;
}

async function getLatestCommit(
  repo: string,
  branch: string,
  path: string,
): Promise<GitHubCommit | null> {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${branch}&path=${encodeURIComponent(path)}&per_page=1`;
  const headers = githubHeaders();

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;

    const commits = (await response.json()) as GitHubCommit[];
    return commits[0] ?? null;
  } catch {
    return null;
  }
}

async function getCommitsBetween(
  repo: string,
  baseSha: string,
  headSha: string,
  specPath: string,
): Promise<GitHubCommit[]> {
  const url = `https://api.github.com/repos/${repo}/compare/${baseSha}...${headSha}`;
  const headers = githubHeaders();

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return [];

    const comparison = (await response.json()) as GitHubCompareResponse;

    const specChanged = comparison.files?.some(
      (f) => f.filename === specPath || f.filename.includes(specPath),
    );

    if (!specChanged) return [];

    return comparison.commits;
  } catch {
    return [];
  }
}

function classifyCommitMessage(message: string): "breaking" | "non-breaking" | "unknown" {
  const text = message.toLowerCase();

  if (
    text.includes("breaking") ||
    text.includes("remove") ||
    text.includes("deprecat") ||
    text.includes("rename") ||
    text.includes("migration")
  ) {
    return "breaking";
  }

  if (
    text.includes("add") ||
    text.includes("new") ||
    text.includes("feat") ||
    text.includes("optional")
  ) {
    return "non-breaking";
  }

  return "unknown";
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "contractbot",
  };

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function loadRepoCache(apiName: string): Promise<RepoCacheEntry | null> {
  const path = join(REPO_CACHE_DIR, `${apiName}.json`);
  if (!existsSync(path)) return null;

  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as RepoCacheEntry;
}

async function saveRepoCache(
  apiName: string,
  entry: RepoCacheEntry,
): Promise<void> {
  await mkdir(REPO_CACHE_DIR, { recursive: true });
  const path = join(REPO_CACHE_DIR, `${apiName}.json`);
  await writeFile(path, JSON.stringify(entry, null, 2), "utf-8");
}
