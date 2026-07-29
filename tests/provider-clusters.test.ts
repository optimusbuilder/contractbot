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
});
