import { existsSync } from "fs";
import { join, resolve } from "path";
import { collectDiscoveryEvidence, detectApis } from "../../detector/index.js";
import { findCatalogByEnvVar, findCatalogByHost, findCatalogByPackage } from "../../detector/registry.js";
import { createProvider } from "../../providers/index.js";
import { DEFAULT_CONFIG } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";
import { buildCachedIntegrationEvidence, parseEvidenceQueries, queryIntegrationEvidence } from "../../investigator/index.js";
import { normalizeProviderFromEvidence } from "../../investigator/index.js";
import { saveDiscoveryReview } from "../../investigator/index.js";
import { saveDiscoveryDiagnostics } from "../../investigator/index.js";
import { buildProviderEvidenceClusters } from "../../investigator/index.js";

interface DiscoverOptions { dir: string; config?: string; ai?: boolean; agent?: boolean; refresh?: boolean }

interface AiSuggestion {
  name: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  suggestedType: "openapi" | "sdk_package" | "changelog" | "unknown";
}

export async function discoverCommand(options: DiscoverOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const evidence = await collectDiscoveryEvidence(projectDir);
  if (!options.ai && !options.agent) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const configPath = options.config ?? join(projectDir, ".contractbot.yml");
  const config = existsSync(configPath) ? await loadConfig(configPath) : DEFAULT_CONFIG;
  const provider = createProvider(config.ai);
  if (options.agent) {
    await runAgenticDiscovery(projectDir, provider, options.refresh);
    return;
  }
  const deterministic = await detectApis(projectDir);
  const deterministicNames = new Set(deterministic.candidates.map((candidate) => candidate.name.toLowerCase()));
  const unresolved = deterministic.candidates
    .filter((candidate) => candidate.needsResolve)
    .map((candidate) => ({ name: candidate.name, packages: candidate.packages, hosts: candidate.hosts, evidence: candidate.evidence }));
  const unmatched = {
    packages: evidence.packages.filter((value) => !findCatalogByPackage(value)),
    environmentVariables: evidence.environmentVariables.filter((value) => !findCatalogByEnvVar(value)),
    hosts: evidence.hosts.filter((value) => !findCatalogByHost(`https://${value}`)),
  };
  const allowedEvidence = new Set([...unmatched.packages, ...unmatched.environmentVariables, ...unmatched.hosts, ...unresolved.flatMap((candidate) => [...candidate.packages, ...candidate.hosts])]);
  const prompt = `Suggest only NEW external API providers from unresolved evidence. Return JSON only: [{"name":"canonical-provider-slug","confidence":"high|medium|low","evidence":["exact supplied identifier"],"suggestedType":"openapi|sdk_package|changelog|unknown"}]. Never return a package name, environment variable name, framework, test tool, or already-known provider as name. Each evidence item must exactly match a supplied identifier. If no justified additions exist, return [].\n\nAlready known providers: ${JSON.stringify([...deterministicNames])}\nUnresolved candidates: ${JSON.stringify(unresolved)}\nUnmatched identifiers: ${JSON.stringify(unmatched)}`;
  const response = await provider.generate(prompt, "You are a conservative API dependency analyst. Suggestions require human review and must cite supplied evidence.");
  const suggestions = filterAiSuggestions(response, deterministicNames, allowedEvidence);
  console.log(JSON.stringify({ suggestions, rejectedSuggestionCount: countSuggestions(response) - suggestions.length }, null, 2));
}

