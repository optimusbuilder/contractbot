import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { fetchSpec, getBaseline, saveBaseline } from "../../differ/index.js";
import { getOpenApiUrl } from "../../config/schema.js";

interface BaselineOptions {
  config: string;
  api?: string;
  force?: boolean;
}

export async function baselineCommand(options: BaselineOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const apis = options.api ? config.apis.filter((api) => api.name === options.api) : config.apis;

  if (options.api && apis.length === 0) {
    throw new Error(`API not found in config: ${options.api}`);
  }

  for (const api of apis) {
    const sourceUrl = getOpenApiUrl(api);
    if (!sourceUrl) continue;

    if (await getBaseline(api.name) && !options.force) {
      console.log(chalk.dim(`${api.name}: baseline already exists (use --force to replace it)`));
      continue;
    }

    const fetched = await fetchSpec(sourceUrl);
    await saveBaseline(api.name, sourceUrl, fetched.spec, {
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      url: sourceUrl,
    });
    console.log(chalk.green(`✓ ${api.name}: baseline saved`));
  }
}
