import { ApiUsage } from "./types.js";
import {
  buildPathRegexes,
  matchesAnyPath,
  extractEndpoint,
  getSurrounding,
  dedup,
  resolveFiles,
  readFileContent,
  trackUrlVariables,
  lineUsesTrackedVar,
  joinContinuationLines,
} from "./utils.js";

const PY_IGNORE = [
  "**/venv/**",
  "**/.venv/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/__pycache__/**",
];

const PYTHON_HTTP_PATTERNS = [
  /requests\.(get|post|put|patch|delete|head|options)\s*\(/,
  /httpx\.(get|post|put|patch|delete|head|options)\s*\(/,
  /client\.(get|post|put|patch|delete|head|options)\s*\(/,
  /session\.(get|post|put|patch|delete|head|options)\s*\(/,
  /aiohttp\.ClientSession\(\)/,
  /\.request\s*\(\s*["'](GET|POST|PUT|PATCH|DELETE)/,
  /urllib\.request\.urlopen\s*\(/,
  /fetch\s*\(/,
];

/** Matches `await session.get(...)`, `self.client.post(...)`, etc. */
const PYTHON_WRAPPER_PATTERNS = [
  /self\.\w+\.(get|post|put|patch|delete|head|options)\s*\(/,
  /await\s+\w+\.(get|post|put|patch|delete)\s*\(/,
  /api_client\.(get|post|put|patch|delete)\s*\(/,
  /self\._?request\s*\(/,
  /self\._?(get|post|put|patch|delete)\s*\(/,
];

const ALL_HTTP_PATTERNS = [...PYTHON_HTTP_PATTERNS, ...PYTHON_WRAPPER_PATTERNS];

/**
 * Matches Python variable assignments containing URL strings:
 *   url = "https://..."
 *   base_url = f"https://..."
 *   ENDPOINT = '/v1/users'
 */
const PY_ASSIGNMENT = /^\s*(\w+)\s*=\s*[f]?["'`](.+?)["'`]/;

export async function scanPythonForApiUsages(
  scanPaths: string[],
  apiPathPatterns: string[],
): Promise<ApiUsage[]> {
  const usages: ApiUsage[] = [];
  const pyFiles = await resolveFiles(scanPaths, /\.py$/, PY_IGNORE);
  if (pyFiles.length === 0) return usages;

  const pathRegexes = buildPathRegexes(apiPathPatterns);

  for (const filePath of pyFiles) {
    const { lines } = await readFileContent(filePath);
    const logicalLines = joinPythonLines(lines);
    const trackedVars = trackUrlVariables(lines, pathRegexes, PY_ASSIGNMENT);
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track triple-quote block comments (docstrings used as comments)
      if (/^("""|''')/.test(trimmed) && !inBlockComment) {
        if (!trimmed.slice(3).includes(trimmed.slice(0, 3))) {
          inBlockComment = true;
        }
        continue;
      }
      if (inBlockComment) {
        if (/"""|'''/.test(trimmed)) inBlockComment = false;
        continue;
      }

      if (isPythonComment(trimmed)) continue;

      if (isPythonHttpCall(line)) {
        const surroundingCode = getSurrounding(lines, i, 5);
        if (matchesAnyPath(surroundingCode, pathRegexes)) {
          usages.push({
            filePath,
            line: i + 1,
            column: 0,
            snippet: trimmed.slice(0, 200),
            context: surroundingCode,
            endpointHint: extractEndpoint(surroundingCode, pathRegexes),
            methodHint: extractHttpMethod(line),
          });
          continue;
        }

        const usedVar = lineUsesTrackedVar(line, trackedVars);
        if (usedVar) {
          const varInfo = trackedVars.get(usedVar)!;
          usages.push({
            filePath,
            line: i + 1,
            column: 0,
            snippet: trimmed.slice(0, 200),
            context: getSurrounding(lines, i, 5),
            endpointHint: extractEndpoint(varInfo.value, pathRegexes),
            methodHint: extractHttpMethod(line),
          });
          continue;
        }
      }

      // Check for f-string interpolation containing API paths
      if (/f["']/.test(line) && matchesAnyPath(line, pathRegexes)) {
        if (!usages.some((u) => u.filePath === filePath && u.line === i + 1)) {
          usages.push({
            filePath,
            line: i + 1,
            column: 0,
            snippet: trimmed.slice(0, 200),
            context: getSurrounding(lines, i, 5),
            endpointHint: extractEndpoint(line, pathRegexes),
          });
          continue;
        }
      }

      // Direct string match (not in a comment, already filtered above)
      if (matchesAnyPath(line, pathRegexes)) {
        if (!usages.some((u) => u.filePath === filePath && u.line === i + 1)) {
          usages.push({
            filePath,
            line: i + 1,
            column: 0,
            snippet: trimmed.slice(0, 200),
            context: getSurrounding(lines, i, 5),
            endpointHint: extractEndpoint(line, pathRegexes),
          });
        }
      }
    }

    // Second pass: check logical (multi-line) statements for variable usage
    for (const logical of logicalLines) {
      if (isPythonHttpCall(logical.text)) {
        const usedVar = lineUsesTrackedVar(logical.text, trackedVars);
        if (usedVar && !usages.some((u) => u.filePath === filePath && u.line === logical.startLine + 1)) {
          const varInfo = trackedVars.get(usedVar)!;
          usages.push({
            filePath,
            line: logical.startLine + 1,
            column: 0,
            snippet: logical.text.trim().slice(0, 200),
            context: getSurrounding(lines, logical.startLine, 5),
            endpointHint: extractEndpoint(varInfo.value, pathRegexes),
            methodHint: extractHttpMethod(logical.text),
          });
        }
      }
    }
  }

  return dedup(usages);
}

function isPythonComment(trimmedLine: string): boolean {
  return trimmedLine.startsWith("#");
}

function isPythonHttpCall(line: string): boolean {
  return ALL_HTTP_PATTERNS.some((p) => p.test(line));
}

function extractHttpMethod(line: string): string | undefined {
  const match = line.match(/\.(get|post|put|patch|delete|head|options)\s*\(/i);
  if (match) return match[1].toUpperCase();

  const reqMatch = line.match(/["'](GET|POST|PUT|PATCH|DELETE)["']/);
  if (reqMatch) return reqMatch[1];

  return undefined;
}

/**
 * Joins Python continuation lines (backslash continuations and
 * unclosed parentheses).
 */
function joinPythonLines(
  lines: string[],
): Array<{ text: string; startLine: number; endLine: number }> {
  const logical: Array<{ text: string; startLine: number; endLine: number }> = [];
  let current = "";
  let startLine = 0;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (current === "") {
      current = line;
      startLine = i;
      parenDepth = countParenDelta(line);
    } else {
      current += " " + trimmed;
      parenDepth += countParenDelta(line);
    }

    const prevEndsWithBackslash = lines[i]?.trimEnd().endsWith("\\");
    if (!prevEndsWithBackslash && parenDepth <= 0) {
      logical.push({ text: current, startLine, endLine: i });
      current = "";
      parenDepth = 0;
    }
  }

  if (current !== "") {
    logical.push({ text: current, startLine, endLine: lines.length - 1 });
  }

  return logical;
}

function countParenDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "(" || ch === "[") delta++;
    else if (ch === ")" || ch === "]") delta--;
  }
  return delta;
}
