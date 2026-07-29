import { glob } from "glob";
import { Project, SyntaxKind, Node } from "ts-morph";
import { readFile } from "fs/promises";

export type EvidenceKind = "sdk_import" | "environment_variable" | "http_request" | "websocket_api" | "browser_navigation" | "static_asset" | "oauth_identity" | "unknown_url";

export interface IntegrationEvidence {
  kind: EvidenceKind;
  value: string;
  file: string;
  line: number;
  context: string;
}

const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/ios/**/public/**", "**/android/**/assets/**", "**/venv/**", "**/.venv/**", "**/site-packages/**", "**/tests/**", "**/__tests__/**", "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}"];
const URL = /(?:https?|wss?):\/\/[a-zA-Z0-9.*-]+\.[a-zA-Z]{2,}(?:\/[^\s'"`)]*)?/;

/** Builds cited, intent-aware evidence without sending any source content elsewhere. */
export async function listIntegrationEvidenceFiles(projectDir: string): Promise<string[]> {
  return glob("**/*.{ts,tsx,js,jsx,mjs,cjs,py,dart}", { cwd: projectDir, nodir: true, ignore: IGNORE, absolute: true });
}

export async function buildIntegrationEvidence(projectDir: string, filePaths?: string[]): Promise<IntegrationEvidence[]> {
  const files = filePaths ?? await listIntegrationEvidenceFiles(projectDir);
  const project = new Project({ compilerOptions: { allowJs: true, noEmit: true }, skipAddingFilesFromTsConfig: true });
  const jsFiles = files.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));
  const polyglotFiles = files.filter((file) => /\.(py|dart)$/.test(file));
  jsFiles.forEach((file) => project.addSourceFileAtPath(file));
  const evidence: IntegrationEvidence[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      evidence.push({ kind: "sdk_import", value: declaration.getModuleSpecifierValue(), file: sourceFile.getFilePath(), line: declaration.getStartLineNumber(), context: declaration.getText() });
    }
    for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const text = access.getText();
      if (text.startsWith("process.env.")) evidence.push({ kind: "environment_variable", value: text.slice("process.env.".length), file: sourceFile.getFilePath(), line: access.getStartLineNumber(), context: text });
    }
    for (const node of sourceFile.getDescendants()) {
      const text = node.getKind() === SyntaxKind.TemplateExpression
        ? node.asKindOrThrow(SyntaxKind.TemplateExpression).getHead().getLiteralText()
        : node.getKind() === SyntaxKind.StringLiteral || node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral
          ? node.getText().slice(1, -1)
          : null;
      if (!text) continue;
      const match = text.match(URL);
      if (!match) continue;
      evidence.push({ kind: classifyUrlContext(node, match[0], sourceFile.getText()), value: match[0], file: sourceFile.getFilePath(), line: node.getStartLineNumber(), context: nearestContext(node) });
    }
  }
  for (const file of polyglotFiles) evidence.push(...await buildPolyglotEvidence(file));
  return deduplicate(evidence);
}

async function buildPolyglotEvidence(file: string): Promise<IntegrationEvidence[]> {
  const text = await readFile(file, "utf-8");
  const evidence: IntegrationEvidence[] = [];
  const isPython = file.endsWith(".py");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const importMatch = isPython
      ? line.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/)
      : line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    const imported = importMatch?.[1] ?? importMatch?.[2];
    if (imported) evidence.push({ kind: "sdk_import", value: imported, file, line: lineNumber, context: line.trim() });
    const envPattern = isPython
      ? /(?:os\.getenv|os\.environ\.get|os\.environ\[)\s*\(?\[?\s*["']([A-Z][A-Z0-9_]+)["']/g
      : /(?:Platform\.environment|dotenv\.env)\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g;
    for (const match of line.matchAll(envPattern)) evidence.push({ kind: "environment_variable", value: match[1], file, line: lineNumber, context: line.trim() });
    const url = line.match(URL)?.[0];
    if (url) evidence.push({ kind: classifyPolyglotUrl(line, url, isPython), value: url, file, line: lineNumber, context: line.trim().slice(0, 400) });
  });
  return evidence;
}

function classifyPolyglotUrl(line: string, url: string, isPython: boolean): EvidenceKind {
  const lower = line.toLowerCase();
  if ((isPython && /(requests|httpx|aiohttp)\.(get|post|put|patch|delete|request)/.test(lower)) || (!isPython && /(dio|http)\.(get|post|put|patch|delete|request)/.test(lower))) return url.startsWith("ws") ? "websocket_api" : "http_request";
  if ((isPython && /(websocket|websockets)\.connect/.test(lower)) || (!isPython && /websocket/.test(lower))) return "websocket_api";
  return url.startsWith("ws") ? "websocket_api" : "unknown_url";
}

function classifyUrlContext(node: Node, url: string, sourceText: string): EvidenceKind {
  for (let current: Node | undefined = node; current; current = current.getParent()) {
    if (Node.isJsxAttribute(current) && current.getNameNode().getText() === "src") return "static_asset";
    if (Node.isCallExpression(current)) {
      const expression = current.getExpression().getText().toLowerCase();
      if (expression === "fetch" || expression.includes("axios") || expression.includes("request")) return url.startsWith("ws") ? "websocket_api" : "http_request";
      if (expression.endsWith(".goto") || expression.includes("open")) return "browser_navigation";
      if (expression.includes("redirect") || url.includes("accounts.") || url.includes("oauth")) return "oauth_identity";
    }
  }
  const declaration = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (declaration) {
    const name = declaration.getName();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:page\\.)?goto\\(\\s*${escaped}\\s*\\)`).test(sourceText)) return "browser_navigation";
    if (new RegExp(`(?:fetch|axios(?:\\.\\w+)?)\\(\\s*${escaped}\\s*[,)]`).test(sourceText)) return url.startsWith("ws") ? "websocket_api" : "http_request";
    if (new RegExp(`(?:redirect|location\\.assign)\\(\\s*${escaped}\\s*\\)`).test(sourceText)) return "oauth_identity";
  }
  return url.startsWith("ws") ? "websocket_api" : "unknown_url";
}

function nearestContext(node: Node): string {
  const call = node.getFirstAncestorByKind(SyntaxKind.CallExpression);
  return (call?.getText() ?? node.getText()).slice(0, 400);
}

function deduplicate(evidence: IntegrationEvidence[]): IntegrationEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.kind}:${item.value}:${item.file}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
