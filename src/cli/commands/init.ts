import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { saveConfig } from "../../config/loader.js";
import { DEFAULT_CONFIG, ApihealerConfig } from "../../config/schema.js";
import {
  detectApis,
  candidateToApiEntry,
  ApiCandidate,
} from "../../detector/index.js";
import { logger } from "../../logger.js";

interface InitOptions {
  dir: string;
  skipDetect?: boolean;
  resolve?: boolean;
  generateAction?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const configPath = `${projectDir}/.apihealer.yml`;

  if (existsSync(configPath)) {
    logger.warn(`Config already exists: ${configPath}`);
    if (!logger.isJsonMode()) {
      console.log(chalk.dim("Delete it first if you want to reinitialize."));
    }
    return;
  }

  let candidates: ApiCandidate[] = [];

  if (!options.skipDetect) {
    const spinner = logger.isJsonMode()
      ? null
      : ora("Scanning project for API usage...").start();

    try {
      const result = await detectApis(projectDir);
      candidates = result.candidates;
      spinner?.succeed(
        `Found ${candidates.length} API dependenc${candidates.length !== 1 ? "ies" : "y"}`,
      );
      logger.info("Discovery complete", {
        event: "discover",
        count: candidates.length,
        names: candidates.map((c) => c.name),
      });
    } catch {
      spinner?.warn("Auto-detection failed, using default config");
      logger.warn("Auto-detection failed");
    }
  }

  if (candidates.length > 0 && !logger.isJsonMode()) {
    console.log();
    console.log(chalk.white.bold("Detected API dependencies:"));
    console.log();

    for (const api of candidates) {
      const badge = confidenceBadge(api.confidence);
      const status = api.needsResolve
        ? chalk.yellow("needs resolve")
        : chalk.green(
            api.suggestedContract?.type === "openapi"
              ? "openapi"
              : api.suggestedContract?.type === "sdk_package"
                ? "sdk"
                : "ok",
          );
      console.log(`  ${badge} ${chalk.cyan.bold(api.name)}  ${status}`);
      for (const ev of api.evidence.slice(0, 3)) {
        console.log(`      ${chalk.dim("•")} ${chalk.dim(ev)}`);
      }
    }
  }

  const apis =
    candidates.length > 0
      ? candidates.map(candidateToApiEntry)
      : [
          {
            name: "example-api",
            spec: "https://petstore3.swagger.io/api/v3/openapi.json",
            contract: {
              type: "openapi" as const,
              url: "https://petstore3.swagger.io/api/v3/openapi.json",
              resolved_via: "manual" as const,
            },
            scan_paths: ["src/**/*.ts", "src/**/*.js"],
            needs_resolve: false,
          },
        ];

  const config: ApihealerConfig = {
    ...DEFAULT_CONFIG,
    apis,
  };

  await saveConfig(configPath, config);

  const unresolved = apis.filter((a) => a.needs_resolve).length;

  logger.info("Created .apihealer.yml", {
    event: "init_complete",
    apis: apis.length,
    unresolved,
  });

  if (!logger.isJsonMode()) {
    console.log();
    console.log(chalk.green.bold("✓ Created .apihealer.yml"));
    if (candidates.length > 0) {
      console.log(
        chalk.dim(
          `  ${apis.length} API(s) written` +
            (unresolved > 0
              ? ` (${unresolved} need resolve — run apihealer resolve)`
              : ""),
        ),
      );
    }
    console.log();
    console.log(chalk.white("Next steps:"));
    if (unresolved > 0) {
      console.log(chalk.dim("  1. Run: apihealer resolve   # find contracts for unknown APIs"));
      console.log(chalk.dim("  2. Set your AI provider API key (BYOK):"));
    } else {
      console.log(chalk.dim("  1. Review .apihealer.yml — confirm detected APIs"));
      console.log(chalk.dim("  2. Set your AI provider API key (BYOK):"));
    }
    console.log(chalk.dim("     export OPENAI_API_KEY=sk-..."));
    console.log(chalk.dim("  3. Run: apihealer ci --generate-action   # schedule watch → heal → PR"));
    console.log(chalk.dim("  4. Or run: apihealer watch / apihealer heal / apihealer pr"));
    console.log();
  }

  if (options.generateAction) {
    const { ciCommand } = await import("./ci.js");
    await ciCommand({
      config: configPath,
      failOn: "breaking",
      generateAction: true,
    });
  }
}

function confidenceBadge(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return chalk.green("●");
    case "medium":
      return chalk.yellow("●");
    case "low":
      return chalk.dim("●");
  }
}
