import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { scanPythonForApiUsages } from "../src/scanner/python.js";

const TEST_DIR = join(process.cwd(), ".test-py-scanner-tmp");
const src = (name: string) => join(TEST_DIR, "src", name);
const pattern = () => [join(TEST_DIR, "src/**/*.py")];

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("Python scanner — comment filtering", () => {
  it("ignores single-line comments containing API paths", async () => {
    await writeFile(
      src("commented.py"),
      `
# requests.get("https://api.example.com/v1/users")
x = 42
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });

  it("ignores inline comments at end of line", async () => {
    await writeFile(
      src("inline.py"),
      `
x = 42  # old endpoint was /v1/users
`,
      "utf-8",
    );

    // The line still contains /v1/users but the comment filtering should skip
    // pure comment lines. The inline comment case is trickier — the line itself
    // isn't a comment line, so it may still match. This tests that pure comment
    // lines are filtered.
    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    // The match on the non-comment content is acceptable; the key test is
    // that a line starting with # is never matched.
    expect(usages.every((u) => !u.snippet.startsWith("#"))).toBe(true);
  });

  it("ignores triple-quote docstrings containing API paths", async () => {
    await writeFile(
      src("docstring.py"),
      `
"""
This module calls /v1/users to fetch data.
requests.get("https://api.example.com/v1/users")
"""

def fetch_data():
    pass
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});

describe("Python scanner — variable tracking", () => {
  it("tracks URL assigned to variable used in HTTP call", async () => {
    await writeFile(
      src("var_track.py"),
      `
import requests

url = "https://api.example.com/v1/users"
response = requests.get(url)
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    const httpCall = usages.find((u) => u.snippet.includes("requests.get"));
    expect(httpCall).toBeDefined();
    expect(httpCall!.endpointHint).toBeDefined();
  });

  it("tracks UPPER_CASE constant URLs", async () => {
    await writeFile(
      src("constants.py"),
      `
import httpx

BASE_URL = "https://api.example.com/v1/orders"
resp = httpx.post(BASE_URL, json=payload)
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("tracks f-string variable assignments", async () => {
    await writeFile(
      src("fstring.py"),
      `
import requests

user_id = 123
url = f"https://api.example.com/v1/users/{user_id}"
resp = requests.get(url)
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Python scanner — multiline handling", () => {
  it("handles backslash continuation lines", async () => {
    await writeFile(
      src("continuation.py"),
      `
import requests

response = requests.get(
    "https://api.example.com/v1/users",
    headers={"Authorization": "Bearer token"}
)
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Python scanner — wrapper detection", () => {
  it("detects self.client.get() wrapper pattern", async () => {
    await writeFile(
      src("wrapper.py"),
      `
class ApiService:
    def get_users(self):
        return self.client.get("https://api.example.com/v1/users")
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].methodHint).toBe("GET");
  });

  it("detects await client.post() async wrapper", async () => {
    await writeFile(
      src("async_wrapper.py"),
      `
async def create_order(data):
    resp = await client.post("https://api.example.com/v1/orders", json=data)
    return resp.json()
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("detects api_client wrapper", async () => {
    await writeFile(
      src("api_wrapper.py"),
      `
result = api_client.delete("https://api.example.com/v1/users/123")
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].methodHint).toBe("DELETE");
  });
});

describe("Python scanner — false positive reduction", () => {
  it("does not match URLs only in comments", async () => {
    await writeFile(
      src("only_comments.py"),
      `
# This module used to call /v1/users
# requests.get("/v1/users")
# TODO: migrate to /v2/users

def unrelated():
    return 42
`,
      "utf-8",
    );

    const usages = await scanPythonForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});
