import { findCatalogByHost, findCatalogByPackage } from "../detector/registry.js";
import { IntegrationEvidence } from "./evidence.js";
import { normalizeProviderFromEvidence } from "./normalize.js";

export interface ProviderEvidenceCluster {
  provider: string;
  evidence: IntegrationEvidence[];
}

const ENV_PREFIXES: Array<[RegExp, string]> = [
  [/^PINECONE_/, "pinecone"], [/^ANTHROPIC_/, "anthropic"], [/^DEEPGRAM_/, "deepgram"],
  [/^ELEVENLABS_/, "elevenlabs"], [/^OPENAI_/, "openai"], [/^GEMINI_/, "gemini"],
  [/^FIREBASE_/, "firebase"], [/^AWS_/, "aws"], [/^BEDROCK_/, "aws-bedrock"],
];

/** Merges corroborating evidence across files and languages into provider clusters. */
export function buildProviderEvidenceClusters(evidence: IntegrationEvidence[]): ProviderEvidenceCluster[] {
  const clusters = new Map<string, IntegrationEvidence[]>();
  for (const item of evidence) {
    const provider = providerFromEvidence(item);
    if (!provider) continue;
    const cluster = clusters.get(provider) ?? [];
    cluster.push(item);
    clusters.set(provider, cluster);
  }
  return [...clusters.entries()]
    .map(([provider, items]) => ({ provider, evidence: deduplicate(items) }))
    .sort((a, b) => score(b.evidence) - score(a.evidence));
}

function providerFromEvidence(item: IntegrationEvidence): string | null {
  if (item.kind === "sdk_construction" || item.kind === "service_call") return item.value;
  if (item.kind === "sdk_import") {
    const catalog = findCatalogByPackage(item.value);
    if (catalog) return catalog.name;
    const normalized = normalizeProviderFromEvidence(item.value, [{ kind: "sdk_import", value: item.value }]);
    return normalized === item.value ? packageStem(item.value) : normalized;
  }
  if (item.kind === "http_request" || item.kind === "websocket_api") {
    const catalog = findCatalogByHost(item.value.replace(/^wss?:/, "https:"));
    if (catalog) return catalog.name;
    try { return packageStem(new URL(item.value).hostname); } catch { return null; }
  }
  if (item.kind === "environment_variable") return ENV_PREFIXES.find(([pattern]) => pattern.test(item.value))?.[1] ?? null;
  return null;
}

function packageStem(value: string): string {
  return value.replace(/^@[^/]+\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function score(evidence: IntegrationEvidence[]): number {
  const kinds = new Set(evidence.map((item) => item.kind));
  return Math.min(evidence.length, 3) + (kinds.has("http_request") || kinds.has("websocket_api") ? 10 : 0) + (kinds.has("sdk_construction") || kinds.has("service_call") ? 8 : 0) + (kinds.has("sdk_import") ? 4 : 0);
}

function deduplicate(evidence: IntegrationEvidence[]): IntegrationEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.file}:${item.line}:${item.kind}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
