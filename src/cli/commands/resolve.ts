import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig } from "../../config/loader.js";
import { resolveApiContract } from "../../resolver/index.js";
import { logger } from "../../logger.js";

interface ResolveCommandOptions {
  config: string;
  webSearch?: boolean;
  api?: string;
}

export async function resolveCommand(options: ResolveCommandOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const targets = options.api
    ? config.apis.filter((a) => a.name === options.api)
    : config.apis.filter((a) => a.needs_resolve || a.contract?.type === "unresolved");

  if (targets.length === 0) {
    logger.info("Nothing to resolve — all APIs have contracts");
    if (!logger.isJsonMode()) {
      console.log(chalk.green("✓ All APIs already have contracts."));
    }
    return;
  }

  logger.info("Resolving API contracts", {
    event: "resolve_start",
    count: targets.length,
    webSearch: Boolean(options.webSearch),
  });

  let resolvedCount = 0;

  for (const api of targets) {
    const spinner = logger.isJsonMode()
      ? null
      : ora(`Resolving ${api.name}...`).start();

    try {
      const result = await resolveApiContract(api, {
        webSearch: options.webSearch,
      });

      const idx = config.apis.findIndex((a) => a.name === api.name);
      if (idx >= 0) config.apis[idx] = result.api;

      if (result.resolved) {
        resolvedCount++;
        spinner?.succeed(result.message);
        logger.info(result.message, {
          event: "resolve_ok",
          api: api.name,
          method: result.method,
        });
      } else {
        spinner?.warn(result.message);
        logger.warn(result.message, {
          event: "resolve_pending",
          api: api.name,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner?.fail(`${api.name}: ${msg}`);
      logger.error(`Resolve failed for ${api.name}`, { api: api.name, error: msg });
    }
  }

  await saveConfig(options.config, config);

  logger.info("Resolve complete", {
    event: "resolve_complete",
    resolved: resolvedCount,
    remaining: targets.length - resolvedCount,
  });

  if (!logger.isJsonMode()) {
    console.log();
    console.log(
      chalk.green.bold(
        `✓ Updated ${options.config} (${resolvedCount}/${targets.length} resolved)`,
      ),
    );
    if (resolvedCount < targets.length && !options.webSearch) {
      console.log(
        chalk.dim("  Tip: apihealer resolve --web-search  to bootstrap unknown hosts"),
      );
    }
  }
}
