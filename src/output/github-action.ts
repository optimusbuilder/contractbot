import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { readFileSync } from "fs";

export interface WriteGithubActionOptions {
  /** Project root (default: cwd). */
  dir?: string;
  /** Package version pin for npx (default: from package.json or "latest"). */
  version?: string;
  /** Overwrite an existing workflow file. */
  force?: boolean;
}

export interface WriteGithubActionResult {
  path: string;
  created: boolean;
  skipped: boolean;
}

function defaultVersion(): string {
  try {
    const pkgPath = new URL("../../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "latest";
  } catch {
    return "latest";
  }
}

/** Relative workflow path from project root. */
export const GITHUB_ACTION_RELATIVE_PATH = ".github/workflows/contractbot.yml";

/**
 * Build the scheduled compatibility-check GitHub Actions workflow YAML.
 */
export function buildGithubActionYaml(version = defaultVersion()): string {
  const pkg = version === "latest" ? "contractbot" : `contractbot@${version}`;

  return `name: contractbot — external API compatibility check

# Contract checks are deterministic. Migration suggestions are always manual.
on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 minutes
  workflow_dispatch:
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Restore HTTP cache (ETags only; baselines remain in git)
        uses: actions/cache@v4
        with:
          path: .contractbot/cache
          key: contractbot-\${{ hashFiles('.contractbot.yml') }}-\${{ github.run_id }}
          restore-keys: |
            contractbot-\${{ hashFiles('.contractbot.yml') }}-
            contractbot-

      - name: Check API compatibility
        id: check
        run: npx ${pkg} ci --fail-on breaking --output api-report.json

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-contract-report
          path: |
            api-report.json
            .contractbot/changes

`;
}

/**
 * Write `.github/workflows/contractbot.yml` under the project directory.
 */
export async function writeGithubAction(
  options: WriteGithubActionOptions = {},
): Promise<WriteGithubActionResult> {
  const projectDir = resolve(options.dir ?? ".");
  const workflowPath = join(projectDir, GITHUB_ACTION_RELATIVE_PATH);

  if (existsSync(workflowPath) && !options.force) {
    return { path: workflowPath, created: false, skipped: true };
  }

  await mkdir(join(projectDir, ".github", "workflows"), { recursive: true });
  await writeFile(workflowPath, buildGithubActionYaml(options.version), "utf-8");

  return { path: workflowPath, created: true, skipped: false };
}
