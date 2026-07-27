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
 * Build the scheduled watch → conditional heal GitHub Actions workflow YAML.
 */
export function buildGithubActionYaml(version = defaultVersion()): string {
  const pkg = version === "latest" ? "contractbot" : `contractbot@${version}`;

  return `name: contractbot — fast watch, heal only on change

# Detection is cheap (HTTP + ETag). BYOK LLM / PRs run only when something moved.
on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 minutes
  workflow_dispatch:
  pull_request:
    branches: [main, master]

permissions:
  contents: write
  pull-requests: write

jobs:
  watch:
    runs-on: ubuntu-latest
    outputs:
      has_changes: \${{ steps.check.outputs.has_changes }}
      status: \${{ steps.check.outputs.status }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Restore contractbot cache (specs + ETags)
        uses: actions/cache@v4
        with:
          path: .contractbot/cache
          key: contractbot-\${{ hashFiles('.contractbot.yml') }}-\${{ github.run_id }}
          restore-keys: |
            contractbot-\${{ hashFiles('.contractbot.yml') }}-
            contractbot-

      - name: Watch API contracts (no LLM)
        id: check
        run: npx ${pkg} ci --fail-on none --output api-report.json

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-contract-report
          path: api-report.json

      - name: Comment on PR when breaking
        if: github.event_name == 'pull_request' && steps.check.outputs.status == 'breaking'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            if (!fs.existsSync('api-report.json')) return;
            const report = JSON.parse(fs.readFileSync('api-report.json', 'utf8'));
            const breaking = report.filter(r => r.status === 'breaking');
            if (breaking.length === 0) return;
            let body = '## :warning: Upstream API breaking changes\\n\\n';
            body += 'Detected by cheap contract watch (no LLM). A fix PR may follow from the scheduled heal job.\\n\\n';
            for (const r of breaking) {
              body += '### ' + r.api + '\\n';
              for (const c of r.changes || []) {
                body += '- ' + c.description + '\\n';
              }
              body += '\\n';
            }
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body
            });

  heal:
    needs: watch
    if: |
      needs.watch.outputs.has_changes == 'true' &&
      github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Restore contractbot cache
        uses: actions/cache@v4
        with:
          path: .contractbot/cache
          key: contractbot-\${{ hashFiles('.contractbot.yml') }}-\${{ github.run_id }}
          restore-keys: |
            contractbot-\${{ hashFiles('.contractbot.yml') }}-
            contractbot-

      - name: Heal and open PRs (BYOK — only on change)
        run: npx ${pkg} pr --labels contractbot,automated
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          CONTRACTBOT_API_KEY: \${{ secrets.CONTRACTBOT_API_KEY }}
          LLM_API_KEY: \${{ secrets.LLM_API_KEY }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
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
