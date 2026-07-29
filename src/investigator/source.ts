export interface SourceRecommendation {
  contract: "openapi" | "sdk_package" | "changelog" | "unknown";
  source?: string;
  trust: "catalog" | "ai_candidate";
  rationale: string;
}

export function parseSourceRecommendation(response: string): SourceRecommendation | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Partial<SourceRecommendation>;
    if (!value.contract || !["openapi", "sdk_package", "changelog", "unknown"].includes(value.contract) || typeof value.rationale !== "string") return null;
    return { contract: value.contract, source: typeof value.source === "string" ? value.source : undefined, trust: "ai_candidate", rationale: value.rationale };
  } catch { return null; }
}
