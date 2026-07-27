import { readFile } from "fs/promises";
import { LlmProvider } from "../providers/index.js";
import { DiffResult, ApiChange } from "../differ/index.js";
import { ApiUsage } from "../scanner/index.js";

export interface HealResult {
  apiName: string;
  changes: ApiChange[];
  patches: FilePatch[];
  summary: string;
}

export interface FilePatch {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  description: string;
}

export class HealError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_JSON_RESPONSE" | "INVALID_JSON" | "PROVIDER_ERROR" | "NO_VALID_PATCHES",
    public readonly rawResponse?: string,
  ) {
    super(message);
    this.name = "HealError";
  }
}

const SYSTEM_PROMPT = `You are an expert API migration assistant. Your job is to update user code when an API they depend on changes.

You will receive:
1. A description of API changes (breaking changes, field renames, type changes, etc.)
2. The user's source code files that use the affected endpoints

Your response must be a JSON array of file patches. For each affected file, provide:
{
  "filePath": "path/to/file.ts",
  "description": "Brief explanation of what changed",
  "replacements": [
    {
      "search": "exact string to find in the file",
      "replace": "replacement string"
    }
  ]
}

Rules:
- ONLY modify code that is directly affected by the API changes
- Keep the user's coding style (quotes, semicolons, indentation)
- The "search" string must exactly match what's in the file
- Be conservative — don't refactor unrelated code
- If unsure about a change, add a TODO comment instead of guessing
- Return valid JSON only, no markdown fences`;

export async function healCode(
  diffResult: DiffResult,
  usages: ApiUsage[],
  provider: LlmProvider,
): Promise<HealResult> {
  if (diffResult.changes.length === 0 || usages.length === 0) {
    return {
      apiName: diffResult.apiName,
      changes: diffResult.changes,
      patches: [],
      summary: "No changes require code updates.",
    };
  }

  const fileContents = await loadAffectedFiles(usages);

  const prompt = buildPrompt(diffResult, usages, fileContents);

  let response: string;
  try {
    response = await provider.generate(prompt, SYSTEM_PROMPT);
  } catch (err) {
    throw new HealError(
      `AI provider failed: ${err instanceof Error ? err.message : String(err)}`,
      "PROVIDER_ERROR",
    );
  }

  const { patches, warnings } = parseResponse(response, fileContents);

  const summary = buildSummary(diffResult, patches, warnings);

  return {
    apiName: diffResult.apiName,
    changes: diffResult.changes,
    patches,
    summary,
  };
}

async function loadAffectedFiles(
  usages: ApiUsage[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const uniquePaths = [...new Set(usages.map((u) => u.filePath))];

  for (const filePath of uniquePaths) {
    const content = await readFile(filePath, "utf-8");
    files.set(filePath, content);
  }

  return files;
}

function buildPrompt(
  diffResult: DiffResult,
  usages: ApiUsage[],
  fileContents: Map<string, string>,
): string {
  const changesSection = diffResult.changes
    .map(
      (c) =>
        `- [${c.severity.toUpperCase()}] ${c.description}${c.field ? ` (field: ${c.field})` : ""}`,
    )
    .join("\n");

  const usagesByFile = new Map<string, ApiUsage[]>();
  for (const u of usages) {
    const list = usagesByFile.get(u.filePath) ?? [];
    list.push(u);
    usagesByFile.set(u.filePath, list);
  }

  const filesSection = [...usagesByFile.entries()]
    .map(([filePath, fileUsages]) => {
      const content = fileContents.get(filePath) ?? "";
      const usageLines = fileUsages
        .map((u) => `  - Line ${u.line}: ${u.snippet}`)
        .join("\n");
      return `### ${filePath}\nAPI usages found:\n${usageLines}\n\nFull file content:\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");

  return `## API Changes for "${diffResult.apiName}"

Version: ${diffResult.oldVersion ?? "unknown"} → ${diffResult.newVersion ?? "unknown"}

### Changes detected:
${changesSection}

## Affected files in the user's codebase:

${filesSection}

Generate the JSON patches to update these files for the API changes. Only modify what's necessary.`;
}

interface LlmReplacement {
  search: string;
  replace: string;
}

interface LlmFilePatch {
  filePath: string;
  description: string;
  replacements: LlmReplacement[];
}

interface ParseResult {
  patches: FilePatch[];
  warnings: string[];
}

function parseResponse(
  response: string,
  fileContents: Map<string, string>,
): ParseResult {
  const warnings: string[] = [];

  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    warnings.push("AI response did not contain a JSON array. The model may have returned an explanation instead of patches.");
    return { patches: [], warnings };
  }

  let parsed: LlmFilePatch[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as LlmFilePatch[];
  } catch (err) {
    warnings.push(`AI response contained malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { patches: [], warnings };
  }

  if (!Array.isArray(parsed)) {
    warnings.push("AI response JSON was not an array as expected.");
    return { patches: [], warnings };
  }

  const patches: FilePatch[] = [];

  for (const entry of parsed) {
    const originalContent = fileContents.get(entry.filePath);
    if (!originalContent) {
      warnings.push(`AI suggested patch for unknown file: ${entry.filePath}`);
      continue;
    }

    let patchedContent = originalContent;
    let appliedCount = 0;
    let skippedCount = 0;

    for (const replacement of entry.replacements ?? []) {
      if (
        replacement.search &&
        replacement.replace !== undefined &&
        patchedContent.includes(replacement.search)
      ) {
        patchedContent = patchedContent.replace(
          replacement.search,
          replacement.replace,
        );
        appliedCount++;
      } else if (replacement.search && !patchedContent.includes(replacement.search)) {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      warnings.push(`${entry.filePath}: ${skippedCount} replacement(s) skipped — search string not found in file`);
    }

    if (patchedContent !== originalContent) {
      patches.push({
        filePath: entry.filePath,
        originalContent,
        patchedContent,
        description: entry.description ?? "API migration update",
      });
    }
  }

  if (patches.length === 0 && parsed.length > 0) {
    warnings.push("AI generated patches but none could be applied — search strings may not match the current file contents.");
  }

  return { patches, warnings };
}

function buildSummary(diffResult: DiffResult, patches: FilePatch[], warnings: string[] = []): string {
  const lines: string[] = [
    `API: ${diffResult.apiName}`,
    `Breaking changes: ${diffResult.breakingCount}`,
    `Non-breaking changes: ${diffResult.nonBreakingCount}`,
    `Files patched: ${patches.length}`,
    "",
  ];

  for (const patch of patches) {
    lines.push(`  ${patch.filePath}: ${patch.description}`);
  }

  if (warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const w of warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  return lines.join("\n");
}
