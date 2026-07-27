import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { OpenApiSpec } from "./types.js";

export async function fetchSpec(specUrl: string): Promise<OpenApiSpec> {
  if (specUrl.startsWith("http://") || specUrl.startsWith("https://")) {
    const response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch spec from ${specUrl}: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as OpenApiSpec;
  }

  if (!existsSync(specUrl)) {
    throw new Error(`Spec file not found: ${specUrl}`);
  }

  const content = await readFile(specUrl, "utf-8");

  if (specUrl.endsWith(".yaml") || specUrl.endsWith(".yml")) {
    const { parse } = await import("yaml");
    return parse(content) as OpenApiSpec;
  }

  return JSON.parse(content) as OpenApiSpec;
}
