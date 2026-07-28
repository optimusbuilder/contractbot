import { readFile } from "fs/promises";
import { glob } from "glob";

const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/ios/**/public/**", "**/android/**/assets/**"];

/** Collect dependency identifiers from common monorepo manifests. */
export async function collectManifestDependencies(projectDir: string): Promise<string[]> {
  const dependencies = new Set<string>();
  const files = await glob("**/{package.json,requirements*.txt,pyproject.toml,pubspec.yaml,go.mod,Gemfile}", {
    cwd: projectDir,
    nodir: true,
    ignore: IGNORE,
  });

  for (const file of files) {
    const text = await readFile(`${projectDir}/${file}`, "utf-8");
    if (file.endsWith("package.json")) {
      const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) dependencies.add(name);
      continue;
    }
    if (file.includes("requirements") || file.endsWith("pyproject.toml")) {
      for (const match of text.matchAll(/^\s*([A-Za-z][A-Za-z0-9_.-]*)\s*(?:\[.*?\])?\s*(?:[<>=!~].*)?$/gm)) dependencies.add(match[1]);
      continue;
    }
    if (file.endsWith("pubspec.yaml")) {
      let inDependencies = false;
      for (const line of text.split("\n")) {
        if (/^dependencies:\s*$/.test(line)) {
          inDependencies = true;
          continue;
        }
        if (inDependencies && /^\S/.test(line)) break;
        if (inDependencies) {
          const match = line.match(/^\s{2,}([A-Za-z][A-Za-z0-9_-]*):/);
          if (match) dependencies.add(match[1]);
        }
      }
      continue;
    }
    if (file.endsWith("go.mod")) {
      for (const match of text.matchAll(/^\s*([\w.-]+\/[\w./-]+)/gm)) dependencies.add(match[1]);
      continue;
    }
    if (file.endsWith("Gemfile")) {
      for (const match of text.matchAll(/gem\s+["']([^"']+)/g)) dependencies.add(match[1]);
    }
  }

  return [...dependencies].sort();
}
