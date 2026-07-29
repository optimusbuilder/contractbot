import { loadConfig } from "../../config/loader.js";
import { getChangeSet } from "../../differ/index.js";
import { scanAllLanguages } from "../../scanner/index.js";
import { createProvider } from "../../providers/index.js";

interface InvestigateOptions { config: string }

interface Investigation {
  summary: string;
  relevance: "high" | "medium" | "low" | "unknown";
  affectedUsages: Array<{ file: string; line: number; reason: string }>;
  verificationCoverage: "covered" | "partial" | "missing" | "unknown";
  recommendedActions: string[];
}

export async function investigateCommand(apiName: string, options: InvestigateOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const api = config.apis.find((entry) => entry.name === apiName);
  if (!api) throw new Error(`API not found in config: ${apiName}`);
  const changeSet = await getChangeSet(apiName);
  if (!changeSet) throw new Error(`No pending change-set for ${apiName}. Run contractbot ci first.`);

  const usages = await scanAllLanguages(api.scan_paths, Object.keys(changeSet.nextSpec.paths ?? {}), api.languages);
  const evidence = usages.map((usage) => ({ file: usage.filePath, line: usage.line, snippet: usage.snippet }));
  const provider = createProvider(config.ai);
  const prompt = `Investigate a confirmed external API contract change. Return JSON only: {"summary":"...","relevance":"high|medium|low|unknown","affectedUsages":[{"file":"exact supplied file","line":number,"reason":"..."}],"verificationCoverage":"covered|partial|missing|unknown","recommendedActions":["..."]}. Do not propose code patches. Do not invent files, line numbers, API behavior, or verification results.\n\nContract changes: ${JSON.stringify(changeSet.diff.changes)}\nConfigured verification: ${api.verify?.command ?? "none"}\nDeterministic local usage evidence: ${JSON.stringify(evidence)}`;
  const response = await provider.generate(prompt, "You are an API compatibility investigator. Cite only supplied evidence and separate confirmed facts from uncertainty.");
  console.log(JSON.stringify(parseInvestigation(response, evidence), null, 2));
}

export function parseInvestigation(response: string, evidence: Array<{ file: string; line: number }>): Investigation {
  const fallback: Investigation = { summary: "AI investigation did not return valid structured evidence.", relevance: "unknown", affectedUsages: [], verificationCoverage: "unknown", recommendedActions: [] };
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const value = JSON.parse(match[0]) as Partial<Investigation>;
    if (!value.summary || !["high", "medium", "low", "unknown"].includes(value.relevance ?? "") || !["covered", "partial", "missing", "unknown"].includes(value.verificationCoverage ?? "") || !Array.isArray(value.affectedUsages) || !Array.isArray(value.recommendedActions)) return fallback;
    const validLocations = new Set(evidence.map((item) => `${item.file}:${item.line}`));
    const affectedUsages = value.affectedUsages.filter((item) => validLocations.has(`${item.file}:${item.line}`));
    return { summary: value.summary, relevance: value.relevance!, affectedUsages, verificationCoverage: value.verificationCoverage!, recommendedActions: value.recommendedActions.filter((item): item is string => typeof item === "string") };
  } catch { return fallback; }
}
