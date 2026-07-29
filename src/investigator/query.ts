import { EvidenceKind, IntegrationEvidence } from "./evidence.js";

export interface EvidenceQuery {
  term: string;
  kind?: EvidenceKind;
}

/** Searches only the already-built evidence graph; it never reads arbitrary files. */
export function queryIntegrationEvidence(
  evidence: IntegrationEvidence[],
  query: EvidenceQuery,
  limit = 8,
): IntegrationEvidence[] {
  const term = query.term.trim().toLowerCase();
  if (!term) return [];
  return evidence.filter((item) =>
    (!query.kind || item.kind === query.kind) &&
    (item.value.toLowerCase().includes(term) || item.context.toLowerCase().includes(term)),
  ).slice(0, limit);
}

export function parseEvidenceQueries(response: string, knownValues: Set<string>): EvidenceQuery[] {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const value = JSON.parse(match[0]) as { queries?: unknown };
    if (!Array.isArray(value.queries)) return [];
    const kinds = new Set<EvidenceKind>(["sdk_import", "sdk_construction", "service_call", "environment_variable", "http_request", "websocket_api", "browser_navigation", "static_asset", "oauth_identity", "unknown_url"]);
    return value.queries.filter((item): item is EvidenceQuery => {
      if (!item || typeof item !== "object") return false;
      const query = item as Partial<EvidenceQuery>;
      return typeof query.term === "string" && knownValues.has(query.term) && (query.kind === undefined || kinds.has(query.kind));
    }).slice(0, 8);
  } catch { return []; }
}
