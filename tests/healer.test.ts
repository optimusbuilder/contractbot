import { describe, it, expect, vi } from "vitest";
import { healCode, HealError } from "../src/healer/healer.js";
import { DiffResult, ApiChange } from "../src/differ/types.js";
import { ApiUsage } from "../src/scanner/types.js";
import { LlmProvider } from "../src/providers/types.js";

function makeDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    apiName: "test-api",
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    changes: [
      {
        severity: "breaking",
        path: "/users",
        method: "get",
        description: "Field removed from response: name",
        field: "name",
      },
    ],
    breakingCount: 1,
    nonBreakingCount: 0,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<ApiUsage> = {}): ApiUsage {
  return {
    filePath: "/tmp/test-healer/src/api.ts",
    line: 5,
    column: 0,
    snippet: 'fetch("/users")',
    context: 'const resp = await fetch("/users");\nconst data = resp.json();',
    ...overrides,
  };
}

function makeMockProvider(response: string): LlmProvider {
  return {
    generate: vi.fn().mockResolvedValue(response),
  };
}

function makeFailingProvider(error: Error): LlmProvider {
  return {
    generate: vi.fn().mockRejectedValue(error),
  };
}

describe("healCode", () => {
  it("returns empty patches when no changes exist", async () => {
    const diff = makeDiff({ changes: [], breakingCount: 0 });
    const provider = makeMockProvider("[]");

    const result = await healCode(diff, [makeUsage()], provider);
    expect(result.patches).toHaveLength(0);
    expect(result.summary).toContain("No changes require code updates");
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("returns empty patches when no usages found", async () => {
    const provider = makeMockProvider("[]");

    const result = await healCode(makeDiff(), [], provider);
    expect(result.patches).toHaveLength(0);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("throws HealError with PROVIDER_ERROR when AI provider fails", async () => {
    const provider = makeFailingProvider(new Error("Rate limit exceeded"));
    const usage = makeUsage();

    // healCode reads the file, so we need to create it
    const fs = await import("fs/promises");
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync("/tmp/test-healer/src")) {
      mkdirSync("/tmp/test-healer/src", { recursive: true });
    }
    await fs.writeFile(
      "/tmp/test-healer/src/api.ts",
      'const resp = await fetch("/users");\nconst data = resp.json();\nconsole.log(data.name);',
      "utf-8",
    );

    try {
      await expect(healCode(makeDiff(), [usage], provider)).rejects.toThrow(HealError);
      await expect(healCode(makeDiff(), [usage], provider)).rejects.toThrow("Rate limit exceeded");
    } finally {
      await fs.rm("/tmp/test-healer", { recursive: true, force: true });
    }
  });

  it("includes warnings in summary when AI returns non-JSON", async () => {
    const provider = makeMockProvider("I cannot generate patches for this change.");
    const usage = makeUsage();

    const fs = await import("fs/promises");
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync("/tmp/test-healer/src")) {
      mkdirSync("/tmp/test-healer/src", { recursive: true });
    }
    await fs.writeFile(
      "/tmp/test-healer/src/api.ts",
      'const resp = await fetch("/users");\nconsole.log(resp);',
      "utf-8",
    );

    try {
      const result = await healCode(makeDiff(), [usage], provider);
      expect(result.patches).toHaveLength(0);
      expect(result.summary).toContain("Warning");
    } finally {
      await fs.rm("/tmp/test-healer", { recursive: true, force: true });
    }
  });

  it("includes warnings when AI returns malformed JSON", async () => {
    const provider = makeMockProvider("[{invalid json}]");
    const usage = makeUsage();

    const fs = await import("fs/promises");
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync("/tmp/test-healer/src")) {
      mkdirSync("/tmp/test-healer/src", { recursive: true });
    }
    await fs.writeFile(
      "/tmp/test-healer/src/api.ts",
      'const resp = await fetch("/users");',
      "utf-8",
    );

    try {
      const result = await healCode(makeDiff(), [usage], provider);
      expect(result.patches).toHaveLength(0);
      expect(result.summary).toContain("malformed JSON");
    } finally {
      await fs.rm("/tmp/test-healer", { recursive: true, force: true });
    }
  });

  it("applies valid patches from AI response", async () => {
    const aiResponse = JSON.stringify([
      {
        filePath: "/tmp/test-healer/src/api.ts",
        description: "Remove .name access",
        replacements: [
          { search: "data.name", replace: "data.fullName" },
        ],
      },
    ]);
    const provider = makeMockProvider(aiResponse);
    const usage = makeUsage();

    const fs = await import("fs/promises");
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync("/tmp/test-healer/src")) {
      mkdirSync("/tmp/test-healer/src", { recursive: true });
    }
    await fs.writeFile(
      "/tmp/test-healer/src/api.ts",
      'const resp = await fetch("/users");\nconst data = await resp.json();\nconsole.log(data.name);',
      "utf-8",
    );

    try {
      const result = await healCode(makeDiff(), [usage], provider);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].patchedContent).toContain("data.fullName");
      expect(result.patches[0].patchedContent).not.toContain("data.name");
    } finally {
      await fs.rm("/tmp/test-healer", { recursive: true, force: true });
    }
  });

  it("warns when AI references an unknown file", async () => {
    const aiResponse = JSON.stringify([
      {
        filePath: "/tmp/test-healer/src/nonexistent.ts",
        description: "Fix unknown file",
        replacements: [{ search: "old", replace: "new" }],
      },
    ]);
    const provider = makeMockProvider(aiResponse);
    const usage = makeUsage();

    const fs = await import("fs/promises");
    const { mkdirSync, existsSync } = await import("fs");
    if (!existsSync("/tmp/test-healer/src")) {
      mkdirSync("/tmp/test-healer/src", { recursive: true });
    }
    await fs.writeFile(
      "/tmp/test-healer/src/api.ts",
      'fetch("/users");',
      "utf-8",
    );

    try {
      const result = await healCode(makeDiff(), [usage], provider);
      expect(result.patches).toHaveLength(0);
      expect(result.summary).toContain("unknown file");
    } finally {
      await fs.rm("/tmp/test-healer", { recursive: true, force: true });
    }
  });
});
