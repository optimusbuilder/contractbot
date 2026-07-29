import { loadConfig } from "../../config/loader.js";
import { join, resolve } from "path";
import { createProvider } from "../../providers/index.js";
import { buildCachedIntegrationEvidence, buildProviderEvidenceClusters, parseVerificationScaffold, saveVerificationScaffold } from "../../investigator/index.js";

interface ScaffoldOptions { config: string; dir: string; refresh?: boolean }

export async function scaffoldCommand(apiName: string, options: ScaffoldOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const configPath = options.config === ".contractbot.yml" ? join(projectDir, options.config) : options.config;
  const config = await loadConfig(configPath);
  const api = config.apis.find((entry) => entry.name === apiName);
  if (!api?.contract || api.contract.type === "unresolved") throw new Error(`${apiName} needs an approved contract before scaffolding verification.`);
  const evidence = await buildCachedIntegrationEvidence(projectDir, options.refresh);
  const cluster = buildProviderEvidenceClusters(evidence).find((item) => item.provider === apiName);
  if (!cluster) throw new Error(`No cited local integration evidence found for ${apiName}. Review the provider configuration first.`);
  const selected = cluster.evidence.slice(0, 16);
  const provider = createProvider(config.ai);
  const response = await provider.generate(
    `Draft a safe verification scaffold for an approved external integration. Return JSON only: {"summary":"...","safety":"read_only|test_account_required|manual_only","requiredEnv":["..."],"targetFile":"proposed relative test path","testCommand":"proposed command","citedEvidence":[{"file":"exact","line":number,"kind":"exact","value":"exact"}],"steps":["..."],"draft":"test code or pseudocode"}. Do not mutate resources, create paid operations, or claim the test is safe unless the evidence proves it. Prefer read-only checks; otherwise use test_account_required or manual_only.\n\nApproved contract: ${JSON.stringify(api.contract)}\nConfigured verification: ${api.verify?.command ?? "none"}\nCited integration evidence: ${JSON.stringify(selected)}`,
    "You are a conservative verification engineer. Produce a review-only draft with exact citations.",
  );
  const scaffold = parseVerificationScaffold(response, selected);
  if (!scaffold) throw new Error("AI did not return a valid cited verification scaffold.");
  const path = await saveVerificationScaffold(projectDir, apiName, scaffold);
  console.log(JSON.stringify({ scaffold, reviewPath: path }, null, 2));
}
