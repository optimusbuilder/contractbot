import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveApiContract } from "../src/resolver/index.js";
import { ApiEntry } from "../src/config/schema.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveApiContract", () => {
  it("resolves from catalog by name", async () => {
    const api: ApiEntry = {
      name: "stripe",
      scan_paths: ["src/**"],
      needs_resolve: true,
      contract: { type: "unresolved" },
    };

    const result = await resolveApiContract(api);
    expect(result.resolved).toBe(true);
    expect(result.method).toBe("catalog");
    expect(result.api.contract?.type).toBe("openapi");
    expect(result.api.needs_resolve).toBe(false);
  });

  it("resolves supabase to sdk_package via catalog", async () => {
    const api: ApiEntry = {
      name: "supabase",
      scan_paths: ["src/**"],
      packages: ["@supabase/supabase-js"],
      needs_resolve: true,
      contract: { type: "unresolved" },
    };

    const result = await resolveApiContract(api);
    expect(result.resolved).toBe(true);
    expect(result.api.contract?.type).toBe("sdk_package");
  });

  it("uses package as SDK proxy when not in catalog", async () => {
    const api: ApiEntry = {
      name: "custom-sdk",
      scan_paths: ["src/**"],
      packages: ["@acme/api-client"],
      needs_resolve: true,
      contract: { type: "unresolved" },
    };

    const result = await resolveApiContract(api);
    expect(result.resolved).toBe(true);
    expect(result.method).toBe("sdk_package");
    expect(result.api.contract?.type).toBe("sdk_package");
    if (result.api.contract?.type === "sdk_package") {
      expect(result.api.contract.package).toBe("@acme/api-client");
    }
  });

  it("leaves truly unknown APIs unresolved without web search", async () => {
    const api: ApiEntry = {
      name: "mystery",
      hosts: ["https://api.totally-fake-xyz.invalid"],
      scan_paths: ["src/**"],
      needs_resolve: true,
      contract: { type: "unresolved" },
    };

    const result = await resolveApiContract(api, { webSearch: false });
    expect(result.resolved).toBe(false);
    expect(result.api.needs_resolve).toBe(true);
  });

  it("finds OpenAPI at well-known path", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/openapi.json")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ openapi: "3.0.0", info: { title: "X" }, paths: {} }),
        };
      }
      return { ok: false, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const api: ApiEntry = {
      name: "local-api",
      hosts: ["https://api.example.com"],
      scan_paths: ["src/**"],
      needs_resolve: true,
      contract: { type: "unresolved" },
    };

    const result = await resolveApiContract(api);
    expect(result.resolved).toBe(true);
    expect(result.method).toBe("well_known");
    expect(result.api.contract?.type).toBe("openapi");
  });
});
