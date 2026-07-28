export {
  detectApis,
  candidateToApiEntry,
} from "./detector.js";
export type { ApiCandidate, DetectionResult, DetectedApi } from "./detector.js";
export {
  API_CATALOG,
  KNOWN_APIS,
  findCatalogByPackage,
  findCatalogByHost,
  findCatalogByEnvVar,
  findCatalogByName,
} from "./registry.js";
export type { CatalogEntry, KnownApi } from "./registry.js";
export { collectDiscoveryEvidence } from "./evidence.js";
export type { DiscoveryEvidence } from "./evidence.js";
export { collectManifestDependencies } from "./manifests.js";
