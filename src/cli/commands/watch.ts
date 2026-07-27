import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { fetchSpec, diffSpecs, getCachedSpec, cacheSpec } from "../../differ/index.js";
import { displayDiffResult } from "../../output/index.js";
import {
  probeEndpoints,
  diffProbeResults,
  checkChangelogs,
  checkRepoChanges,
  getKnownSpecRepos,
  checkSdkVersion,
  WatchEvent,
  ProbeConfig,
} from "../../watcher/index.js";
import { ApiEntry, getOpenApiUrl, meetsMinUrgency, ApiUrgency } from "../../config/schema.js";
import { SchemaObject } from "../../differ/types.js";
import { logger } from "../../logger.js";

interface WatchOptions {
  config: string;
  minUrgency?: string;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    logger.warn("No APIs configured. Edit .contractbot.yml first.");
    return;
  }

  let totalBreaking = 0;
  let totalNonBreaking = 0;
  const allEvents: WatchEvent[] = [];
  const minUrgency = (options.minUrgency as ApiUrgency) || "low";

  for (const api of config.apis) {
    if (!meetsMinUrgency(api, minUrgency)) {
      logger.debug(`${api.name}: skipped (urgency filter)`, {
        api: api.name,
        urgency: api.urgency ?? "normal",
      });
      continue;
    }

    if (api.needs_resolve || api.contract?.type === "unresolved") {
      logger.warn(`${api.name}: needs resolve — run contractbot resolve`, {
        api: api.name,
        event: "needs_resolve",
      });
      if (!logger.isJsonMode()) {
        console.log(
          chalk.yellow(`  ⚠ ${api.name}: unresolved contract — run contractbot resolve`),
        );
      }
      continue;
    }

    const strategies =
      api.watch?.strategies ??
      (api.contract?.type === "sdk_package"
        ? ["sdk_version"]
        : api.contract?.type === "openapi" || api.spec
          ? ["spec_poll"]
          : ["probe"]);

    for (const strategy of strategies) {
      switch (strategy) {
        case "spec_poll":
          await runSpecPoll(api, (b, nb) => {
            totalBreaking += b;
            totalNonBreaking += nb;
          });
          break;

        case "probe":
          await runProbe(api, allEvents);
          break;

        case "changelog":
          await runChangelog(api, allEvents);
          break;

        case "repo_watch":
          await runRepoWatch(api, allEvents);
          break;

        case "sdk_version":
          await runSdkVersion(api, allEvents);
          break;
      }
    }
  }

  if (allEvents.length > 0) {
    console.log();
    console.log(chalk.white.bold("Watch events from additional strategies:"));
    console.log();

    for (const event of allEvents) {
      const icon = event.severity === "breaking"
        ? chalk.red("✗")
        : event.severity === "non-breaking"
          ? chalk.yellow("~")
          : chalk.dim("?");
      const stratBadge = chalk.dim(`[${event.strategy}]`);
      console.log(`  ${icon} ${stratBadge} ${chalk.white(event.description)}`);

      if (event.details?.url) {
        console.log(`    ${chalk.dim(event.details.url as string)}`);
      }
    }

    const breakingEvents = allEvents.filter((e) => e.severity === "breaking");
    totalBreaking += breakingEvents.length;
    totalNonBreaking += allEvents.filter((e) => e.severity === "non-breaking").length;
  }

  console.log();
  if (totalBreaking > 0) {
    console.log(
      chalk.red.bold(
        `⚠ ${totalBreaking} breaking change(s) detected. Run "contractbot heal" to generate fixes.`,
      ),
    );
  } else if (totalNonBreaking > 0) {
    console.log(
      chalk.yellow(
        `${totalNonBreaking} non-breaking change(s) detected. Your code likely still works.`,
      ),
    );
  } else if (allEvents.length === 0) {
    console.log(chalk.green("✓ All APIs are stable."));
  }
}

async function runSpecPoll(
  api: ApiEntry,
  onCounts: (breaking: number, nonBreaking: number) => void,
): Promise<void> {
  const specUrl = getOpenApiUrl(api);
  if (!specUrl) {
    logger.debug(`${api.name}: skipping spec_poll (no OpenAPI URL)`);
    return;
  }

  const spinner = logger.isJsonMode()
    ? null
    : ora(`Checking ${api.name} (spec poll)...`).start();

  try {
    const fetched = await fetchSpec(specUrl, { apiName: api.name });
    if (fetched.notModified) {
      spinner?.succeed(`${api.name}: Unchanged (304 / ETag)`);
      logger.debug("Spec not modified", { api: api.name, event: "etag_304" });
      return;
    }
    const newSpec = fetched.spec;
    const cachedSpec = await getCachedSpec(api.name);

    if (!cachedSpec) {
      await cacheSpec(api.name, newSpec, {
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        url: specUrl,
      });
      spinner?.info(
        `${api.name}: First run — spec cached. Changes will be detected on next run.`,
      );
      return;
    }

    const diff = diffSpecs(api.name, cachedSpec, newSpec);
    await cacheSpec(api.name, newSpec, {
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      url: specUrl,
    });

    if (diff.changes.length === 0) {
      spinner?.succeed(`${api.name}: No changes`);
    } else if (diff.breakingCount > 0) {
      spinner?.fail(
        `${api.name}: ${diff.breakingCount} breaking, ${diff.nonBreakingCount} non-breaking`,
      );
    } else {
      spinner?.warn(
        `${api.name}: ${diff.nonBreakingCount} non-breaking change(s)`,
      );
    }

    if (!logger.isJsonMode()) displayDiffResult(diff);
    logger.info("Spec poll complete", {
      api: api.name,
      event: "spec_poll",
      breaking: diff.breakingCount,
      nonBreaking: diff.nonBreakingCount,
    });
    onCounts(diff.breakingCount, diff.nonBreakingCount);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    spinner?.fail(`${api.name}: ${msg}`);
    logger.error(`Spec poll failed for ${api.name}`, { api: api.name, error: msg });
  }
}

