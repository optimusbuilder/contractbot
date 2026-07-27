import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { scanGoForApiUsages } from "../src/scanner/go.js";

const TEST_DIR = join(process.cwd(), ".test-go-scanner-tmp");
const src = (name: string) => join(TEST_DIR, "src", name);
const pattern = () => [join(TEST_DIR, "src/**/*.go")];

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("Go scanner — comment filtering", () => {
  it("ignores single-line comments containing API paths", async () => {
    await writeFile(
      src("commented.go"),
      `package main

// http.Get("https://api.example.com/v1/users")
// endpoint: /v1/users
func main() {}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });

  it("ignores block comments containing API paths", async () => {
    await writeFile(
      src("block_comment.go"),
      `package main

/*
  Old endpoint: /v1/users
  http.Get("https://api.example.com/v1/users")
*/
func main() {}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});

describe("Go scanner — variable tracking", () => {
  it("tracks URL assigned to variable used in HTTP call", async () => {
    await writeFile(
      src("var_track.go"),
      `package main

import "net/http"

func main() {
	url := "https://api.example.com/v1/users"
	resp, err := http.Get(url)
	_ = resp
	_ = err
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    const httpCall = usages.find((u) => u.snippet.includes("http.Get"));
    expect(httpCall).toBeDefined();
  });

  it("tracks var declaration style", async () => {
    await writeFile(
      src("var_decl.go"),
      `package main

import "net/http"

var baseURL = "https://api.example.com/v1/orders"

func main() {
	resp, _ := http.Post(baseURL, "application/json", nil)
	_ = resp
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Go scanner — fmt.Sprintf support", () => {
  it("detects fmt.Sprintf URL construction", async () => {
    await writeFile(
      src("sprintf.go"),
      `package main

import "fmt"

func getUser(id string) {
	url := fmt.Sprintf("https://api.example.com/v1/users/%s", id)
	_ = url
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0].endpointHint).toBeDefined();
  });
});

describe("Go scanner — wrapper detection", () => {
  it("detects apiClient wrapper calls", async () => {
    await writeFile(
      src("wrapper.go"),
      `package main

func main() {
	resp := apiClient.Get("https://api.example.com/v1/users")
	_ = resp
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  it("detects custom client method calls", async () => {
    await writeFile(
      src("custom_client.go"),
      `package main

func fetchOrders(c *PaymentClient) {
	resp := c.PaymentClient.Get("https://api.example.com/v1/orders")
	_ = resp
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/orders"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Go scanner — string concatenation", () => {
  it("detects baseURL + path concatenation", async () => {
    await writeFile(
      src("concat.go"),
      `package main

import "net/http"

func main() {
	baseURL := "https://api.example.com/v1/users"
	resp, _ := http.Get(baseURL + "/active")
	_ = resp
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Go scanner — false positive reduction", () => {
  it("does not match URLs only in comments", async () => {
    await writeFile(
      src("only_comments.go"),
      `package main

// Old API: /v1/users
// http.Get("https://api.example.com/v1/users")
/* Another reference to /v1/users */

func unrelated() int {
	return 42
}
`,
      "utf-8",
    );

    const usages = await scanGoForApiUsages(pattern(), ["/v1/users"]);
    expect(usages).toHaveLength(0);
  });
});
