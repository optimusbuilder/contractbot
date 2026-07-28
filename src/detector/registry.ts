import {
  ApiContract,
  WatchStrategy,
  ApiUrgency,
} from "../config/schema.js";

/**
 * Community-contributable catalog entry.
 * Enrichment for discovery — not a whitelist gate.
 */
export interface CatalogEntry {
  name: string;
  baseUrls: string[];
  packages: string[];
  envVars: string[];
  /** Preferred contract when this API is detected */
  contract?: ApiContract;
  defaultWatch?: WatchStrategy[];
  changelogRepo?: string;
  urgency?: ApiUrgency;
}

/** @deprecated Use CatalogEntry — kept for existing imports */
export type KnownApi = CatalogEntry & { specUrl: string };

export const API_CATALOG: CatalogEntry[] = [
  {
    name: "stripe",
    baseUrls: ["https://api.stripe.com"],
    packages: ["stripe"],
    envVars: ["STRIPE_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
    urgency: "critical",
  },
  {
    name: "github",
    baseUrls: ["https://api.github.com"],
    packages: ["@octokit/rest", "@octokit/core", "octokit"],
    envVars: ["GITHUB_TOKEN", "GITHUB_API_KEY", "GH_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "twilio",
    baseUrls: ["https://api.twilio.com"],
    packages: ["twilio"],
    envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "sendgrid",
    baseUrls: ["https://api.sendgrid.com"],
    packages: ["@sendgrid/mail", "@sendgrid/client"],
    envVars: ["SENDGRID_API_KEY"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/sendgrid/sendgrid-oai/main/oai.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "openai",
    baseUrls: ["https://api.openai.com"],
    packages: ["openai"],
    envVars: ["OPENAI_API_KEY"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "slack",
    baseUrls: ["https://slack.com/api"],
    packages: ["@slack/web-api", "@slack/bolt"],
    envVars: ["SLACK_TOKEN", "SLACK_BOT_TOKEN", "SLACK_API_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "shopify",
    baseUrls: ["https://*.myshopify.com/admin/api"],
    packages: ["@shopify/shopify-api", "shopify-api-node"],
    envVars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_ACCESS_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://shopify.dev/docs/api/admin-rest/2024-01.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "spotify",
    baseUrls: ["https://api.spotify.com", "https://accounts.spotify.com"],
    packages: ["spotify-web-api-node"],
    envVars: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
    contract: {
      type: "openapi",
      url: "https://developer.spotify.com/reference/web-api/open-api-schema.yaml",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "elevenlabs",
    baseUrls: ["https://api.elevenlabs.io"],
    packages: ["elevenlabs"],
    envVars: ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID"],
    contract: {
      type: "openapi",
      url: "https://api.elevenlabs.io/openapi.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "pinecone",
    baseUrls: [],
    packages: ["@pinecone-database/pinecone"],
    envVars: ["PINECONE_API_KEY", "PINECONE_INDEX_NAME"],
    contract: {
      type: "sdk_package",
      ecosystem: "npm",
      package: "@pinecone-database/pinecone",
      resolved_via: "catalog",
    },
    defaultWatch: ["sdk_version"],
  },
  {
    name: "gemini",
    baseUrls: ["https://generativelanguage.googleapis.com"],
    packages: ["@google/generative-ai", "@google/genai"],
    envVars: ["GEMINI_API_KEY"],
    contract: {
      type: "sdk_package",
      ecosystem: "npm",
      package: "@google/generative-ai",
      resolved_via: "catalog",
    },
    defaultWatch: ["sdk_version"],
  },
  {
    name: "google-adk",
    baseUrls: [],
    packages: ["@google/adk"],
    envVars: [],
    contract: {
      type: "sdk_package",
      ecosystem: "npm",
      package: "@google/adk",
      resolved_via: "catalog",
    },
    defaultWatch: ["sdk_version"],
  },
  {
    name: "picovoice",
    baseUrls: [],
    packages: ["@picovoice/porcupine-node", "@picovoice/pvrecorder-node"],
    envVars: ["PICOVOICE_ACCESS_KEY"],
    contract: {
      type: "sdk_package",
      ecosystem: "npm",
      package: "@picovoice/porcupine-node",
      resolved_via: "catalog",
    },
    defaultWatch: ["sdk_version"],
  },
  {
    name: "vertex-ai",
    baseUrls: ["https://aiplatform.googleapis.com", "https://*-aiplatform.googleapis.com"],
    packages: ["@google-cloud/aiplatform"],
    envVars: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
    defaultWatch: ["changelog"],
  },
  {
    name: "tavily",
    baseUrls: ["https://api.tavily.com"],
    packages: ["tavily"],
    envVars: ["TAVILY_API_KEY"],
    defaultWatch: ["changelog"],
  },
  {
    name: "discord",
    baseUrls: ["https://discord.com/api"],
    packages: ["discord.js", "discord-api-types"],
    envVars: ["DISCORD_TOKEN", "DISCORD_BOT_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "petstore",
    baseUrls: ["https://petstore3.swagger.io", "https://petstore.swagger.io"],
    packages: [],
    envVars: [],
    contract: {
      type: "openapi",
      url: "https://petstore3.swagger.io/api/v3/openapi.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "firebase",
    baseUrls: ["https://firestore.googleapis.com", "https://firebase.googleapis.com"],
    packages: ["firebase", "firebase-admin"],
    envVars: ["FIREBASE_API_KEY", "FIREBASE_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://firebase.googleapis.com/$discovery/rest?version=v1beta1",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "supabase",
    baseUrls: [".supabase.co/rest/v1", "https://*.supabase.co"],
    packages: ["@supabase/supabase-js"],
    envVars: ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_ANON_KEY"],
    contract: {
      type: "sdk_package",
      ecosystem: "npm",
      package: "@supabase/supabase-js",
      resolved_via: "catalog",
    },
    defaultWatch: ["sdk_version", "changelog"],
    changelogRepo: "supabase/supabase-js",
    urgency: "critical",
  },
  {
    name: "notion",
    baseUrls: ["https://api.notion.com"],
    packages: ["@notionhq/client"],
    envVars: ["NOTION_API_KEY", "NOTION_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/NotionAPI/notion-sdk-js/main/openapi.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
  {
    name: "plaid",
    baseUrls: ["https://production.plaid.com", "https://sandbox.plaid.com"],
    packages: ["plaid"],
    envVars: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/plaid/plaid-openapi/master/2020-09-14.yml",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
    urgency: "critical",
  },
  {
    name: "cloudflare",
    baseUrls: ["https://api.cloudflare.com"],
    packages: ["cloudflare"],
    envVars: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
    contract: {
      type: "openapi",
      url: "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json",
      resolved_via: "catalog",
    },
    defaultWatch: ["spec_poll"],
  },
];

/** Backward-compatible export used by older code paths */
export const KNOWN_APIS: KnownApi[] = API_CATALOG.map((entry) => ({
  ...entry,
  specUrl:
    entry.contract?.type === "openapi" ? entry.contract.url : "",
}));

export function findCatalogByPackage(packageName: string): CatalogEntry | undefined {
  return API_CATALOG.find((e) => e.packages.includes(packageName));
}

export function findCatalogByHost(url: string): CatalogEntry | undefined {
  return API_CATALOG.find((e) =>
    e.baseUrls.some((base) => matchBaseUrl(url, base)),
  );
}

export function findCatalogByEnvVar(envVar: string): CatalogEntry | undefined {
  return API_CATALOG.find((e) => e.envVars.includes(envVar));
}

export function findCatalogByName(name: string): CatalogEntry | undefined {
  return API_CATALOG.find((e) => e.name === name);
}

function matchBaseUrl(url: string, base: string): boolean {
  if (base.startsWith(".") && !base.startsWith("http")) {
    return url.includes(base) || url.includes(base.slice(1));
  }
  if (base.includes("*")) {
    const regex = new RegExp(
      "^" + base.replace(/\./g, "\\.").replace(/\*/g, "[^/]+"),
    );
    return regex.test(url);
  }
  return url.startsWith(base) || url.includes(base);
}
