import { Project, SyntaxKind, Node } from "ts-morph";
import { glob } from "glob";
import { ApiUsage } from "./types.js";

/**
 * Scans TypeScript/JavaScript files for HTTP API call patterns:
 * - fetch() calls with URL strings
 * - axios/got/ky method calls
 * - String literals containing API path patterns
 */
export async function scanForApiUsages(
  scanPaths: string[],
  apiPathPatterns: string[],
): Promise<ApiUsage[]> {
  const usages: ApiUsage[] = [];

  const files: string[] = [];
  for (const pattern of scanPaths) {
    const matched = await glob(pattern, {
      nodir: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/.apihealer/**"],
    });
    files.push(...matched);
  }

  const tsFiles = files.filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f),
  );

  if (tsFiles.length === 0) return usages;

  const project = new Project({
    compilerOptions: { allowJs: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const file of tsFiles) {
    project.addSourceFileAtPath(file);
  }

  const pathRegexes = apiPathPatterns.map(
    (p) => new RegExp(p.replace(/\{[^}]+\}/g, "[^/]+")),
  );

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (node.getKind() === SyntaxKind.StringLiteral) {
        const text = node.getText().slice(1, -1);
        if (matchesApiPath(text, pathRegexes)) {
          usages.push(buildUsage(filePath, node, text));
        }
      }

      if (node.getKind() === SyntaxKind.TemplateExpression ||
          node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        const text = node.getText().slice(1, -1);
        if (matchesApiPath(text, pathRegexes)) {
          usages.push(buildUsage(filePath, node, text));
        }
      }

      if (node.getKind() === SyntaxKind.CallExpression) {
        const callText = node.getText();
        if (isFetchLike(callText)) {
          const surroundingLines = getSurroundingCode(node, 5);
          for (const regex of pathRegexes) {
            if (regex.test(surroundingLines)) {
              usages.push({
                filePath,
                line: node.getStartLineNumber(),
                column: node.getStartLinePos(),
                snippet: callText.slice(0, 200),
                context: surroundingLines,
                endpointHint: extractEndpointHint(surroundingLines, pathRegexes),
              });
              break;
            }
          }
        }
      }
    });
  }

  return deduplicateUsages(usages);
}

function matchesApiPath(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function isFetchLike(text: string): boolean {
  return /^(fetch|axios\.(get|post|put|patch|delete)|got\.(get|post|put|patch|delete)|ky\.(get|post|put|patch|delete)|http\.(get|post|put|patch|delete))/.test(
    text,
  );
}

function buildUsage(filePath: string, node: Node, text: string): ApiUsage {
  return {
    filePath,
    line: node.getStartLineNumber(),
    column: node.getStartLinePos(),
    snippet: text.slice(0, 200),
    context: getSurroundingCode(node, 5),
  };
}

function getSurroundingCode(node: Node, lineRadius: number): string {
  const sourceFile = node.getSourceFile();
  const startLine = Math.max(1, node.getStartLineNumber() - lineRadius);
  const endLine = node.getStartLineNumber() + lineRadius;

  const lines = sourceFile.getFullText().split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

function extractEndpointHint(
  text: string,
  patterns: RegExp[],
): string | undefined {
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[0];
  }
  return undefined;
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
