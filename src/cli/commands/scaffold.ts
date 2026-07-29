import { loadConfig } from "../../config/loader.js";
import { join, resolve } from "path";
import { createProvider } from "../../providers/index.js";
import { buildCachedIntegrationEvidence, buildProviderEvidenceClusters, inspectTestRepository, parseVerificationScaffold, saveVerificationScaffold } from "../../investigator/index.js";

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
  const selected = [...cluster.evidence.filter((item) => item.kind === "sdk_construction"), ...cluster.evidence.filter((item) => item.kind !== "sdk_construction")].slice(0, 16);
  const testProfile = await inspectTestRepository(projectDir);
  if (testProfile.frameworks.length === 0 || testProfile.testCommands.length === 0) throw new Error("No supported test framework and test command were found. Scaffold drafts require local test-runner evidence.");
  const provider = createProvider(config.ai);
  const response = await provider.generate(
    `Draft a review-only verification scaffold. Return JSON only: {"summary":"...","safety":"read_only|test_account_required|manual_only","requiredEnv":["..."],"targetFile":"proposed relative test path","testCommand":"proposed command","citedEvidence":[{"file":"exact","line":number,"kind":"exact","value":"exact"}],"steps":["..."],"draft":"test code"}. targetFile must be a new test path under tests/ or __tests__, or end in .test.* or .spec.*. Use exactly one detected framework and an allowed command. Reuse the supplied test conventions. Import only installed packages. SDK construction and method calls must follow the cited local context exactly; do not invent SDK signatures. A scaffold needing credentials or any provider/model/embedding call is test_account_required, never read_only. read_only is allowed only for a fully mocked draft with no credential and no provider call.\n\nApproved contract: ${JSON.stringify(api.contract)}\nConfigured verification: ${api.verify?.command ?? "none"}\nRepository test profile: ${JSON.stringify(testProfile)}\nCited integration evidence: ${JSON.stringify(selected)}`,
    "You are a conservative verification engineer. Produce a cited draft that is validated against the supplied local repository evidence.",
  );
  const scaffold = parseVerificationScaffold(response, selected, testProfile);
  if (!scaffold) throw new Error("AI did not return a valid cited verification scaffold.");
  const path = await saveVerificationScaffold(projectDir, apiName, scaffold);
  console.log(JSON.stringify({ scaffold, reviewPath: path }, null, 2));
}
