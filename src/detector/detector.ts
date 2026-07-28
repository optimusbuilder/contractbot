import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { glob } from "glob";
import { Project, SyntaxKind } from "ts-morph";
import {
  CatalogEntry,
  findCatalogByEnvVar,
  findCatalogByHost,
  findCatalogByPackage,
} from "./registry.js";
import {
  ApiContract,
  ApiEntry,
  ApiUrgency,
  WatchStrategy,
} from "../config/schema.js";
import { collectManifestDependencies } from "./manifests.js";

export interface ApiCandidate {
  name: string;
  hosts: string[];
  packages: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  suggestedContract?: ApiContract;
  defaultWatch?: WatchStrategy[];
  changelogRepo?: string;
  scanPaths: string[];
  needsResolve: boolean;
  urgency?: ApiUrgency;
}

export interface DetectionResult {
  candidates: ApiCandidate[];
  /** @deprecated Use candidates — kept for callers mid-migration */
  detected: ApiCandidate[];
  unknownUrls: string[];
}

/** @deprecated Use ApiCandidate */
export type DetectedApi = ApiCandidate & { specUrl: string };

export async function detectApis(projectDir: string): Promise<DetectionResult> {
  const byName = new Map<string, Accumulator>();
  const discoveredUrls: string[] = [];

  for (const match of await detectFromPackageJson(projectDir)) {
    merge(byName, match);
  }
  for (const match of await detectFromEnvFiles(projectDir)) {
    merge(byName, match);
  }
  const code = await detectFromCode(projectDir);
  discoveredUrls.push(...code.urls);
  for (const match of code.matches) {
    merge(byName, match);
  }

  // Promote unknown hostnames into candidates (not dropped)
  const knownHostMatched = new Set<string>();
  for (const url of discoveredUrls) {
    const catalog = findCatalogByHost(url);
    if (catalog) {
      knownHostMatched.add(catalog.name);
      continue;
    }
    const name = urlToName(url);
    if (isIgnorableUrl(url) || byName.has(name) || byName.has(catalogNameForUrl(url))) continue;
    if ([...byName.values()].some((a) => a.hosts.some((h) => url.startsWith(h) || h.includes(hostnameOf(url))))) {
      continue;
    }
    merge(byName, {
      name,
      catalog: null,
      hosts: [originOf(url)],
      packages: [],
      evidence: [`code: unrecognized API host "${url}"`],
    });
  }

  const scanPaths = await inferScanPaths(projectDir);
  const candidates: ApiCandidate[] = [];

  for (const [, acc] of byName) {
    const catalog = acc.catalog;
    const contract = catalog?.contract;
    const needsResolve = !contract || contract.type === "unresolved";

    candidates.push({
      name: acc.name,
      hosts: [...new Set(acc.hosts)],
      packages: [...new Set(acc.packages)],
      evidence: [...new Set(acc.evidence)],
      confidence: getConfidence(acc.evidence),
      suggestedContract: contract,
      defaultWatch: catalog?.defaultWatch,
      changelogRepo: catalog?.changelogRepo,
      scanPaths,
      needsResolve,
      urgency: catalog?.urgency ?? "normal",
    });
  }

  candidates.sort(
    (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence),
  );

  const unknownUrls = discoveredUrls.filter((url) => {
    if (findCatalogByHost(url)) return false;
    const name = urlToName(url);
    return !candidates.some((c) => c.name === name);
  });

  return {
    candidates,
    detected: candidates,
    unknownUrls: [...new Set(unknownUrls)],
  };
}

