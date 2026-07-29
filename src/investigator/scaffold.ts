import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export interface VerificationScaffold {
  summary: string;
  safety: "read_only" | "test_account_required" | "manual_only";
  requiredEnv: string[];
  targetFile: string;
  testCommand: string;
  citedEvidence: Array<{ file: string; line: number; kind: string; value: string }>;
  steps: string[];
  draft: string;
}

export function parseVerificationScaffold(response: string, evidence: Array<{ file: string; line: number; kind: string; value: string }>): VerificationScaffold | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Partial<VerificationScaffold>;
    if (!value.summary || !value.safety || !["read_only", "test_account_required", "manual_only"].includes(value.safety) || !Array.isArray(value.requiredEnv) || !Array.isArray(value.citedEvidence) || !Array.isArray(value.steps) || typeof value.targetFile !== "string" || typeof value.testCommand !== "string" || typeof value.draft !== "string") return null;
    const locations = new Set(evidence.map((item) => `${item.file}:${item.line}:${item.kind}:${item.value}`));
    if (!value.citedEvidence.every((item) => locations.has(`${item.file}:${item.line}:${item.kind}:${item.value}`))) return null;
    return {
      summary: value.summary,
      safety: value.safety,
      requiredEnv: value.requiredEnv.filter((item): item is string => typeof item === "string"),
      targetFile: value.targetFile,
      testCommand: value.testCommand,
      citedEvidence: value.citedEvidence,
      steps: value.steps.filter((item): item is string => typeof item === "string"),
      draft: value.draft,
    };
  } catch { return null; }
}

export async function saveVerificationScaffold(dir: string, apiName: string, scaffold: VerificationScaffold): Promise<string> {
  const path = join(dir, ".contractbot", "reviews", `verification-${apiName}.json`);
  await mkdir(join(dir, ".contractbot", "reviews"), { recursive: true });
  await writeFile(path, JSON.stringify({ createdAt: new Date().toISOString(), scaffold }, null, 2) + "\n", "utf-8");
  return path;
}
