import { execSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { FilePatch, HealResult } from "./healer.js";
import { LlmProvider } from "../providers/index.js";
import { DiffResult } from "../differ/types.js";
import { ApiUsage } from "../scanner/index.js";

export interface ValidationResult {
  passed: boolean;
  typecheckPassed: boolean;
  testsPassed: boolean;
  typecheckErrors?: string;
  testErrors?: string;
}

export interface ValidatedHealResult extends HealResult {
  validation: ValidationResult;
  retryCount: number;
}

/**
 * Validates a heal result by:
 * 1. Applying patches to temp copies
 * 2. Running typecheck (tsc --noEmit)
 * 3. Running the project's test suite
 * 4. If failed, retrying with error context
 */
export async function validateAndHeal(
  diffResult: DiffResult,
  usages: ApiUsage[],
  provider: LlmProvider,
  healFn: (diff: DiffResult, usages: ApiUsage[], provider: LlmProvider) => Promise<HealResult>,
  options: { maxRetries?: number; testCommand?: string; typecheckCommand?: string } = {},
): Promise<ValidatedHealResult> {
  const maxRetries = options.maxRetries ?? 2;
  const testCmd = options.testCommand ?? detectTestCommand();
  const typecheckCmd = options.typecheckCommand ?? detectTypecheckCommand();

  let healResult = await healFn(diffResult, usages, provider);
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (healResult.patches.length === 0) {
      return {
        ...healResult,
        validation: { passed: true, typecheckPassed: true, testsPassed: true },
        retryCount: 0,
      };
    }

    const validation = await runValidation(healResult.patches, typecheckCmd, testCmd);

    if (validation.passed) {
      return { ...healResult, validation, retryCount };
    }

    if (attempt === maxRetries) {
      return { ...healResult, validation, retryCount };
    }

    retryCount++;
    healResult = await retryWithErrors(
      diffResult,
      usages,
      provider,
      healResult,
      validation,
    );
  }

  return {
    ...healResult,
    validation: { passed: false, typecheckPassed: false, testsPassed: false },
    retryCount,
  };
}

async function runValidation(
  patches: FilePatch[],
  typecheckCmd: string | null,
  testCmd: string | null,
): Promise<ValidationResult> {
  const originals = new Map<string, string>();

  try {
    for (const patch of patches) {
      if (existsSync(patch.filePath)) {
        originals.set(patch.filePath, await readFile(patch.filePath, "utf-8"));
      }
      await writeFile(patch.filePath, patch.patchedContent, "utf-8");
    }

    let typecheckPassed = true;
    let typecheckErrors: string | undefined;

    if (typecheckCmd) {
      const tscResult = runCommand(typecheckCmd);
      typecheckPassed = tscResult.success;
      if (!tscResult.success) {
        typecheckErrors = tscResult.output;
      }
    }

    let testsPassed = true;
    let testErrors: string | undefined;

    if (testCmd) {
      const testResult = runCommand(testCmd);
      testsPassed = testResult.success;
      if (!testResult.success) {
        testErrors = testResult.output;
      }
    }

    return {
      passed: typecheckPassed && testsPassed,
      typecheckPassed,
      testsPassed,
      typecheckErrors,
      testErrors,
    };
  } finally {
    for (const [path, content] of originals) {
      await writeFile(path, content, "utf-8");
    }
  }
}

async function retryWithErrors(
  diffResult: DiffResult,
  usages: ApiUsage[],
  provider: LlmProvider,
  previousResult: HealResult,
  validation: ValidationResult,
): Promise<HealResult> {
  const errorContext = buildErrorContext(validation);
  const retryPrompt = buildRetryPrompt(diffResult, previousResult, errorContext);

  const RETRY_SYSTEM = `You are an expert API migration assistant. A previous attempt at generating patches produced code that failed validation. Fix the issues while still addressing the original API changes.

Your response must be a JSON array of file patches with the same format:
{
  "filePath": "path/to/file.ts",
  "description": "Brief explanation",
  "replacements": [{ "search": "exact string", "replace": "replacement" }]
}

Rules:
- Fix the validation errors while still addressing the API changes
- Keep the user's coding style
- Return valid JSON only, no markdown fences`;

  const response = await provider.generate(retryPrompt, RETRY_SYSTEM);

  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return previousResult;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      filePath: string;
      description: string;
      replacements: Array<{ search: string; replace: string }>;
    }>;

    const patches: FilePatch[] = [];
    for (const entry of parsed) {
      const original = previousResult.patches.find(
        (p) => p.filePath === entry.filePath,
      );
      const baseContent = original?.originalContent;
      if (!baseContent) continue;

      let patched = baseContent;
      for (const r of entry.replacements ?? []) {
        if (r.search && r.replace !== undefined && patched.includes(r.search)) {
          patched = patched.replace(r.search, r.replace);
        }
      }

      if (patched !== baseContent) {
        patches.push({
          filePath: entry.filePath,
          originalContent: baseContent,
          patchedContent: patched,
          description: entry.description ?? "Retry fix",
        });
      }
    }

    return { ...previousResult, patches };
  } catch {
    return previousResult;
  }
}

function buildErrorContext(validation: ValidationResult): string {
  const parts: string[] = [];
  if (validation.typecheckErrors) {
    parts.push(`TypeScript errors:\n${validation.typecheckErrors.slice(0, 2000)}`);
  }
  if (validation.testErrors) {
    parts.push(`Test failures:\n${validation.testErrors.slice(0, 2000)}`);
  }
  return parts.join("\n\n");
}

function buildRetryPrompt(
  diffResult: DiffResult,
  previousResult: HealResult,
  errorContext: string,
): string {
  const patchDescriptions = previousResult.patches
    .map((p) => `- ${p.filePath}: ${p.description}`)
    .join("\n");

  return `## Retry: Fix validation errors

The previous patches for API "${diffResult.apiName}" failed validation.

### Previous patches generated:
${patchDescriptions}

### Validation errors:
${errorContext}

### Original API changes:
${diffResult.changes.map((c) => `- [${c.severity}] ${c.description}`).join("\n")}

Please regenerate the patches, fixing the validation errors while still addressing the API changes. Return the complete corrected patches.`;
}

function runCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output };
  } catch (err: any) {
    const output = (err.stdout ?? "") + (err.stderr ?? "");
    return { success: false, output: output.slice(0, 3000) };
  }
}

function detectTestCommand(): string | null {
  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(
        require("fs").readFileSync("package.json", "utf-8"),
      );
      if (pkg.scripts?.test) return "npm test";
    } catch {}
  }
  if (existsSync("pytest.ini") || existsSync("pyproject.toml")) return "pytest --tb=short -q";
  if (existsSync("go.mod")) return "go test ./...";
  if (existsSync("Gemfile")) return "bundle exec rspec";
  return null;
}

function detectTypecheckCommand(): string | null {
  if (existsSync("tsconfig.json")) return "npx tsc --noEmit";
  if (existsSync("pyproject.toml")) return "mypy .";
  return null;
}
