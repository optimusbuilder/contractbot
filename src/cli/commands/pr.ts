import ora from "ora";
import chalk from "chalk";
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
import { createHealPrs, displayPrResults, savePatch } from "../../output/index.js";
import { getOpenApiUrl, meetsMinUrgency, ApiUrgency } from "../../config/schema.js";

interface PrCommandOptions {
  config: string;
  baseBranch?: string;
  perFile: boolean;
  draft: boolean;
  labels?: string;
  reviewers?: string;
  assignees?: string;
  dryRun: boolean;
  minUrgency?: string;
}

export async function prCommand(options: PrCommandOptions): Promise<void> {
  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    logger.warn("No APIs configured. Edit .apihealer.yml first.");
    return;
  }

  const labels = options.labels?.split(",").map((l) => l.trim()) ?? ["apihealer", "automated"];
  const reviewers = options.reviewers?.split(",").map((r) => r.trim());
  const assignees = options.assignees?.split(",").map((a) => a.trim());

  for (const api of config.apis) {
    const spinner = ora(`Checking ${api.name} for changes...`).start();

    try {
      if (!meetsMinUrgency(api, (options.minUrgency as ApiUrgency) || "low")) {
        spinner.info(`${api.name}: skipped (urgency filter)`);
        continue;
      }

      if (api.needs_resolve || api.contract?.type === "unresolved") {
        spinner.warn(`${api.name}: unresolved — run apihealer resolve`);
        continue;
      }

      const specUrl = getOpenApiUrl(api);
      if (!specUrl) {
        spinner.info(`${api.name}: no OpenAPI — skipping PR heal (SDK/changelog watch only)`);
        continue;
      }

      const fetched = await fetchSpec(specUrl, { apiName: api.name });
      if (fetched.notModified) {
        spinner.succeed(`${api.name}: Unchanged (ETag) — no PR needed`);
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
        spinner.info(`${api.name}: First run — spec cached. No PR needed.`);
        continue;
      }

      const diff = diffSpecs(api.name, cachedSpec, newSpec);

      if (diff.changes.length === 0) {
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        spinner.succeed(`${api.name}: No changes — no PR needed`);
        continue;
      }

      spinner.text = `${api.name}: ${diff.changes.length} change(s). Scanning code...`;

      const apiPaths = Object.keys(newSpec.paths ?? {});
      const usages = await scanAllLanguages(api.scan_paths, apiPaths, api.languages);

      if (usages.length === 0) {
        spinner.warn(`${api.name}: API changed but no usages found in code`);
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      spinner.text = `${api.name}: Generating fixes...`;

      const provider = createProvider({
        ...config.ai,
        cache: config.ai.cache,
        budget_usd: config.ai.budget_usd,
        max_requests: config.ai.max_requests,
        requests_per_minute: config.ai.requests_per_minute,
      });
      const healResult = await healCode(diff, usages, provider);

      if (healResult.patches.length === 0) {
        spinner.succeed(`${api.name}: No code changes needed`);
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      const scoredPatches = scorePatches(healResult.patches, diff.changes);

      if (options.dryRun) {
        spinner.info(`${api.name}: Would create ${options.perFile ? scoredPatches.length : 1} PR(s)`);
        console.log();
        if (options.perFile) {
          for (const patch of scoredPatches) {
            console.log(chalk.dim(`  PR: fix(${shortPath(patch.filePath)}): update for ${api.name} API changes`));
            console.log(chalk.dim(`      ${patch.description} (${patch.score}% confidence)`));
          }
        } else {
          console.log(chalk.dim(`  PR: fix: update code for ${api.name} API changes`));
          console.log(chalk.dim(`      ${scoredPatches.length} file(s), avg ${Math.round(scoredPatches.reduce((s, p) => s + p.score, 0) / scoredPatches.length)}% confidence`));
        }
        console.log();
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      spinner.text = `${api.name}: Creating PR(s)...`;

      const prs = await createHealPrs(healResult, scoredPatches, {
        baseBranch: options.baseBranch,
        perFile: options.perFile,
        draft: options.draft,
        labels,
        reviewers,
        assignees,
      });

      spinner.succeed(`${api.name}: Created ${prs.length} PR(s)`);
      displayPrResults(prs);

      await savePatch(healResult);
      await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
    } catch (error) {
      spinner.fail(
        `${api.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : filePath;
}
