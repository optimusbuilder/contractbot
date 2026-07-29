import { existsSync } from "fs";
import { join, resolve } from "path";
import { collectDiscoveryEvidence, detectApis } from "../../detector/index.js";
import { findCatalogByEnvVar, findCatalogByHost, findCatalogByPackage } from "../../detector/registry.js";
import { createProvider } from "../../providers/index.js";
import { DEFAULT_CONFIG } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";

interface DiscoverOptions { dir: string; config?: string; ai?: boolean }

interface AiSuggestion {
  name: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  suggestedType: "openapi" | "sdk_package" | "changelog" | "unknown";
}

export async function discoverCommand(options: DiscoverOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const evidence = await collectDiscoveryEvidence(projectDir);
  if (!options.ai) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const configPath = options.config ?? join(projectDir, ".contractbot.yml");
  const config = existsSync(configPath) ? await loadConfig(configPath) : DEFAULT_CONFIG;
  const provider = createProvider(config.ai);
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
