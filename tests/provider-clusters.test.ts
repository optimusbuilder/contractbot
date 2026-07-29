import { describe, expect, it } from "vitest";
import { buildProviderEvidenceClusters } from "../src/investigator/index.js";

describe("provider evidence clusters", () => {
  it("merges Python SDK construction, env, and imports under one provider", () => {
    const clusters = buildProviderEvidenceClusters([
      { kind: "sdk_import", value: "pinecone", file: "backend/vector.py", line: 1, context: "import pinecone" },
      { kind: "sdk_construction", value: "pinecone", file: "backend/vector.py", line: 4, context: "Pinecone()" },
      { kind: "environment_variable", value: "PINECONE_API_KEY", file: "backend/vector.py", line: 5, context: "os.getenv" },
    ]);
    expect(clusters).toMatchObject([{ provider: "pinecone", evidence: [{ kind: "sdk_import" }, { kind: "sdk_construction" }, { kind: "environment_variable" }] }]);
  });

  it("groups Firebase service calls independently from generic imports", () => {
    const clusters = buildProviderEvidenceClusters([
      { kind: "service_call", value: "firebase-auth", file: "app/auth.dart", line: 4, context: "FirebaseAuth.instance" },
      { kind: "service_call", value: "firestore", file: "app/db.dart", line: 4, context: "FirebaseFirestore.instance" },
    ]);
    expect(clusters.map((cluster) => cluster.provider)).toEqual(expect.arrayContaining(["firebase-auth", "firestore"]));
  });

  it("does not let repeated framework imports outweigh a constructed SDK", () => {
    const clusters = buildProviderEvidenceClusters([
      ...Array.from({ length: 20 }, (_, line) => ({ kind: "sdk_import" as const, value: "fastapi", file: `plugins/${line}.py`, line: 1, context: "import fastapi" })),
      { kind: "sdk_construction" as const, value: "pinecone", file: "backend/vector.py", line: 4, context: "Pinecone()" },
    ]);
    expect(clusters[0]?.provider).toBe("pinecone");
  });

  it("normalizes WebSocket provider hosts through the catalog", () => {
    const clusters = buildProviderEvidenceClusters([
      { kind: "websocket_api", value: "wss://generativelanguage.googleapis.com/ws/", file: "backend/relay.py", line: 1, context: "connect" },
    ]);
    expect(clusters[0]?.provider).toBe("gemini");
  });
});
