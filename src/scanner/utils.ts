import { readFile } from "fs/promises";
import { glob } from "glob";
import { ApiUsage } from "./types.js";

export function buildPathRegexes(apiPathPatterns: string[]): RegExp[] {
  return apiPathPatterns.map(
    (p) => new RegExp(p.replace(/\{[^}]+\}/g, "[^/]+")),
  );
}

export function matchesAnyPath(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function extractEndpoint(
  text: string,
  patterns: RegExp[],
): string | undefined {
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[0];
  }
  return undefined;
}

export function getSurrounding(
  lines: string[],
  index: number,
  radius: number,
): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join("\n");
}

export function dedup(usages: ApiUsage[]): ApiUsage[] {
  const seen = new Set<string>();
  return usages.filter((u) => {
    const key = `${u.filePath}:${u.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveFiles(
  scanPaths: string[],
  extension: RegExp,
  ignorePatterns: string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of scanPaths) {
    const matched = await glob(pattern, {
      nodir: true,
      ignore: ignorePatterns,
    });
    files.push(...matched);
  }
  return files.filter((f) => extension.test(f));
}

export async function readFileContent(
  filePath: string,
): Promise<{ content: string; lines: string[] }> {
  const content = await readFile(filePath, "utf-8");
  return { content, lines: content.split("\n") };
}

/**
 * Tracks simple variable assignments like:
 *   url = "https://api.example.com/v1/users"
 *   BASE_URL = "/v1/users"
 *   const endpoint = `/v1/orders/${id}`
 *
 * Returns a map of variable name → line index where it was assigned,
 * only for variables whose assigned value matches an API path pattern.
 */
export function trackUrlVariables(
  lines: string[],
  pathRegexes: RegExp[],
  assignmentPattern: RegExp,
): Map<string, { lineIndex: number; value: string }> {
  const vars = new Map<string, { lineIndex: number; value: string }>();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(assignmentPattern);
    if (!match) continue;

    const varName = match[1];
    const value = match[2];
    if (varName && value && matchesAnyPath(value, pathRegexes)) {
      vars.set(varName, { lineIndex: i, value });
    }
  }

  return vars;
}

/**
 * Checks if a variable known to hold a URL is used on a given line.
 */
export function lineUsesTrackedVar(
  line: string,
  trackedVars: Map<string, { lineIndex: number; value: string }>,
): string | undefined {
  for (const [varName] of trackedVars) {
    if (varName.length < 2) continue;
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(line)) {
      return varName;
    }
  }
  return undefined;
}

/**
 * Joins continuation lines for languages that use backslash or
 * implicit continuation (open parens). Returns logical lines.
 */
export function joinContinuationLines(
  lines: string[],
  isContinuation: (current: string, prev: string) => boolean,
): Array<{ text: string; startLine: number; endLine: number }> {
  const logical: Array<{ text: string; startLine: number; endLine: number }> = [];
  let current = "";
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (current === "") {
      current = lines[i];
      startLine = i;
    } else if (isContinuation(lines[i], current)) {
      current += " " + lines[i].trim();
    } else {
      logical.push({ text: current, startLine, endLine: i - 1 });
      current = lines[i];
      startLine = i;
    }
  }

  if (current !== "") {
    logical.push({ text: current, startLine, endLine: lines.length - 1 });
  }

  return logical;
}