/** Convert a discovery candidate into a config ApiEntry. */
export function candidateToApiEntry(candidate: ApiCandidate): ApiEntry {
  const contract = candidate.suggestedContract ?? {
    type: "unresolved" as const,
    reason: "No OpenAPI or SDK contract found — run contractbot resolve",
  };

  const strategies =
    candidate.defaultWatch ??
    (contract.type === "openapi"
      ? (["spec_poll"] as WatchStrategy[])
      : contract.type === "sdk_package"
        ? (["sdk_version"] as WatchStrategy[])
        : (["probe"] as WatchStrategy[]));

  const entry: ApiEntry = {
    name: candidate.name,
    contract,
    hosts: candidate.hosts.length > 0 ? candidate.hosts : undefined,
    packages: candidate.packages.length > 0 ? candidate.packages : undefined,
    scan_paths: candidate.scanPaths,
    evidence: candidate.evidence,
    needs_resolve: candidate.needsResolve || contract.type === "unresolved",
    urgency: candidate.urgency ?? "normal",
    watch: {
      strategies,
    },
  };

  if (contract.type === "openapi") {
    entry.spec = contract.url;
  }

  if (contract.type === "sdk_package") {
    entry.watch = {
      ...entry.watch,
      sdk: {
        ecosystem: contract.ecosystem,
        package: contract.package,
      },
    };
    if (candidate.changelogRepo) {
      entry.watch.changelog = {
        sources: [
          {
            type: "github_releases",
            url: `https://github.com/${candidate.changelogRepo}/releases`,
            repo: candidate.changelogRepo,
          },
        ],
      };
      if (!entry.watch.strategies?.includes("changelog")) {
        entry.watch.strategies = [...(entry.watch.strategies ?? []), "changelog"];
      }
    }
  }

  if (contract.type === "unresolved" && candidate.hosts[0]) {
    entry.watch = {
      strategies: ["probe"],
      probe: { base_url: candidate.hosts[0] },
    };
  }

  return entry;
}

interface Accumulator {
  name: string;
  catalog: CatalogEntry | null;
  hosts: string[];
  packages: string[];
  evidence: string[];
}

interface PartialMatch {
  name: string;
  catalog: CatalogEntry | null;
  hosts: string[];
  packages: string[];
  evidence: string[];
}

function merge(map: Map<string, Accumulator>, match: PartialMatch): void {
  const existing = map.get(match.name) ?? {
    name: match.name,
    catalog: match.catalog,
    hosts: [],
    packages: [],
    evidence: [],
  };
  if (!existing.catalog && match.catalog) existing.catalog = match.catalog;
  existing.hosts.push(...match.hosts);
  existing.packages.push(...match.packages);
  existing.evidence.push(...match.evidence);
  map.set(match.name, existing);
}

async function detectFromPackageJson(projectDir: string): Promise<PartialMatch[]> {
  const matches: PartialMatch[] = [];

  for (const pkgName of await collectManifestDependencies(projectDir)) {
    const catalog = findCatalogByPackage(pkgName);
    if (catalog) {
      matches.push({
        name: catalog.name,
        catalog,
        hosts: [...catalog.baseUrls.filter((u) => u.startsWith("http"))],
        packages: [pkgName],
          evidence: [`manifest: "${pkgName}" found in dependencies`],
      });
    }
  }

  return matches;
}

async function detectFromEnvFiles(projectDir: string): Promise<PartialMatch[]> {
  const envFiles = [".env", ".env.local", ".env.example", ".env.development"];
  const matches: PartialMatch[] = [];

  for (const envFile of envFiles) {
    const envPath = join(projectDir, envFile);
    if (!existsSync(envPath)) continue;

    const content = await readFile(envPath, "utf-8");
    const vars = content
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => line.split("=")[0].trim());

    for (const envVar of vars) {
      const catalog = findCatalogByEnvVar(envVar);
      if (catalog) {
        matches.push({
          name: catalog.name,
          catalog,
          hosts: [...catalog.baseUrls.filter((u) => u.startsWith("http"))],
          packages: [],
          evidence: [`${envFile}: ${envVar} found`],
        });
      }
    }
  }

  return matches;
}