async function runSdkVersion(api: ApiEntry, events: WatchEvent[]): Promise<void> {
  const sdk =
    api.watch?.sdk ??
    (api.contract?.type === "sdk_package"
      ? { ecosystem: api.contract.ecosystem, package: api.contract.package }
      : null);

  if (!sdk) return;

  const spinner = logger.isJsonMode()
    ? null
    : ora(`Checking ${api.name} SDK version (${sdk.package})...`).start();

  try {
    const sdkEvents = await checkSdkVersion(api.name, sdk);
    events.push(...sdkEvents);

    if (sdkEvents.length > 0) {
      spinner?.warn(
        `${api.name}: ${sdkEvents.map((e) => e.description).join("; ")}`,
      );
      logger.info("SDK version change", {
        api: api.name,
        event: "sdk_version",
        details: sdkEvents[0]?.details,
      });
    } else {
      spinner?.succeed(`${api.name}: SDK version unchanged (or baselined)`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    spinner?.fail(`${api.name} sdk: ${msg}`);
    logger.error(`SDK watch failed for ${api.name}`, { api: api.name, error: msg });
  }
}

async function runProbe(api: ApiEntry, events: WatchEvent[]): Promise<void> {
  const probe = api.watch?.probe;
  if (!probe) return;

  const spinner = ora(`Probing ${api.name} live endpoints...`).start();

  try {
    const probeConfig: ProbeConfig = {
      baseUrl: probe.base_url,
      endpoints: (probe.endpoints ?? []).map((e) => ({
        ...e,
        baseUrl: probe.base_url,
      })),
      auth: probe.auth
        ? {
            type: probe.auth.type,
            envVar: probe.auth.env_var,
            headerName: probe.auth.header_name,
          }
        : undefined,
      rateLimit: probe.rate_limit_ms ?? 200,
    };

    const results = await probeEndpoints(probeConfig);

    const cachedSpec = await getCachedSpec(api.name);
    if (cachedSpec) {
      const expectedSchemas = extractResponseSchemas(cachedSpec);
      const probeEvents = diffProbeResults(api.name, results, expectedSchemas);
      events.push(...probeEvents);

      if (probeEvents.length > 0) {
        spinner.warn(`${api.name}: ${probeEvents.length} discrepancy(ies) from live probe`);
      } else {
        spinner.succeed(`${api.name}: Live responses match cached spec`);
      }
    } else {
      spinner.info(`${api.name}: No cached spec to compare probes against`);
    }
  } catch (error) {
    spinner.fail(
      `${api.name} probe: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function runChangelog(api: ApiEntry, events: WatchEvent[]): Promise<void> {
  if (!api.watch?.changelog?.sources?.length) return;

  const spinner = ora(`Checking ${api.name} changelogs...`).start();

  try {
    const changelogEvents = await checkChangelogs(
      api.name,
      api.watch.changelog.sources,
    );
    events.push(...changelogEvents);

    if (changelogEvents.length > 0) {
      spinner.warn(`${api.name}: ${changelogEvents.length} new changelog entry(ies)`);
    } else {
      spinner.succeed(`${api.name}: No new changelog entries`);
    }
  } catch (error) {
    spinner.fail(
      `${api.name} changelog: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function runRepoWatch(api: ApiEntry, events: WatchEvent[]): Promise<void> {
  const repoConfig = api.watch?.repo;
  const knownRepos = getKnownSpecRepos();
  const config = repoConfig
    ? {
        repo: repoConfig.github_repo,
        specPath: repoConfig.spec_path,
        branch: repoConfig.branch,
      }
    : knownRepos.get(api.name);

  if (!config) return;

  const spinner = ora(`Checking ${api.name} spec repo...`).start();

  try {
    const repoEvents = await checkRepoChanges(api.name, config);
    events.push(...repoEvents);

    if (repoEvents.length > 0) {
      spinner.warn(`${api.name}: ${repoEvents.length} new commit(s) to spec`);
    } else {
      spinner.succeed(`${api.name}: Spec repo unchanged`);
    }
  } catch (error) {
    spinner.fail(
      `${api.name} repo: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

function extractResponseSchemas(
  spec: import("../../differ/types.js").OpenApiSpec,
): Map<string, SchemaObject> {
  const schemas = new Map<string, SchemaObject>();
  const paths = spec.paths ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const responses = (op as { responses?: Record<string, { content?: Record<string, { schema?: SchemaObject }> }> }).responses;
      if (!responses) continue;

      const successResponse = responses["200"] ?? responses["201"];
      if (!successResponse?.content) continue;

      const jsonContent = successResponse.content["application/json"];
      if (jsonContent?.schema) {
        schemas.set(`${method.toUpperCase()}:${path}`, jsonContent.schema);
      }
    }
  }

  return schemas;
}
