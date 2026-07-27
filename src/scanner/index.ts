import { glob } from "glob";
import { scanForApiUsages as scanTypeScript } from "./scanner.js";
import { scanPythonForApiUsages } from "./python.js";
import { scanGoForApiUsages } from "./go.js";
import { scanRubyForApiUsages } from "./ruby.js";
import { ApiUsage } from "./types.js";

export type { ApiUsage } from "./types.js";
export { scanForApiUsages } from "./scanner.js";
export { scanPythonForApiUsages } from "./python.js";
export { scanGoForApiUsages } from "./go.js";
export { scanRubyForApiUsages } from "./ruby.js";

export type ScanLanguage = "typescript" | "python" | "go" | "ruby" | "auto";

/**
 * Unified multi-language scanner. Detects the language(s) present
 * in the scan paths and dispatches to the appropriate scanner.
 */
export async function scanAllLanguages(
  scanPaths: string[],
  apiPathPatterns: string[],
  languages?: ScanLanguage[],
): Promise<ApiUsage[]> {
  const langs = languages ?? (await detectLanguages(scanPaths));
  const allUsages: ApiUsage[] = [];

  const scanners: Array<{
    lang: ScanLanguage;
    fn: (paths: string[], patterns: string[]) => Promise<ApiUsage[]>;
  }> = [
    { lang: "typescript", fn: scanTypeScript },
    { lang: "python", fn: scanPythonForApiUsages },
    { lang: "go", fn: scanGoForApiUsages },
    { lang: "ruby", fn: scanRubyForApiUsages },
  ];

  for (const scanner of scanners) {
    if (langs.includes(scanner.lang) || langs.includes("auto")) {
      const usages = await scanner.fn(scanPaths, apiPathPatterns);
      allUsages.push(...usages);
    }
  }

  return deduplicateUsages(allUsages);
}

async function detectLanguages(scanPaths: string[]): Promise<ScanLanguage[]> {
  const detected: Set<ScanLanguage> = new Set();

  for (const pattern of scanPaths) {
    const files = await glob(pattern, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/vendor/**", "**/venv/**"],
    });

    for (const file of files.slice(0, 100)) {
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) detected.add("typescript");
      if (/\.py$/.test(file)) detected.add("python");
      if (/\.go$/.test(file)) detected.add("go");
      if (/\.rb$/.test(file)) detected.add("ruby");
    }
  }

  return detected.size > 0 ? [...detected] : ["typescript"];
}

function deduplicateUsages(usages: ApiUsage[]): ApiUsage[] {
  const seen = new Set<string>();
  return usages.filter((u) => {
    const key = `${u.filePath}:${u.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