async function detectFromCode(projectDir: string): Promise<{
  matches: PartialMatch[];
  urls: string[];
}> {
  const matches: PartialMatch[] = [];
  const discoveredUrls: string[] = [];

  const files = await glob("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
    cwd: projectDir,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/ios/**/public/**",
      "**/android/**/assets/**",
      "**/tests/**",
      "**/__tests__/**",
      "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}",
    ],
    absolute: true,
  });

  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const file of files) {
    project.addSourceFileAtPath(file);
  }

  const urlPattern =
    /(?:https?|wss?):\/\/[a-zA-Z0-9.*-]+\.[a-zA-Z]{2,}(?:\/[^\s'"`)]*)?/;

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (node.getKind() === SyntaxKind.StringLiteral || node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral || node.getKind() === SyntaxKind.TemplateExpression) {
        const text = node.getKind() === SyntaxKind.TemplateExpression
          ? node.asKindOrThrow(SyntaxKind.TemplateExpression).getHead().getLiteralText()
          : node.getText().slice(1, -1);
        const urlMatch = text.match(urlPattern);
        if (urlMatch) {
          const url = urlMatch[0];
          if (isIgnorableUrl(url)) return;
          discoveredUrls.push(url);

          const catalog = findCatalogByHost(url);
          if (catalog) {
            matches.push({
              name: catalog.name,
              catalog,
              hosts: [originOf(url)],
              packages: [],
              evidence: [`code: URL "${url}" matches ${catalog.name}`],
            });
          }
        }
      }

      if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
        const text = node.getText();
        if (text.startsWith("process.env.")) {
          const varName = text.replace("process.env.", "");
          const catalog = findCatalogByEnvVar(varName);
          if (catalog) {
            matches.push({
              name: catalog.name,
              catalog,
              hosts: [],
              packages: [],
              evidence: [`code: process.env.${varName} references ${catalog.name}`],
            });
          }
        }
      }
    });
  }

  const polyglotFiles = await glob("**/*.{py,dart}", {
    cwd: projectDir,
    nodir: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/ios/**/public/**", "**/android/**/assets/**", "**/tests/**", "**/__tests__/**"],
    absolute: true,
  });
  const globalUrlPattern = new RegExp(urlPattern.source, "g");
  for (const file of polyglotFiles) {
    const text = await readFile(file, "utf-8");
    for (const match of text.matchAll(globalUrlPattern)) {
      const url = match[0];
      if (isIgnorableUrl(url)) continue;
      discoveredUrls.push(url);
      const catalog = findCatalogByHost(url);
      if (catalog) {
        matches.push({
          name: catalog.name,
          catalog,
          hosts: [originOf(url)],
          packages: [],
          evidence: [`code: URL "${url}" matches ${catalog.name}`],
        });
      }
    }

    const envPattern = file.endsWith(".py")
      ? /(?:os\.getenv|os\.environ\.get)\(\s*["']([A-Z][A-Z0-9_]+)["']/g
      : /(?:Platform\.environment|dotenv\.env)\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g;
    for (const match of text.matchAll(envPattern)) {
      const catalog = findCatalogByEnvVar(match[1]);
      if (catalog) {
        matches.push({
          name: catalog.name,
          catalog,
          hosts: [],
          packages: [],
          evidence: [`code: ${match[1]} references ${catalog.name}`],
        });
      }
    }
  }

  return { matches, urls: discoveredUrls };
}

async function inferScanPaths(projectDir: string): Promise<string[]> {
  const paths: string[] = [];
  const commonDirs = ["src", "lib", "app", "pages", "api", "services", "utils"];
  for (const dir of commonDirs) {
    if (existsSync(join(projectDir, dir))) {
      paths.push(`${dir}/**/*.ts`, `${dir}/**/*.js`);
    }
  }
  if (paths.length === 0) {
    paths.push("**/*.ts", "**/*.js");
  }
  return [...new Set(paths)];
}

function getConfidence(evidence: string[]): "high" | "medium" | "low" {
  if (evidence.length >= 3) return "high";
  if (evidence.length >= 2) return "medium";
  return "low";
}

function confidenceRank(c: "high" | "medium" | "low"): number {
  if (c === "high") return 3;
  if (c === "medium") return 2;
  return 1;
}

function urlToName(url: string): string {
  try {
    const labels = new URL(url).hostname.split(".");
    const ignoredPrefixes = new Set(["api", "accounts", "console", "www"]);
    while (labels.length > 2 && ignoredPrefixes.has(labels[0])) labels.shift();
    return labels.length > 1 ? labels[labels.length - 2] : labels[0] || "unknown-api";
  } catch {
    return "unknown-api";
  }
}

function isIgnorableUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "example.com" ||
      hostname === "www.w3.org" ||
      hostname.endsWith(".google.internal") ||
      hostname.endsWith(".local") ||
      hostname === "console.picovoice.ai" ||
      hostname === "accounts.google.com" ||
      hostname === "www.google.com" ||
      hostname === "youtube.com" ||
      hostname === "github.com" ||
      hostname === "reactjs.org" ||
      hostname === "nextjs.org" ||
      hostname === "vitejs.dev" ||
      hostname === "capacitorjs.com" ||
      hostname.includes("googletagmanager") ||
      hostname.includes("elfsightcdn");
  } catch {
    return true;
  }
}

function catalogNameForUrl(url: string): string {
  return findCatalogByHost(url)?.name ?? urlToName(url);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}
