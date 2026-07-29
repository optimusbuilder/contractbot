import { mkdir, readFile, writeFile } from "fs/promises";
import { join, relative } from "path";
import { glob } from "glob";

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

export interface TestRepositoryProfile {
  frameworks: string[];
  testCommands: string[];
  installedPackages: string[];
  existingTests: Array<{ file: string; excerpt: string }>;
}

const FRAMEWORK_MARKERS: Record<string, RegExp> = {
  vitest: /(?:from\s+["']vitest["']|require\(["']vitest["']\))/, jest: /(?:from\s+["']@jest\/globals["']|require\(["'](?:jest|@jest\/globals)["']\)|\bjest\.)/,
  pytest: /(?:import\s+pytest|from\s+pytest\s+import)/, flutter_test: /package:test\/test\.dart/,
};

export async function inspectTestRepository(projectDir: string): Promise<TestRepositoryProfile> {
  const manifests = await glob(["**/package.json", "**/pyproject.toml", "**/pytest.ini", "**/pubspec.yaml"], { cwd: projectDir, absolute: true, nodir: true, ignore: ["**/node_modules/**", "**/.git/**"] });
  const installedPackages = new Set<string>();
  const testCommands = new Set<string>();
  const frameworks = new Set<string>();
  for (const manifest of manifests) {
    const text = await readFile(manifest, "utf-8");
    if (manifest.endsWith("package.json")) {
      try {
        const value = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
        for (const dependency of Object.keys({ ...value.dependencies, ...value.devDependencies })) installedPackages.add(dependency);
        for (const [name, script] of Object.entries(value.scripts ?? {})) if (/^(test|test:)/.test(name)) testCommands.add(`npm run ${name}`);
        if (value.scripts?.test) testCommands.add("npm test");
        if (installedPackages.has("vitest") || Object.values(value.scripts ?? {}).some((script) => /\bvitest\b/.test(script))) frameworks.add("vitest");
        if (installedPackages.has("jest") || Object.values(value.scripts ?? {}).some((script) => /\bjest\b/.test(script))) frameworks.add("jest");
      } catch { /* Invalid manifests are not evidence. */ }
    }
    if (manifest.endsWith("pyproject.toml") || manifest.endsWith("pytest.ini")) {
      if (/pytest/.test(text)) frameworks.add("pytest");
      testCommands.add("pytest");
    }
    if (manifest.endsWith("pubspec.yaml") && /flutter/.test(text)) {
      frameworks.add("flutter_test");
      testCommands.add("flutter test");
    }
  }
  const files = await glob(["tests/**/*", "__tests__/**/*", "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py,dart}"], { cwd: projectDir, absolute: true, nodir: true, ignore: ["**/node_modules/**", "**/.git/**"] });
  const existingTests = await Promise.all(files.slice(0, 8).map(async (file) => ({ file: relative(projectDir, file), excerpt: (await readFile(file, "utf-8")).slice(0, 1200) })));
  return { frameworks: [...frameworks], testCommands: [...testCommands], installedPackages: [...installedPackages], existingTests };
}

export function parseVerificationScaffold(response: string, evidence: Array<{ file: string; line: number; kind: string; value: string }>, profile?: TestRepositoryProfile): VerificationScaffold | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Partial<VerificationScaffold>;
    if (!value.summary || !value.safety || !["read_only", "test_account_required", "manual_only"].includes(value.safety) || !Array.isArray(value.requiredEnv) || !Array.isArray(value.citedEvidence) || !Array.isArray(value.steps) || typeof value.targetFile !== "string" || typeof value.testCommand !== "string" || typeof value.draft !== "string") return null;
    const locations = new Set(evidence.map((item) => `${item.file}:${item.line}:${item.kind}:${item.value}`));
    if (!value.citedEvidence.every((item) => locations.has(`${item.file}:${item.line}:${item.kind}:${item.value}`))) return null;
    const scaffold = {
      summary: value.summary,
      safety: value.safety,
      requiredEnv: value.requiredEnv.filter((item): item is string => typeof item === "string"),
      targetFile: value.targetFile,
      testCommand: value.testCommand,
      citedEvidence: value.citedEvidence,
      steps: value.steps.filter((item): item is string => typeof item === "string"),
      draft: value.draft,
    };
    if (!profile || !isRepositorySafeScaffold(scaffold, evidence, profile)) return profile ? null : scaffold;
    return scaffold;
  } catch { return null; }
}

function isRepositorySafeScaffold(scaffold: VerificationScaffold, evidence: Array<{ file: string; line: number; kind: string; value: string }>, profile: TestRepositoryProfile): boolean {
  if (!isTestPath(scaffold.targetFile) || !profile.testCommands.includes(scaffold.testCommand)) return false;
  if (!profile.frameworks.some((framework) => FRAMEWORK_MARKERS[framework].test(scaffold.draft))) return false;
  if (externalImports(scaffold.draft).some((name) => !profile.installedPackages.includes(name))) return false;
  const sdkImports = evidence.filter((item) => item.kind === "sdk_import").map((item) => item.value);
  if (externalImports(scaffold.draft).some((name) => sdkImports.includes(name)) && !evidence.some((item) => item.kind === "sdk_construction" && scaffold.citedEvidence.some((citation) => sameEvidence(citation, item)))) return false;
  // Credentials or an unmocked provider-facing operation are never read-only.
  if (scaffold.safety === "read_only" && (scaffold.requiredEnv.length > 0 || !isFullyMocked(scaffold.draft))) return false;
  return true;
}

function sameEvidence(left: { file: string; line: number; kind: string; value: string }, right: { file: string; line: number; kind: string; value: string }): boolean {
  return left.file === right.file && left.line === right.line && left.kind === right.kind && left.value === right.value;
}

function isTestPath(path: string): boolean {
  return !path.startsWith("/") && !path.split(/[\\/]/).includes("..") && (/^(?:tests|__tests__)\//.test(path) || /\.(?:test|spec)\.[^/]+$/.test(path));
}

function externalImports(draft: string): string[] {
  const names = new Set<string>();
  for (const match of draft.matchAll(/(?:from\s+|require\()['"]([^'"]+)['"]/g)) {
    const name = match[1];
    if (!name.startsWith(".") && !name.startsWith("/") && !name.startsWith("node:")) names.add(name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]);
  }
  return [...names];
}

function isFullyMocked(draft: string): boolean {
  return /(?:vi\.mock|jest\.mock|mock\.patch|unittest\.mock|MockClient|MockTransport|mocktail)/.test(draft) && !/\b(?:fetch|generateContent|embedContent|createEmbedding|models\.generateContent)\s*\(/.test(draft);
}

export async function saveVerificationScaffold(dir: string, apiName: string, scaffold: VerificationScaffold): Promise<string> {
  const path = join(dir, ".contractbot", "reviews", `verification-${apiName}.json`);
  await mkdir(join(dir, ".contractbot", "reviews"), { recursive: true });
  await writeFile(path, JSON.stringify({ createdAt: new Date().toISOString(), scaffold }, null, 2) + "\n", "utf-8");
  return path;
}
