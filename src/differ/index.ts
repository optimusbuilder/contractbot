export { fetchSpec } from "./fetcher.js";
export type { FetchSpecResult } from "./fetcher.js";
export { diffSpecs } from "./differ.js";
export { getCachedSpec, cacheSpec, getCachedMeta } from "./cache.js";
export type { SpecCacheMeta } from "./cache.js";
export {
  getBaseline,
  saveBaseline,
  getChangeSet,
  saveChangeSet,
  clearChangeSet,
} from "./baseline.js";
export type { OpenApiBaseline, OpenApiChangeSet } from "./baseline.js";
export type {
  OpenApiSpec,
  ApiChange,
  DiffResult,
  ChangeSeverity,
} from "./types.js";
