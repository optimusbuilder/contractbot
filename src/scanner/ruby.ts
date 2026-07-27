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

const RB_IGNORE = ["**/vendor/**", "**/node_modules/**", "**/.bundle/**"];

const RUBY_HTTP_PATTERNS = [
  /HTTParty\.(get|post|put|patch|delete|head)\s*[\(]/,
  /Faraday\.(get|post|put|patch|delete)\s*[\(]/,
  /conn\.(get|post|put|patch|delete)\s*[\(]/,
  /connection\.(get|post|put|patch|delete)\s*[\(]/,
  /Net::HTTP\.(get|post|start)\s*[\(]/,
  /RestClient\.(get|post|put|patch|delete)\s*[\(]/,
  /\.execute\s*\(\s*method:\s*:(get|post|put|patch|delete)/,
  /URI\.parse\s*\(/,
  /open\s*\(\s*["']https?:/,
];

const RUBY_WRAPPER_PATTERNS = [
  /@?client\.(get|post|put|patch|delete)\s*[\(]/,
  /api_client\.(get|post|put|patch|delete)\s*[\(]/,
  /self\.(get|post|put|patch|delete)\s*[\(]/,
  /\.perform_request\s*\(/,
  /\.api_request\s*\(/,
];

const ALL_HTTP_PATTERNS = [...RUBY_HTTP_PATTERNS, ...RUBY_WRAPPER_PATTERNS];

/**
 * Matches Ruby variable assignments:
 *   url = "https://..."
 *   endpoint = "/v1/users"
 *   BASE_URL = "https://..."
 *   @base_url = "https://..."
 */
const RB_ASSIGNMENT = /^\s*(@?\w+)\s*=\s*["'](.+?)["']/;

export async function scanRubyForApiUsages(
  scanPaths: string[],
  apiPathPatterns: string[],
): Promise<ApiUsage[]> {
  const usages: ApiUsage[] = [];
  const rbFiles = await resolveFiles(scanPaths, /\.rb$/, RB_IGNORE);
  if (rbFiles.length === 0) return usages;

  const pathRegexes = buildPathRegexes(apiPathPatterns);

  for (const filePath of rbFiles) {
    const { lines } = await readFileContent(filePath);
    const trackedVars = trackUrlVariables(lines, pathRegexes, RB_ASSIGNMENT);
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track =begin/=end block comments
      if (trimmed === "=begin") {
        inBlockComment = true;
        continue;
      }
      if (trimmed === "=end") {
        inBlockComment = false;
        continue;
      }
      if (inBlockComment) continue;

      if (isRubyComment(trimmed)) continue;

      // Check string interpolation: "#{base_url}/users"
      const interpMatch = line.match(/#\{(\w+)\}/);
      if (interpMatch) {
        const varName = interpMatch[1];
        if (trackedVars.has(varName) && matchesAnyPath(line, pathRegexes)) {
          if (!usages.some((u) => u.filePath === filePath && u.line === i + 1)) {
            const varInfo = trackedVars.get(varName)!;
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
      }

      if (isRubyHttpCall(line)) {
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

function isRubyComment(trimmedLine: string): boolean {
  return trimmedLine.startsWith("#");
}

function isRubyHttpCall(line: string): boolean {
  return ALL_HTTP_PATTERNS.some((p) => p.test(line));
}

function extractHttpMethod(line: string): string | undefined {
  const match = line.match(/\.(get|post|put|patch|delete|head)\s*[\(]/i);
  if (match) return match[1].toUpperCase();

  const methodSymbol = line.match(/method:\s*:(get|post|put|patch|delete)/i);
  if (methodSymbol) return methodSymbol[1].toUpperCase();

  return undefined;
}
