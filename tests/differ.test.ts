import { describe, it, expect } from "vitest";
import { diffSpecs } from "../src/differ/differ.js";
import { OpenApiSpec } from "../src/differ/types.js";

function makeSpec(overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
  return {
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {},
    ...overrides,
  };
}

describe("diffSpecs", () => {
  it("returns no changes for identical specs", () => {
    const spec = makeSpec({
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    });
    const result = diffSpecs("test-api", spec, spec);
    expect(result.changes).toHaveLength(0);
    expect(result.breakingCount).toBe(0);
    expect(result.nonBreakingCount).toBe(0);
  });

  it("detects removed endpoints as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    });
    const newSpec = makeSpec({ paths: {} });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].severity).toBe("breaking");
    expect(result.changes[0].description).toContain("Endpoint removed");
    expect(result.changes[0].path).toBe("/users");
  });

  it("detects added endpoints as non-breaking", () => {
    const oldSpec = makeSpec({ paths: {} });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.nonBreakingCount).toBe(1);
    expect(result.changes[0].severity).toBe("non-breaking");
    expect(result.changes[0].description).toContain("New endpoint added");
  });

  it("detects removed HTTP methods as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: { responses: {} },
          post: { responses: {} },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: { responses: {} },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("Method removed");
    expect(result.changes[0].method).toBe("post");
  });

  it("detects added HTTP methods as non-breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": { get: { responses: {} } },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: { responses: {} },
          post: { responses: {} },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.nonBreakingCount).toBe(1);
    expect(result.changes[0].description).toContain("Method added");
  });

  it("detects removed required parameter as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "page", in: "query", required: true },
            ],
            responses: {},
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: { parameters: [], responses: {} },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("Parameter removed");
    expect(result.changes[0].field).toBe("page");
  });

  it("detects removed optional parameter as non-breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "page", in: "query", required: false },
            ],
            responses: {},
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: { parameters: [], responses: {} },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.nonBreakingCount).toBe(1);
  });

  it("detects new required parameter as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: { parameters: [], responses: {} },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "apiKey", in: "header", required: true },
            ],
            responses: {},
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("[required]");
  });

  it("detects new optional parameter as non-breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: { parameters: [], responses: {} },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "limit", in: "query", required: false },
            ],
            responses: {},
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.nonBreakingCount).toBe(1);
  });

  it("detects added required request body as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          post: { responses: {} },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: { required: true, content: {} },
            responses: {},
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("Required request body added");
  });

  it("detects removed request body as non-breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: { required: true, content: {} },
            responses: {},
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          post: { responses: {} },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.nonBreakingCount).toBe(1);
    expect(result.changes[0].description).toContain("Request body removed");
  });

  it("detects response field removal as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].field).toBe("name");
    expect(result.changes[0].description).toContain("Field removed");
  });

  it("detects response field type change as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        count: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        count: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("type changed");
    expect(result.changes[0].description).toContain("string");
    expect(result.changes[0].description).toContain("integer");
  });

  it("detects field becoming required as breaking", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      email: { type: "string" },
                    },
                    required: [],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      email: { type: "string" },
                    },
                    required: ["email"],
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].description).toContain("became required");
    expect(result.changes[0].field).toBe("email");
  });

  it("resolves $ref schemas", () => {
    const oldSpec: OpenApiSpec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
          },
        },
      },
    };
    const newSpec: OpenApiSpec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "2.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
          },
        },
      },
    };

    const result = diffSpecs("test-api", oldSpec, newSpec);
    expect(result.breakingCount).toBe(1);
    expect(result.changes[0].field).toBe("id");
    expect(result.changes[0].description).toContain("type changed");
  });

  it("tracks version info from specs", () => {
    const oldSpec = makeSpec({ info: { title: "API", version: "1.0.0" } });
    const newSpec = makeSpec({ info: { title: "API", version: "2.0.0" } });

    const result = diffSpecs("my-api", oldSpec, newSpec);
    expect(result.apiName).toBe("my-api");
    expect(result.oldVersion).toBe("1.0.0");
    expect(result.newVersion).toBe("2.0.0");
  });

  it("flags source changes outside supported compatibility checks for review", () => {
    const oldSpec = makeSpec({ info: { title: "API", version: "1" } });
    const newSpec = makeSpec({ info: { title: "API", version: "1" } });
    (newSpec.info as Record<string, string>).description = "Documentation changed";

    const result = diffSpecs("my-api", oldSpec, newSpec);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].severity).toBe("info");
    expect(result.changes[0].description).toContain("review required");
  });

  it("handles specs with no paths gracefully", () => {
    const result = diffSpecs("empty-api", makeSpec(), makeSpec());
    expect(result.changes).toHaveLength(0);
    expect(result.breakingCount).toBe(0);
  });

  it("detects multiple changes across endpoints", () => {
    const oldSpec = makeSpec({
      paths: {
        "/users": { get: { responses: {} }, post: { responses: {} } },
        "/orders": { get: { responses: {} } },
      },
    });
    const newSpec = makeSpec({
      paths: {
        "/users": { get: { responses: {} } },
        "/products": { get: { responses: {} } },
      },
    });

    const result = diffSpecs("test-api", oldSpec, newSpec);
    const breaking = result.changes.filter((c) => c.severity === "breaking");
    const nonBreaking = result.changes.filter((c) => c.severity === "non-breaking");

    expect(breaking.length).toBeGreaterThanOrEqual(2); // POST /users removed + GET /orders removed
    expect(nonBreaking.length).toBeGreaterThanOrEqual(1); // GET /products added
  });
});
