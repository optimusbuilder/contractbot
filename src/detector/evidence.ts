import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { glob } from "glob";

export interface DiscoveryEvidence {
  packages: string[];
  environmentVariables: string[];
  hosts: string[];
}

/** Collects identifiers only. It deliberately never includes secret values or source contents. */
export async function collectDiscoveryEvidence(projectDir: string): Promise<DiscoveryEvidence> {
  const packages = new Set<string>();
  const environmentVariables = new Set<string>();
  const hosts = new Set<string>();
  const packagePath = join(projectDir, "package.json");

  if (existsSync(packagePath)) {
    const pkg = JSON.parse(await readFile(packagePath, "utf-8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) packages.add(name);
  }

  const files = await glob("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
    cwd: projectDir,
    nodir: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/tests/**", "**/__tests__/**", "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}"],
  });
  for (const file of files.slice(0, 300)) {
    const text = await readFile(join(projectDir, file), "utf-8");
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) environmentVariables.add(match[1]);
    for (const match of text.matchAll(/https?:\/\/([a-zA-Z0-9.*-]+\.[a-zA-Z]{2,})/g)) hosts.add(match[1]);
  }

  return {
    packages: [...packages].sort(),
    environmentVariables: [...environmentVariables].sort(),
    hosts: [...hosts].sort(),
  };
}
