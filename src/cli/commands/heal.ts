import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import {
  fetchSpec,
  diffSpecs,
  getCachedSpec,
  cacheSpec,
} from "../../differ/index.js";
import { scanAllLanguages } from "../../scanner/index.js";
import { createProvider, TrackedProvider } from "../../providers/index.js";
import { healCode, scorePatches, validateAndHeal } from "../../healer/index.js";
import { savePatch, displayDiffResult, displayHealResult, displayPatchPreview } from "../../output/index.js";
import { logger } from "../../logger.js";
import { getOpenApiUrl, meetsMinUrgency, ApiUrgency } from "../../config/schema.js";

interface HealOptions {
  config: string;
  dryRun: boolean;
  preview: boolean;
  validate: boolean;
  minUrgency?: string;
}

export async function healCommand(options: HealOptions): Promise<void> {
  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    logger.warn("No APIs configured. Edit .contractbot.yml first.");
    return;
  }

  logger.debug("Creating AI provider", {
    provider: config.ai.provider,
    model: config.ai.model,
    cache: config.ai.cache !== false,
  });

  const provider = createProvider({
    ...config.ai,
    cache: config.ai.cache,
    budget_usd: config.ai.budget_usd,
    max_requests: config.ai.max_requests,
    requests_per_minute: config.ai.requests_per_minute,
  });

  for (const api of config.apis) {
    const spinner = logger.isJsonMode() ? null : ora(`Fetching spec for ${api.name}...`).start();

    try {
      if (!meetsMinUrgency(api, (options.minUrgency as ApiUrgency) || "low")) {
        spinner?.info(`${api.name}: skipped (urgency below --min-urgency)`);
        continue;
      }

      if (api.needs_resolve || api.contract?.type === "unresolved") {
        spinner?.warn(`${api.name}: unresolved — run contractbot resolve`);
        logger.warn("Skipping unresolved API", { api: api.name, event: "needs_resolve" });
        continue;
      }

      const specUrl = getOpenApiUrl(api);
      if (!specUrl) {
        spinner?.info(
          `${api.name}: no OpenAPI contract (watching via ${api.contract?.type ?? "unknown"}) — heal skips OpenAPI diff`,
        );
        logger.info("Skipping heal — no OpenAPI URL", {
          api: api.name,
          contract: api.contract?.type,
          event: "heal_skip_no_openapi",
        });
        continue;
      }

      logger.debug("Fetching spec", { api: api.name, spec: specUrl });
      const fetched = await fetchSpec(specUrl, { apiName: api.name });
      if (fetched.notModified) {
        spinner?.succeed(`${api.name}: Spec unchanged (ETag)`);
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
        const msg = `${api.name}: First run — spec cached. Run heal again after the API changes.`;
        spinner?.info(msg);
        logger.info(msg, { api: api.name, event: "spec_cached_first_run" });
        continue;
      }

      const diff = diffSpecs(api.name, cachedSpec, newSpec);

      if (diff.changes.length === 0) {
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        spinner?.succeed(`${api.name}: No changes detected`);
        logger.info("No changes detected", { api: api.name, event: "no_changes" });
        continue;
      }

      logger.info("API changes detected", {
        api: api.name,
        event: "changes_detected",
        breaking: diff.breakingCount,
        nonBreaking: diff.nonBreakingCount,
        total: diff.changes.length,
      });

      if (spinner) {
        spinner.text = `${api.name}: ${diff.changes.length} change(s) found. Scanning codebase...`;
      }

      const apiPaths = Object.keys(newSpec.paths ?? {});
      const usages = await scanAllLanguages(api.scan_paths, apiPaths, api.languages);

      logger.debug("Code scan complete", {
        api: api.name,
        usages: usages.length,
        files: new Set(usages.map((u) => u.filePath)).size,
      });

      if (usages.length === 0) {
        spinner?.warn(`${api.name}: Changes detected but no API usages found in your code`);
        logger.warn("Changes detected but no API usages found", { api: api.name, event: "no_usages" });
        if (!logger.isJsonMode()) displayDiffResult(diff);
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      if (spinner) {
        spinner.text = `${api.name}: Found ${usages.length} usage(s). Generating fixes...`;
      }

      if (options.dryRun) {
        spinner?.info(`${api.name}: Dry run — showing changes without generating patches`);
        logger.info("Dry run complete", {
          api: api.name,
          event: "dry_run",
          usages: usages.length,
          files: new Set(usages.map((u) => u.filePath)).size,
        });
        if (!logger.isJsonMode()) {
          displayDiffResult(diff);
          console.log(chalk.dim(`  ${usages.length} API usage(s) found across ${new Set(usages.map((u) => u.filePath)).size} file(s)`));
        }
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      let healResult;
      let validation;

      if (options.validate) {
        if (spinner) spinner.text = `${api.name}: Generating and validating fixes...`;
        logger.debug("Running heal with validation", { api: api.name });
        const validated = await validateAndHeal(diff, usages, provider, healCode);
        healResult = validated;
        validation = validated.validation;

        if (validated.retryCount > 0) {
          logger.info("Heal required retries", {
            api: api.name,
            retries: validated.retryCount,
            validationPassed: validated.validation.passed,
          });
          if (spinner) spinner.text = `${api.name}: Fixed after ${validated.retryCount} retry(ies)`;
        }
      } else {
        healResult = await healCode(diff, usages, provider);
      }

      if (healResult.patches.length === 0) {
        spinner?.succeed(`${api.name}: Changes detected but no code modifications needed`);
        logger.info("No code modifications needed", { api: api.name, event: "no_patches" });
        if (!logger.isJsonMode()) displayDiffResult(diff);
        await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
        continue;
      }

      const scoredPatches = scorePatches(healResult.patches, diff.changes);
      const patchId = await savePatch(healResult);

      spinner?.succeed(`${api.name}: Generated ${healResult.patches.length} patch(es)`);

      const avgScore = Math.round(
        scoredPatches.reduce((sum, p) => sum + p.score, 0) / scoredPatches.length,
      );
      const highCount = scoredPatches.filter((p) => p.confidence === "high").length;

      logger.info("Patches generated", {
        api: api.name,
        event: "patches_generated",
        patchId,
        patchCount: healResult.patches.length,
        avgConfidence: avgScore,
        highConfidence: highCount,
        files: healResult.patches.map((p) => p.filePath),
      });

      if (logger.isJsonMode()) {
        logger.result({
          api: api.name,
          patchId,
          diff: {
            oldVersion: diff.oldVersion,
            newVersion: diff.newVersion,
            breakingCount: diff.breakingCount,
            nonBreakingCount: diff.nonBreakingCount,
            changes: diff.changes.map((c) => ({
              severity: c.severity,
              path: c.path,
              method: c.method,
              description: c.description,
              field: c.field,
            })),
          },
          patches: scoredPatches.map((p) => ({
            filePath: p.filePath,
            description: p.description,
            confidence: p.confidence,
            score: p.score,
            reasons: p.reasons,
          })),
          validation: validation ? {
            passed: validation.passed,
            typecheckPassed: validation.typecheckPassed,
            testsPassed: validation.testsPassed,
          } : undefined,
        });
      } else {
        displayDiffResult(diff);

        if (options.preview) {
          displayPatchPreview(scoredPatches);
        } else {
          displayHealResult(healResult, patchId);
          console.log();
          console.log(
            chalk.dim(`  Confidence: avg ${avgScore}% | `) +
            chalk.green(`${highCount} high`) +
            chalk.dim(` / ${scoredPatches.length} total`),
          );
          console.log(chalk.dim(`  Run with --preview for detailed diff view`));
        }

        if (validation) {
          console.log();
          if (validation.passed) {
            console.log(chalk.green("  ✓ Validation passed (typecheck + tests)"));
          } else {
            if (!validation.typecheckPassed) {
              console.log(chalk.red("  ✗ Typecheck failed — review patches carefully"));
            }
            if (!validation.testsPassed) {
              console.log(chalk.red("  ✗ Tests failed — review patches carefully"));
            }
          }
        }
      }

      await cacheSpec(api.name, newSpec, {
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          url: specUrl,
        });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      spinner?.fail(`${api.name}: ${msg}`);
      logger.error(`Heal failed for ${api.name}`, {
        api: api.name,
        event: "heal_error",
        error: msg,
      });
    }
  }

  if (provider instanceof TrackedProvider) {
    const summary = provider.usage.getSummary();
    if (summary.totalRequests > 0) {
      const cacheStats = provider.cache.getStats();

      logger.data("AI Usage", {
        totalRequests: summary.totalRequests,
        cachedRequests: summary.cachedRequests,
        totalInputTokens: summary.totalInputTokens,
        totalOutputTokens: summary.totalOutputTokens,
        estimatedCostUsd: summary.estimatedCostUsd,
        cacheHits: cacheStats.hits,
        cacheMisses: cacheStats.misses,
        cacheHitRate: cacheStats.hitRate,
      });

      if (!logger.isJsonMode()) {
        console.log();
        console.log(chalk.dim("─".repeat(50)));
        console.log(chalk.dim(provider.usage.formatSummary()));
        if (cacheStats.hits > 0) {
          console.log(chalk.dim(`  Cache: ${cacheStats.hits} hit(s), ${cacheStats.misses} miss(es) (${cacheStats.hitRate} hit rate)`));
        }
      }
    }
  }
}
