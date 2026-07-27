import ora from "ora";
import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { loadConfig } from "../../config/loader.js";
import { logger } from "../../logger.js";
import {
  fetchSpec,
  diffSpecs,
  getCachedSpec,
  cacheSpec,
} from "../../differ/index.js";
import { scanAllLanguages } from "../../scanner/index.js";
import { createProvider } from "../../providers/index.js";
import { healCode, scorePatches } from "../../healer/index.js";
import { savePatch } from "../../output/index.js";
import { getOpenApiUrl, meetsMinUrgency, ApiUrgency } from "../../config/schema.js";
import { checkSdkVersion } from "../../watcher/index.js";

interface CiOptions {
  config: string;
  failOn: string;
  output?: string;
  generateAction?: boolean;
  autoHeal?: boolean;
  minUrgency?: string;
}

export async function ciCommand(options: CiOptions): Promise<void> {
  if (options.generateAction) {
    await generateGithubAction();
    return;
  }

  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    logger.warn("No APIs configured.");
    process.exit(0);
  }

  let totalBreaking = 0;
  let totalNonBreaking = 0;
  const reports: CiReport[] = [];

  for (const api of config.apis) {
    const spinner = ora(`[CI] Checking ${api.name}...`).start();

    try {
      if (!meetsMinUrgency(api, (options.minUrgency as ApiUrgency) || "low")) {
        spinner.info(`${api.name}: skipped (urgency filter)`);
        continue;
      }

      if (api.needs_resolve || api.contract?.type === "unresolved") {
        spinner.warn(`${api.name}: unresolved — run apihealer resolve`);
        reports.push({ api: api.name, status: "error", breaking: 0, nonBreaking: 0 });
        continue;
      }

      // SDK-only contracts: version watch
      const sdk =
        api.watch?.sdk ??
        (api.contract?.type === "sdk_package"
          ? { ecosystem: api.contract.ecosystem, package: api.contract.package }
          : null);

      if (sdk && !getOpenApiUrl(api)) {
        const events = await checkSdkVersion(api.name, sdk);
        if (events.length === 0) {
          spinner.succeed(`${api.name}: SDK stable`);
          reports.push({ api: api.name, status: "stable", breaking: 0, nonBreaking: 0 });
        } else {
          const breaking = events.filter((e) => e.severity === "breaking").length;
          const nonBreaking = events.length - breaking;
          totalBreaking += breaking;
          totalNonBreaking += nonBreaking;
          spinner.warn(`${api.name}: SDK ${events[0].description}`);
          reports.push({
            api: api.name,
            status: breaking > 0 ? "breaking" : "changed",
            breaking,
            nonBreaking,
            changes: events.map((e) => ({
              severity: e.severity === "unknown" ? "info" : e.severity,
              description: e.description,
            })),
          });
        }
        continue;
      }

      const specUrl = getOpenApiUrl(api);
      if (!specUrl) {
        spinner.info(`${api.name}: no watchable OpenAPI/SDK contract`);
        reports.push({ api: api.name, status: "stable", breaking: 0, nonBreaking: 0 });
        continue;
      }

      const fetched = await fetchSpec(specUrl, { apiName: api.name });
      if (fetched.notModified) {
        spinner.succeed(`${api.name}: Stable (ETag)`);
        reports.push({ api: api.name, status: "stable", breaking: 0, nonBreaking: 0 });
        continue;
      }
      const newSpec = fetched.spec;
      const cachedSpec = await getCachedSpec(api.name);

      if (!cachedSpec) {
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        spinner.info(`${api.name}: First run — baseline cached.`);
        reports.push({ api: api.name, status: "baseline", breaking: 0, nonBreaking: 0 });
        continue;
      }

      const diff = diffSpecs(api.name, cachedSpec, newSpec);

      if (diff.changes.length === 0) {
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        spinner.succeed(`${api.name}: Stable`);
        reports.push({ api: api.name, status: "stable", breaking: 0, nonBreaking: 0 });
        continue;
      }

      totalBreaking += diff.breakingCount;
      totalNonBreaking += diff.nonBreakingCount;

      const report: CiReport = {
        api: api.name,
        status: diff.breakingCount > 0 ? "breaking" : "changed",
        breaking: diff.breakingCount,
        nonBreaking: diff.nonBreakingCount,
        changes: diff.changes.map((c) => ({
          severity: c.severity,
          description: c.description,
        })),
      };

      if (options.autoHeal && diff.breakingCount > 0) {
        spinner.text = `${api.name}: Healing...`;
        const apiPaths = Object.keys(newSpec.paths ?? {});
        const usages = await scanAllLanguages(api.scan_paths, apiPaths, api.languages);

        if (usages.length > 0) {
          const provider = createProvider({
            ...config.ai,
            cache: config.ai.cache,
            budget_usd: config.ai.budget_usd,
            max_requests: config.ai.max_requests,
            requests_per_minute: config.ai.requests_per_minute,
          });
          const healResult = await healCode(diff, usages, provider);
          if (healResult.patches.length > 0) {
            const scored = scorePatches(healResult.patches, diff.changes);
            const patchId = await savePatch(healResult);
            report.patchId = patchId;
            report.patchCount = healResult.patches.length;
            report.avgConfidence = Math.round(
              scored.reduce((s, p) => s + p.score, 0) / scored.length,
            );
          }
        }
      }

      if (diff.breakingCount > 0) {
        spinner.fail(
          `${api.name}: ${diff.breakingCount} breaking, ${diff.nonBreakingCount} non-breaking`,
        );
      } else {
        spinner.warn(`${api.name}: ${diff.nonBreakingCount} non-breaking`);
      }

      reports.push(report);
      await cacheSpec(api.name, newSpec, {
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        url: specUrl,
      });
    } catch (error) {
      spinner.fail(`${api.name}: ${error instanceof Error ? error.message : "Error"}`);
      reports.push({ api: api.name, status: "error", breaking: 0, nonBreaking: 0 });
    }
  }

  if (options.output) {
    await writeFile(options.output, JSON.stringify(reports, null, 2), "utf-8");
    console.log(chalk.dim(`\nReport saved: ${options.output}`));
  }

  // GitHub Actions output
  if (process.env.GITHUB_OUTPUT) {
    const hasChanges = totalBreaking + totalNonBreaking > 0;
    const outputLines = [
      `breaking_count=${totalBreaking}`,
      `non_breaking_count=${totalNonBreaking}`,
      `has_changes=${hasChanges}`,
      `status=${totalBreaking > 0 ? "breaking" : totalNonBreaking > 0 ? "changed" : "stable"}`,
    ];
    await writeFile(
      process.env.GITHUB_OUTPUT,
      outputLines.join("\n") + "\n",
      { flag: "a" } as any,
    );
  }

  // GitHub Actions PR comment via step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = buildMarkdownSummary(reports, totalBreaking, totalNonBreaking);
    await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" } as any);
  }

  console.log();

  const shouldFail =
    (options.failOn === "breaking" && totalBreaking > 0) ||
    (options.failOn === "any" && (totalBreaking + totalNonBreaking) > 0);

  if (shouldFail) {
    console.log(
      chalk.red.bold(
        `CI FAILED: ${totalBreaking} breaking, ${totalNonBreaking} non-breaking change(s) detected.`,
      ),
    );
    process.exit(1);
  }

  console.log(chalk.green.bold("CI PASSED: No actionable API changes."));
}

