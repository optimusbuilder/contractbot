import { existsSync } from "fs";
import chalk from "chalk";
import { saveConfig } from "../../config/loader.js";
import { DEFAULT_CONFIG, ApihealerConfig } from "../../config/schema.js";

interface InitOptions {
  dir: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const configPath = `${options.dir}/.apihealer.yml`.replace(/^\.\//, "");

  if (existsSync(configPath)) {
    console.log(chalk.yellow(`Config already exists: ${configPath}`));
    console.log(chalk.dim("Delete it first if you want to reinitialize."));
    return;
  }

  const config: ApihealerConfig = {
    ...DEFAULT_CONFIG,
    apis: [
      {
        name: "example-api",
        spec: "https://petstore3.swagger.io/api/v3/openapi.json",
        scan_paths: ["src/**/*.ts", "src/**/*.js"],
      },
    ],
  };

  await saveConfig(configPath, config);

  console.log();
  console.log(chalk.green.bold("✓ Created .apihealer.yml"));
  console.log();
  console.log(chalk.white("Next steps:"));
  console.log(chalk.dim("  1. Edit .apihealer.yml to add your real API specs"));
  console.log(chalk.dim("  2. Set your AI provider API key:"));
  console.log(chalk.dim("     export OPENAI_API_KEY=sk-..."));
  console.log(chalk.dim("     export ANTHROPIC_API_KEY=sk-ant-..."));
  console.log(chalk.dim("  3. Run: apihealer watch"));
  console.log();
}
