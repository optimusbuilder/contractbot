import { findCatalogByHost, findCatalogByPackage } from "../detector/registry.js";

interface Citation { kind?: string; value?: string }

const SDK_PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/^@aws-sdk\/client-bedrock(?:-|$)/, "aws-bedrock"],
  [/^@browserbasehq\/sdk$/, "browserbase"],
  [/^@langchain\/google-genai$/, "gemini"],
];

/** Maps cited SDK/host evidence to a stable provider identity when possible. */
export function normalizeProviderFromEvidence(proposed: string, citations: Citation[]): string {
  for (const citation of citations) {
    if (citation.kind === "sdk_import" && citation.value) {
      const catalog = findCatalogByPackage(citation.value);
      if (catalog) return catalog.name;
      const pattern = SDK_PROVIDER_PATTERNS.find(([regex]) => regex.test(citation.value!));
      if (pattern) return pattern[1];
    }
    if ((citation.kind === "http_request" || citation.kind === "websocket_api") && citation.value) {
      const catalog = findCatalogByHost(citation.value);
      if (catalog) return catalog.name;
    }
  }
  return proposed;
}