interface CiReport {
  api: string;
  status: "stable" | "baseline" | "breaking" | "changed" | "error";
  breaking: number;
  nonBreaking: number;
  changes?: Array<{ severity: string; description: string }>;
  patchId?: string;
  patchCount?: number;
  avgConfidence?: number;
}

function buildMarkdownSummary(
  reports: CiReport[],
  totalBreaking: number,
  totalNonBreaking: number,
): string {
  const lines: string[] = [
    "## apihealer - API Contract Check",
    "",
  ];

  if (totalBreaking > 0) {
    lines.push(`> :warning: **${totalBreaking} breaking change(s) detected**`);
  } else if (totalNonBreaking > 0) {
    lines.push(`> :large_blue_circle: ${totalNonBreaking} non-breaking change(s)`);
  } else {
    lines.push("> :white_check_mark: All APIs stable");
  }

  lines.push("", "| API | Status | Breaking | Non-breaking |", "|-----|--------|----------|--------------|");

  for (const r of reports) {
    const icon = r.status === "breaking" ? ":red_circle:" : r.status === "changed" ? ":yellow_circle:" : ":green_circle:";
    lines.push(`| ${r.api} | ${icon} ${r.status} | ${r.breaking} | ${r.nonBreaking} |`);
  }

  const withChanges = reports.filter((r) => r.changes && r.changes.length > 0);
  if (withChanges.length > 0) {
    lines.push("", "### Changes", "");
    for (const r of withChanges) {
      lines.push(`**${r.api}:**`);
      for (const c of r.changes!) {
        const icon = c.severity === "breaking" ? ":x:" : ":large_blue_circle:";
        lines.push(`- ${icon} ${c.description}`);
      }
      if (r.patchId) {
        lines.push(`- :wrench: Patch generated: \`${r.patchId}\` (${r.patchCount} files, ${r.avgConfidence}% confidence)`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function generateGithubAction(): Promise<void> {
  const workflowDir = ".github/workflows";
  const workflowPath = `${workflowDir}/apihealer.yml`;

  if (existsSync(workflowPath)) {
    console.log(chalk.yellow(`Workflow already exists: ${workflowPath}`));
    return;
  }

  await mkdir(workflowDir, { recursive: true });

  const workflow = `name: apihealer — fast watch, heal only on change

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

      - name: Restore apihealer cache (specs + ETags)
        uses: actions/cache@v4
        with:
          path: .apihealer/cache
          key: apihealer-\${{ hashFiles('.apihealer.yml') }}-\${{ github.run_id }}
          restore-keys: |
            apihealer-\${{ hashFiles('.apihealer.yml') }}-
            apihealer-

      - name: Watch API contracts (no LLM)
        id: check
        run: npx apihealer ci --fail-on none --output api-report.json

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

      - name: Restore apihealer cache
        uses: actions/cache@v4
        with:
          path: .apihealer/cache
          key: apihealer-\${{ hashFiles('.apihealer.yml') }}-\${{ github.run_id }}
          restore-keys: |
            apihealer-\${{ hashFiles('.apihealer.yml') }}-
            apihealer-

      - name: Heal and open PRs (BYOK — only on change)
        run: npx apihealer pr --labels apihealer,automated
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          APIHEALER_API_KEY: \${{ secrets.APIHEALER_API_KEY }}
          LLM_API_KEY: \${{ secrets.LLM_API_KEY }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

  await writeFile(workflowPath, workflow, "utf-8");

  console.log(chalk.green.bold(`✓ Created ${workflowPath}`));
  console.log();
  console.log(chalk.white("The workflow will:"));
  console.log(chalk.dim("  • Watch every 15 minutes (cheap HTTP + ETag — no LLM)"));
  console.log(chalk.dim("  • Open fix PRs only when contracts/SDKs actually changed (BYOK)"));
  console.log(chalk.dim("  • Humans review & merge — nothing auto-merges to main"));
  console.log();
  console.log(chalk.white("Required secrets (BYOK — heal job only):"));
  console.log(chalk.dim("  • OPENAI_API_KEY / ANTHROPIC_API_KEY, or APIHEALER_API_KEY / LLM_API_KEY"));
  console.log(chalk.dim("  • Or set ai.api_key_env in .apihealer.yml (e.g. MOONSHOT_API_KEY) and add that secret"));
}
