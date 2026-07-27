import { FilePatch } from "./healer.js";
import { ApiChange } from "../differ/types.js";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ScoredPatch extends FilePatch {
  confidence: ConfidenceLevel;
  score: number;
  reasons: string[];
}

/**
 * Scores each patch based on the complexity of the change
 * and how likely it is to be correct.
 */
export function scorePatch(
  patch: FilePatch,
  changes: ApiChange[],
): ScoredPatch {
  const reasons: string[] = [];
  let score = 100;

  const diffSize = computeDiffSize(patch);
  if (diffSize > 50) {
    score -= 30;
    reasons.push(`Large change (${diffSize} lines modified)`);
  } else if (diffSize > 20) {
    score -= 15;
    reasons.push(`Moderate change (${diffSize} lines modified)`);
  } else {
    reasons.push(`Small change (${diffSize} lines modified)`);
  }

  const relatedChanges = findRelatedChanges(patch, changes);
  if (relatedChanges.length === 0) {
    score -= 25;
    reasons.push("No directly matching API change found");
  }

  const hasOnlyRenames = relatedChanges.every(
    (c) =>
      c.description.includes("renamed") ||
      c.description.includes("Field removed") ||
      c.description.includes("Field added"),
  );
  if (hasOnlyRenames && relatedChanges.length > 0) {
    score += 10;
    reasons.push("Simple field rename/addition/removal");
  }

  const hasTypeChanges = relatedChanges.some((c) =>
    c.description.includes("type changed"),
  );
  if (hasTypeChanges) {
    score -= 10;
    reasons.push("Involves type changes (needs careful review)");
  }

  if (patch.patchedContent.includes("TODO")) {
    score -= 20;
    reasons.push("Patch contains TODO comments (incomplete)");
  }

  const structuralChanges = countStructuralChanges(patch);
  if (structuralChanges > 3) {
    score -= 15;
    reasons.push(`Multiple structural changes (${structuralChanges} blocks)`);
  }

  if (isSimpleStringReplace(patch)) {
    score += 15;
    reasons.push("Simple string replacement pattern");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    ...patch,
    score,
    confidence: scoreToLevel(score),
    reasons,
  };
}

export function scorePatches(
  patches: FilePatch[],
  changes: ApiChange[],
): ScoredPatch[] {
  return patches.map((p) => scorePatch(p, changes));
}

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function computeDiffSize(patch: FilePatch): number {
  const oldLines = patch.originalContent.split("\n");
  const newLines = patch.patchedContent.split("\n");

  let changed = 0;
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) changed++;
  }
  return changed;
}

function findRelatedChanges(
  patch: FilePatch,
  changes: ApiChange[],
): ApiChange[] {
  return changes.filter((c) => {
    if (c.field && patch.patchedContent.includes(c.field)) return true;
    if (c.path && patch.originalContent.includes(c.path)) return true;
    return false;
  });
}

function countStructuralChanges(patch: FilePatch): number {
  const oldLines = patch.originalContent.split("\n");
  const newLines = patch.patchedContent.split("\n");

  let blocks = 0;
  let inDiff = false;

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const differs = oldLines[i] !== newLines[i];
    if (differs && !inDiff) {
      blocks++;
      inDiff = true;
    } else if (!differs) {
      inDiff = false;
    }
  }

  return blocks;
}

function isSimpleStringReplace(patch: FilePatch): boolean {
  const oldLines = patch.originalContent.split("\n");
  const newLines = patch.patchedContent.split("\n");

  if (oldLines.length !== newLines.length) return false;

  let changedCount = 0;
  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines[i] !== newLines[i]) changedCount++;
  }

  return changedCount <= 5;
}
