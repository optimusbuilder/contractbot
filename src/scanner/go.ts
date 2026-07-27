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
} from "./utils.js";

const GO_IGNORE = ["**/vendor/**", "**/node_modules/**"];

const GO_HTTP_PATTERNS = [
  /http\.(Get|Post|Head|PostForm)\s*\(/,
  /http\.NewRequest\s*\(/,
  /client\.(Get|Post|Put|Patch|Delete|Do)\s*\(/,
  /\.SetResult\s*\(/,
  /resty\.New\(\)/,
  /\.R\(\)\.(Get|Post|Put|Patch|Delete)\s*\(/,
  /req\.(Get|Post|Put|Patch|Delete)\s*\(/,
];

const GO_WRAPPER_PATTERNS = [
  /\.\w+Client\.(Get|Post|Put|Patch|Delete)\s*\(/,
  /apiClient\.(Get|Post|Put|Patch|Delete|Do|Request)\s*\(/,
  /\.Do\s*\(\s*req\b/,
  /\.Do\s*\(\s*ctx\b/,
];

const ALL_HTTP_PATTERNS = [...GO_HTTP_PATTERNS, ...GO_WRAPPER_PATTERNS];

/**
 * Matches Go variable assignments:
 *   url := "https://..."
 *   var url = "https://..."
 *   endpoint := fmt.Sprintf("https://.../v1/users/%s", id)
 *   const baseURL = "/v1/users"
 */
const GO_ASSIGNMENT = /^\s*(?:var\s+)?(\w+)\s*:?=\s*(?:fmt\.Sprintf\s*\(\s*)?["'`](.+?)["'`]/;

export async function scanGoForApiUsages(
  scanPaths: string[],
  apiPathPatterns: string[],
): Promise<ApiUsage[]> {
  const usages: ApiUsage[] = [];
  const goFiles = await resolveFiles(scanPaths, /\.go$/, GO_IGNORE);
  if (goFiles.length === 0) return usages;

  const pathRegexes = buildPathRegexes(apiPathPatterns);

  for (const filePath of goFiles) {
    const { lines } = await readFileContent(filePath);
    const trackedVars = trackUrlVariables(lines, pathRegexes, GO_ASSIGNMENT);
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track /* */ block comments
      if (inBlockComment) {
        if (trimmed.includes("*/")) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith("/*")) {
        if (!trimmed.includes("*/")) inBlockComment = true;
        continue;
      }

      if (isGoComment(trimmed)) continue;

      // Check fmt.Sprintf calls that build URLs
      const sprintfMatch = line.match(/fmt\.Sprintf\s*\(\s*["'`](.+?)["'`]/);
      if (sprintfMatch && matchesAnyPath(sprintfMatch[1], pathRegexes)) {
        if (!usages.some((u) => u.filePath === filePath && u.line === i + 1)) {
          usages.push({
            filePath,
            line: i + 1,
            column: 0,
            snippet: trimmed.slice(0, 200),
            context: getSurrounding(lines, i, 5),
            endpointHint: extractEndpoint(sprintfMatch[1], pathRegexes),
          });
          continue;
        }
      }

      // Check string concatenation patterns: baseURL + "/users"
      if (/\+\s*["'`]/.test(line)) {
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
          });
          continue;
        }
      }

      if (isGoHttpCall(line)) {
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
  }

  return dedup(usages);
}

function isGoComment(trimmedLine: string): boolean {
  return trimmedLine.startsWith("//");
}

function isGoHttpCall(line: string): boolean {
  return ALL_HTTP_PATTERNS.some((p) => p.test(line));
}

function extractHttpMethod(line: string): string | undefined {
  const methodMatch = line.match(
    /\.(Get|Post|Put|Patch|Delete|Head)\s*\(/i,
  );
  if (methodMatch) return methodMatch[1].toUpperCase();

  const newReqMatch = line.match(
    /http\.NewRequest\s*\(\s*"(GET|POST|PUT|PATCH|DELETE|HEAD)"/,
  );
  if (newReqMatch) return newReqMatch[1];

  return undefined;
}
