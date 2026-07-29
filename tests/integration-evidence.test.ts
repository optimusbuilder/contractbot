import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { buildIntegrationEvidence } from "../src/investigator/index.js";

const DIR = join(process.cwd(), ".test-integration-evidence");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("buildIntegrationEvidence", () => {
  it("distinguishes SDKs, HTTP calls, navigation, and static assets", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    await writeFile(join(DIR, "src", "client.tsx"), `import { Browserbase } from "@browserbasehq/sdk";\nconst key = process.env.BROWSERBASE_API_KEY;\nfetch("https://api.elevenlabs.io/v1/voices");\npage.goto("https://craigslist.org");\nconst image = <img src="https://images.unsplash.com/a.jpg" />;`);
    const evidence = await buildIntegrationEvidence(DIR);

    expect(evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["sdk_import", "environment_variable", "http_request", "browser_navigation", "static_asset"]));
  });

  it("traces URL variables to their immediate request or navigation call site", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    await writeFile(join(DIR, "src", "routes.ts"), 'const apiUrl = "https://api.example.dev/v1"; fetch(apiUrl); const listingUrl = "https://listings.vendor.dev/listings"; page.goto(listingUrl);');
    const evidence = await buildIntegrationEvidence(DIR);

    expect(evidence.find((item) => item.value.includes("api.example.dev"))?.kind).toBe("http_request");
    expect(evidence.find((item) => item.value.includes("listings.vendor.dev"))?.kind).toBe("browser_navigation");
  });

  it("extracts cited Python and Dart SDK, env, and HTTP evidence", async () => {
    await mkdir(join(DIR, "backend"), { recursive: true });
    await mkdir(join(DIR, "mobile"), { recursive: true });
    await writeFile(join(DIR, "backend", "client.py"), 'import openai\nimport os\nkey = os.getenv("OPENAI_API_KEY")\nclient = OpenAI()\nindex = Pinecone()\nrequests.get("https://api.openai.com/v1/models")');
    await writeFile(join(DIR, "mobile", "client.dart"), "import 'package:firebase_core/firebase_core.dart';\nfinal key = Platform.environment['FIREBASE_API_KEY'];\nawait Firebase.initializeApp();\nfinal db = FirebaseFirestore.instance;\nhttp.get(Uri.parse('https://firestore.googleapis.com/v1'));");
    const evidence = await buildIntegrationEvidence(DIR);

    expect(evidence.map((item) => item.value)).toEqual(expect.arrayContaining(["openai", "pinecone", "OPENAI_API_KEY", "https://api.openai.com/v1/models", "package:firebase_core/firebase_core.dart", "firebase", "firestore", "FIREBASE_API_KEY", "https://firestore.googleapis.com/v1"]));
    expect(evidence.filter((item) => item.kind === "http_request")).toHaveLength(2);
  });

  it("excludes metadata and local endpoint URLs from agent evidence", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    await writeFile(join(DIR, "src", "hosts.ts"), 'fetch("http://metadata.google.internal/token"); fetch("https://api.example.dev");');
    const evidence = await buildIntegrationEvidence(DIR);
    expect(evidence.map((item) => item.value)).toContain("https://api.example.dev");
    expect(evidence.map((item) => item.value)).not.toContain("http://metadata.google.internal/token");
  });
});
