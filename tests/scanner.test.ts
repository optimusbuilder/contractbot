import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { scanForApiUsages } from "../src/scanner/scanner.js";
import { scanPythonForApiUsages } from "../src/scanner/python.js";
import { scanAllLanguages } from "../src/scanner/index.js";

const TEST_DIR = join(process.cwd(), ".test-scanner-tmp");

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("scanForApiUsages (TypeScript)", () => {
  it("finds fetch calls with matching API paths", async () => {
    await writeFile(
      join(TEST_DIR, "src/client.ts"),
      `
const resp = await fetch("/v1/users");
const data = await resp.json();
`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/v1/users"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].filePath).toContain("client.ts");
  });

  it("finds string literals matching API paths", async () => {
    await writeFile(
      join(TEST_DIR, "src/routes.ts"),
      `
const USERS_ENDPOINT = "/api/v2/accounts";
export default USERS_ENDPOINT;
`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/api/v2/accounts"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("finds axios method calls near matching paths", async () => {
    await writeFile(
      join(TEST_DIR, "src/service.ts"),
      `
import axios from "axios";
const result = await axios.get("/api/v1/orders");
`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/api/v1/orders"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array when no matches found", async () => {
    await writeFile(
      join(TEST_DIR, "src/empty.ts"),
      `const x = 42;\nconsole.log(x);`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/v1/nonexistent"],
    );

    expect(usages).toHaveLength(0);
  });

  it("deduplicates usages at the same file:line", async () => {
    await writeFile(
      join(TEST_DIR, "src/dup.ts"),
      `const url = "/v1/users";\nfetch(url);`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/v1/users"],
    );

    const keys = usages.map((u) => `${u.filePath}:${u.line}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it("handles template literals with API paths", async () => {
    await writeFile(
      join(TEST_DIR, "src/template.ts"),
      "const id = 123;\nconst url = `/v1/users/${id}`;\nfetch(url);",
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/v1/users"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("matches path patterns with path params", async () => {
    await writeFile(
      join(TEST_DIR, "src/params.ts"),
      `const url = "/v1/users/abc123/profile";\nfetch(url);`,
      "utf-8",
    );

    const usages = await scanForApiUsages(
      [join(TEST_DIR, "src/**/*.ts")],
      ["/v1/users/{userId}/profile"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("scanPythonForApiUsages", () => {
  it("finds requests.get calls with matching paths", async () => {
    await writeFile(
      join(TEST_DIR, "src/client.py"),
      `
import requests
resp = requests.get("https://api.example.com/v1/users")
data = resp.json()
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(
      [join(TEST_DIR, "src/**/*.py")],
      ["/v1/users"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].filePath).toContain("client.py");
  });

  it("detects httpx calls", async () => {
    await writeFile(
      join(TEST_DIR, "src/async_client.py"),
      `
import httpx
resp = httpx.post("https://api.example.com/v1/orders", json=data)
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(
      [join(TEST_DIR, "src/**/*.py")],
      ["/v1/orders"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].methodHint).toBe("POST");
  });

  it("finds API path strings even without HTTP call on same line", async () => {
    await writeFile(
      join(TEST_DIR, "src/urls.py"),
      `
USERS_URL = "https://api.example.com/v1/users"
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(
      [join(TEST_DIR, "src/**/*.py")],
      ["/v1/users"],
    );

    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for non-matching files", async () => {
    await writeFile(
      join(TEST_DIR, "src/util.py"),
      `def add(a, b):\n    return a + b`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(
      [join(TEST_DIR, "src/**/*.py")],
      ["/v1/users"],
    );

    expect(usages).toHaveLength(0);
  });
});

describe("scanAllLanguages", () => {
  it("scans only specified languages", async () => {
    await writeFile(
      join(TEST_DIR, "src/client.ts"),
      `fetch("/v1/users");`,
      "utf-8",
    );
    await writeFile(
      join(TEST_DIR, "src/client.py"),
      `requests.get("https://api.example.com/v1/users")`,
      "utf-8",
    );

    const tsOnly = await scanAllLanguages(
      [join(TEST_DIR, "src/**/*")],
      ["/v1/users"],
      ["typescript"],
    );
    const allTs = tsOnly.every((u) => u.filePath.endsWith(".ts"));
    expect(allTs).toBe(true);
  });

  it("deduplicates across languages", async () => {
    await writeFile(
      join(TEST_DIR, "src/app.ts"),
      `fetch("/v1/users");`,
      "utf-8",
    );

    const usages = await scanAllLanguages(
      [join(TEST_DIR, "src/**/*")],
      ["/v1/users"],
      ["typescript"],
    );

    const keys = usages.map((u) => `${u.filePath}:${u.line}`);
    expect(keys.length).toBe(new Set(keys).size);
  });
});
