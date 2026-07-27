import ora from "ora";
import chalk from "chalk";
import { writeFile } from "fs/promises";
import { loadConfig } from "../../config/loader.js";
import { logger } from "../../logger.js";
import {
  fetchSpec,
  diffSpecs,
  getBaseline,
  cacheSpec,
  clearChangeSet,
  saveChangeSet,
} from "../../differ/index.js";
import { writeGithubAction } from "../../output/github-action.js";
import { getOpenApiUrl, meetsMinUrgency, ApiUrgency } from "../../config/schema.js";
import { checkSdkVersion } from "../../watcher/index.js";
import { runVerification } from "../../verification.js";
import type { VerificationResult } from "../../verification.js";

interface CiOptions {
  config: string;
  failOn: string;
  output?: string;
  generateAction?: boolean;
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
  let totalVerificationFailures = 0;
  const reports: CiReport[] = [];

  for (const api of config.apis) {
    const spinner = ora(`[CI] Checking ${api.name}...`).start();

    try {
      if (!meetsMinUrgency(api, (options.minUrgency as ApiUrgency) || "low")) {
        spinner.info(`${api.name}: skipped (urgency filter)`);
        continue;
      }

      if (api.needs_resolve || api.contract?.type === "unresolved") {
        spinner.warn(`${api.name}: unresolved — run contractbot resolve`);
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
      const baseline = await getBaseline(api.name);

      if (!baseline) {
        spinner.warn(`${api.name}: No approved baseline — run contractbot baseline --api ${api.name}`);
        reports.push({ api: api.name, status: "baseline", breaking: 0, nonBreaking: 0 });
        continue;
      }

      const diff = diffSpecs(api.name, baseline.spec, newSpec);
      await cacheSpec(api.name, newSpec, {
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        url: specUrl,
      });

      if (diff.changes.length === 0) {
        await clearChangeSet(api.name);
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

      let verification: VerificationResult | undefined;
      if (api.verify) {
        spinner.text = `${api.name}: Running configured integration verification...`;
        verification = await runVerification(api.verify);
        report.verification = verification;
        if (!verification.passed) {
          totalVerificationFailures++;
          report.status = "incompatible";
        }
      }

      await saveChangeSet({
        apiName: api.name,
        sourceUrl: specUrl,
        detectedAt: new Date().toISOString(),
        baseline,
        nextSpec: newSpec,
        nextMeta: {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        },
        diff,
        verification,
      });

      if (verification && !verification.passed) {
        spinner.fail(`${api.name}: integration verification failed`);
      } else if (diff.breakingCount > 0) {
        spinner.fail(
          `${api.name}: ${diff.breakingCount} breaking, ${diff.nonBreakingCount} non-breaking`,
        );
      } else {
        spinner.warn(`${api.name}: ${diff.nonBreakingCount} non-breaking`);
      }

      reports.push(report);
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
      `status=${totalVerificationFailures > 0 ? "incompatible" : totalBreaking > 0 ? "breaking" : totalNonBreaking > 0 ? "changed" : "stable"}`,
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
    (options.failOn === "breaking" && (totalBreaking > 0 || totalVerificationFailures > 0)) ||
    (options.failOn === "any" && (totalBreaking + totalNonBreaking) > 0);

  if (shouldFail) {
    console.log(
      chalk.red.bold(`CI FAILED: ${totalBreaking} breaking, ${totalNonBreaking} non-breaking change(s), ${totalVerificationFailures} verification failure(s).`),
    );
    process.exit(1);
  }

  console.log(chalk.green.bold("CI PASSED: No actionable API changes."));
}

interface CiReport {
  api: string;
  status: "stable" | "baseline" | "breaking" | "changed" | "incompatible" | "error";
  breaking: number;
  nonBreaking: number;
  changes?: Array<{ severity: string; description: string }>;
  verification?: VerificationResult;
}

function buildMarkdownSummary(
  reports: CiReport[],
  totalBreaking: number,
  totalNonBreaking: number,
): string {
  const lines: string[] = [
    "## contractbot - API Contract Check",
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
    const icon = r.status === "breaking" || r.status === "incompatible" ? ":red_circle:" : r.status === "changed" ? ":yellow_circle:" : ":green_circle:";
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
      if (r.verification) {
        lines.push(`- ${r.verification.passed ? ":white_check_mark:" : ":x:"} Verification: \`${r.verification.command}\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function generateGithubAction(): Promise<void> {
  const result = await writeGithubAction();

  if (result.skipped) {
    console.log(chalk.yellow(`Workflow already exists: ${result.path}`));
    return;
  }

  console.log(chalk.green.bold(`✓ Created ${result.path}`));
  console.log();
  console.log(chalk.white("The workflow will:"));
  console.log(chalk.dim("  • Check approved API baselines every 15 minutes (no LLM)"));
  console.log(chalk.dim("  • Upload reports and pending change-sets for review"));
  console.log(chalk.dim("  • Never modify code or create PRs automatically"));
  console.log();
  console.log(chalk.dim("No LLM or GitHub write permissions are required."));
}