async function runAgenticDiscovery(projectDir: string, provider: ReturnType<typeof createProvider>, refresh = false): Promise<void> {
  const evidence = await buildCachedIntegrationEvidence(projectDir, refresh);
  const priorityIndex = evidence.filter(isPriorityIntegrationEvidence).map(({ kind, value, file, line }) => ({ kind, value, file, line }));
  const nonPriorityIndex = evidence.filter((item) => !isPriorityIntegrationEvidence(item)).map(({ kind, value, file, line }) => ({ kind, value, file, line }));
  const index = [...priorityIndex, ...nonPriorityIndex].slice(0, 400);
  const knownValues = new Set(evidence.map((item) => item.value));
  const plan = await provider.generate(
    `You are planning a bounded repository investigation for external integrations. Return JSON only: {"queries":[{"term":"exact value from index","kind":"optional evidence kind"}]}. Request at most 8 values that most help distinguish real external API integrations from navigation, assets, tests, or frameworks.\n\nEvidence index: ${JSON.stringify(index)}`,
    "You may query only listed evidence values. Do not infer providers yet.",
  );
  const queries = parseEvidenceQueries(plan, knownValues);
  const selected = deduplicateEvidence([
    ...evidence.filter(isPriorityIntegrationEvidence),
    ...queries.flatMap((query) => queryIntegrationEvidence(evidence, query)),
  ]);
  const candidates: unknown[] = [];
  const providerClusters = buildProviderEvidenceClusters(selected);
  const selectedClusters = providerClusters.slice(0, 8);
  const clusterResults: Array<Record<string, unknown>> = [];
  for (const providerCluster of selectedClusters) {
    const cluster = providerCluster.evidence.slice(0, 16);
    try {
      const response = await provider.generate(
        `Classify this provider evidence cluster. The deterministic seed is "${providerCluster.provider}". Return JSON only: {"candidates":[{"provider":"canonical-provider-slug","classification":"external_api|sdk_client|websocket_api|oauth_identity|browser_navigation|static_asset|documentation|internal_service|test_fixture|unknown","confidence":"high|medium|low","evidence":[{"file":"exact file","line":number,"kind":"exact kind","value":"exact value"}],"suggestedContractKind":"openapi|sdk_package|changelog|unknown","sourceConfidence":"high|medium|low"}]}. Only classify real external integrations. Do not return frameworks, package names, env-var names, navigation, assets, or code changes.\n\nCluster evidence: ${JSON.stringify(cluster)}`,
        "You are a conservative external integration investigator. Cite only supplied evidence.",
      );
      const validated = validateAgentCandidates(response, cluster).candidates;
      candidates.push(...validated);
      clusterResults.push({ providerSeed: providerCluster.provider, evidenceCount: providerCluster.evidence.length, evidenceKinds: [...new Set(cluster.map((item) => item.kind))], selectedForAI: true, aiResponseStatus: response.includes('"candidates"') ? "returned_candidates" : "returned_no_candidate", validationStatus: validated.length > 0 ? "accepted" : "rejected_or_empty" });
    } catch (error) {
      clusterResults.push({ providerSeed: providerCluster.provider, evidenceCount: providerCluster.evidence.length, evidenceKinds: [...new Set(cluster.map((item) => item.kind))], selectedForAI: true, aiResponseStatus: "error", validationStatus: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  const reviewed = deduplicateAgentCandidates(candidates);
  const reviewPath = await saveDiscoveryReview(projectDir, reviewed);
  const diagnostics: Array<Record<string, unknown>> = providerClusters.map((cluster) => ({ providerSeed: cluster.provider, evidenceCount: cluster.evidence.length, evidenceKinds: [...new Set(cluster.evidence.map((item) => item.kind))], selectedForAI: selectedClusters.includes(cluster), aiResponseStatus: selectedClusters.includes(cluster) ? "pending" : "not_selected", validationStatus: selectedClusters.includes(cluster) ? "pending" : "not_selected" }));
  for (const diagnostic of diagnostics) {
    const result = clusterResults.find((item) => item.providerSeed === diagnostic.providerSeed);
    if (result) Object.assign(diagnostic, result);
    diagnostic.finalReviewCandidate = reviewed.some((candidate) => (candidate as { provider?: string }).provider === diagnostic.providerSeed);
  }
  const diagnosticsPath = await saveDiscoveryDiagnostics(projectDir, diagnostics);
  console.log(JSON.stringify({
    candidates: reviewed,
    reviewPath,
    diagnosticsPath,
    clusterCoverage: providerClusters.map((cluster) => ({
      provider: cluster.provider,
      selected: selectedClusters.includes(cluster),
      classified: reviewed.some((candidate) => (candidate as { provider?: string }).provider === cluster.provider),
      evidenceCount: cluster.evidence.length,
    })),
  }, null, 2));
}

function isPriorityIntegrationEvidence(item: { kind: string; value: string }): boolean {
  if (item.kind === "http_request" || item.kind === "websocket_api" || item.kind === "sdk_construction" || item.kind === "service_call") return true;
  if (item.kind === "environment_variable") return /(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|CLIENT_ID|PROJECT_ID|URI)$/.test(item.value);
  if (item.kind === "sdk_import") return /(^@aws-sdk\/|sdk|client|api|langchain|google|openai|anthropic|browserbase|mongodb|mongoose|langsmith)/i.test(item.value);
  return false;
}

function deduplicateEvidence<T extends { kind: string; value: string; file: string; line: number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.value}:${item.file}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clusterIntegrationEvidence<T extends { kind: string; value: string; file: string; line: number }>(evidence: T[]): T[][] {
  const clusters = new Map<string, T[]>();
  for (const item of evidence) {
    const cluster = clusters.get(item.file) ?? [];
    cluster.push(item);
    clusters.set(item.file, cluster);
  }
  return [...clusters.values()].sort((a, b) => clusterScore(b) - clusterScore(a));
}

export function selectAgentClusters<T extends { kind: string; value: string; file: string; line: number }>(evidence: T[], limit: number): T[][] {
  const clusters = clusterIntegrationEvidence(evidence);
  const selected: T[][] = [];
  const used = new Set<T[]>();
  const languageGroups = [/\.py$/, /\.dart$/, /\.(ts|tsx|js|jsx|mjs|cjs)$/];
  for (const group of languageGroups) {
    const cluster = clusters.find((candidate) => group.test(candidate[0]?.file ?? ""));
    if (cluster) {
      selected.push(cluster);
      used.add(cluster);
    }
  }
  for (const cluster of clusters) {
    if (selected.length >= limit) break;
    if (!used.has(cluster)) selected.push(cluster);
  }
  return selected.slice(0, limit).map((cluster) => cluster.slice(0, 12));
}

function clusterScore(cluster: Array<{ kind: string }>): number {
  const hasRequest = cluster.some((item) => item.kind === "http_request" || item.kind === "websocket_api" || item.kind === "sdk_construction" || item.kind === "service_call");
  const sdkCount = cluster.filter((item) => item.kind === "sdk_import").length;
  const hasEnv = cluster.some((item) => item.kind === "environment_variable");
  return (hasRequest ? 10 : 0) + Math.min(sdkCount, 2) * 6 + (hasEnv ? 1 : 0);
}

function deduplicateAgentCandidates(candidates: unknown[]): unknown[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const provider = candidate && typeof candidate === "object" ? (candidate as { provider?: unknown }).provider : undefined;
    if (typeof provider !== "string" || seen.has(provider)) return false;
    seen.add(provider);
    return true;
  });
}

export function validateAgentCandidates(response: string, evidence: Array<{ file: string; line: number; kind: string; value: string }>): { candidates: unknown[] } {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return { candidates: [] };
  try {
    const value = JSON.parse(match[0]) as { candidates?: unknown };
    if (!Array.isArray(value.candidates)) return { candidates: [] };
    const locations = new Set(evidence.map((item) => `${item.file}:${item.line}:${item.kind}:${item.value}`));
    const candidates = value.candidates.filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as { provider?: unknown; classification?: unknown; confidence?: unknown; evidence?: unknown; suggestedContractKind?: unknown; sourceConfidence?: unknown };
      if (typeof item.provider !== "string" || !/^[a-z][a-z0-9-]*$/.test(item.provider) || !Array.isArray(item.evidence) || item.evidence.length === 0) return false;
      if (!["external_api", "sdk_client", "websocket_api", "oauth_identity", "browser_navigation", "static_asset", "documentation", "internal_service", "test_fixture", "unknown"].includes(item.classification as string)) return false;
      if (item.classification === "unknown" || item.classification === "documentation" || item.classification === "static_asset" || item.classification === "browser_navigation" || item.classification === "test_fixture") return false;
      if (!["high", "medium", "low"].includes(item.confidence as string) || !["high", "medium", "low"].includes(item.sourceConfidence as string)) return false;
      if (!["openapi", "sdk_package", "changelog", "unknown"].includes(item.suggestedContractKind as string)) return false;
      // A generic library is not an integration candidate. Hosted SDK clients
      // must identify a plausible contract family before reaching review.
      if (item.classification === "sdk_client" && item.suggestedContractKind === "unknown") return false;
      if (item.evidence.every((citation) => (citation as { kind?: string }).kind === "environment_variable")) return false;
      const citationsValid = item.evidence.every((citation) => {
        if (!citation || typeof citation !== "object") return false;
        const cited = citation as { file?: string; line?: number; kind?: string; value?: string };
        return locations.has(`${cited.file}:${cited.line}:${cited.kind}:${cited.value}`);
      });
      if (!citationsValid) return false;
      const catalogProviders = item.evidence
        .filter((citation): citation is { kind: string; value: string } => Boolean(citation && typeof citation === "object" && typeof (citation as { kind?: unknown }).kind === "string" && typeof (citation as { value?: unknown }).value === "string"))
        .map((citation) => citation.kind === "sdk_import" ? findCatalogByPackage(citation.value)?.name : undefined)
        .filter((provider): provider is string => Boolean(provider));
      const normalized = normalizeProviderFromEvidence(item.provider, item.evidence as Array<{ kind?: string; value?: string }>);
      return catalogProviders.length === 0 || catalogProviders.includes(normalized);
    });
    return { candidates: candidates.map((candidate) => ({
      ...(candidate as Record<string, unknown>),
      provider: normalizeProviderFromEvidence((candidate as { provider: string }).provider, (candidate as { evidence: Array<{ kind?: string; value?: string }> }).evidence),
    })) };
  } catch { return { candidates: [] }; }
}

export function filterAiSuggestions(
  response: string,
  deterministicNames: Set<string>,
  allowedEvidence: Set<string>,
): AiSuggestion[] {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed.filter((value): value is AiSuggestion => {
    if (!value || typeof value !== "object") return false;
    const suggestion = value as Partial<AiSuggestion>;
    const name = suggestion.name?.toLowerCase();
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name) || deterministicNames.has(name) || seen.has(name) || allowedEvidence.has(suggestion.name ?? "") || GENERIC_SOFTWARE.has(name)) return false;
    if (!Array.isArray(suggestion.evidence) || suggestion.evidence.length === 0 || !suggestion.evidence.every((item) => typeof item === "string" && allowedEvidence.has(item))) return false;
    if (!suggestion.confidence || !["high", "medium", "low"].includes(suggestion.confidence)) return false;
    if (!suggestion.suggestedType || !["openapi", "sdk_package", "changelog", "unknown"].includes(suggestion.suggestedType)) return false;
    seen.add(name);
    return true;
  });
}

const GENERIC_SOFTWARE = new Set(["express", "zod", "electron", "vitest", "typescript", "react", "node", "python"]);

function countSuggestions(response: string): number {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return 0;
  try { return Array.isArray(JSON.parse(match[0])) ? JSON.parse(match[0]).length : 0; } catch { return 0; }
}
