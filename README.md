# apihealer

**Dependabot for APIs** — open-source CLI that discovers the APIs your codebase depends on, watches contracts for breaking changes, and opens PRs with AI-generated fixes. **BYOK** (bring your own OpenAI / Anthropic / Ollama key). Humans review and merge.

```
discover → resolve (once) → watch (mechanical) → heal (BYOK) → PR
```

---

## Install and forget

```bash
npm install -g apihealer   # or npx

cd your-project
apihealer init                 # discover Stripe, Supabase, unknown hosts, …
apihealer resolve              # lock contracts (OpenAPI / SDK)
apihealer ci --generate-action # watch every 15m → PR only on change
```

Add secrets (BYOK — heal job only, not quiet watches):

- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, or
- `APIHEALER_API_KEY` / `LLM_API_KEY` (provider-agnostic), or
- a custom name via `ai.api_key_env` (e.g. `MOONSHOT_API_KEY` for Kimi)

### Fast watch, cheap detection

Watching is **not** an LLM call. The generated Action:

1. **Every 15 minutes** — fetch OpenAPI / SDK versions with **ETag / 304** (near-free when unchanged)
2. **Only if something moved** — `apihealer pr` with your key → open a fix PR

```yaml
apis:
  - name: stripe
    urgency: critical   # payments — keep in the 15m watch
  - name: analytics
    urgency: low        # skip with: apihealer ci --min-urgency normal
```

Catalog defaults: Stripe, Plaid, Supabase → `critical`; others → `normal`.

---

## How discovery works (no whitelist gate)

`init` scans packages, env vars, and URLs in code. **Unknown APIs stay in config** — they are not dropped because they were missing from a static list.

| Signal | Example | Result |
|--------|---------|--------|
| SDK package | `stripe`, `@supabase/supabase-js` | Catalog enrichment (OpenAPI or SDK watch) |
| Env vars | `STRIPE_SECRET_KEY` | Same |
| Host in code | `https://api.acme.dev/...` | Candidate with `needs_resolve: true` |

Supabase has no public OpenAPI — it is watched via **`sdk_package`** (`@supabase/supabase-js` version bumps), not a fake spec URL.

---

## Config shape

```yaml
apis:
  - name: stripe
    contract:
      type: openapi
      url: https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json
    scan_paths: ["src/**/*.ts"]
    watch:
      strategies: [spec_poll]

  - name: supabase
    contract:
      type: sdk_package
      ecosystem: npm
      package: "@supabase/supabase-js"
    scan_paths: ["src/**/*.ts"]
    watch:
      strategies: [sdk_version, changelog]

  - name: acme
    hosts: ["https://api.acme.dev"]
    contract:
      type: unresolved
    needs_resolve: true
    scan_paths: ["src/**/*.ts"]

ai:
  provider: openai          # openai | anthropic | ollama
  model: gpt-4o-mini
  # base_url: https://api.moonshot.cn/v1   # OpenAI-compatible (Kimi, GLM, …)
  # api_key_env: MOONSHOT_API_KEY          # else: APIHEALER_API_KEY → LLM_API_KEY → OPENAI_API_KEY
  budget_usd: 5             # optional spend cap
  cache: true               # cache identical heal prompts

healing:
  auto_apply: none          # never silent-merge; PRs by default
  output: pr
```

Legacy `spec: <url>` still works and is normalized to `contract.type: openapi` on load.

---

## Commands

| Command | Description |
|---------|-------------|
| `apihealer init` | Discover API deps → write `.apihealer.yml` |
| `apihealer resolve` | Resolve unresolved contracts (catalog → well-known OpenAPI → SDK) |
| `apihealer resolve --web-search` | One-time bootstrap search for OpenAPI URLs |
| `apihealer watch` | Poll OpenAPI / SDK versions / changelogs |
| `apihealer heal` | Diff + scan + BYOK patches |
| `apihealer pr` | Heal and open GitHub PRs |
| `apihealer apply <id>` | Apply a saved patch (`--undo` supported) |
| `apihealer ci` | CI contract check |
| `apihealer ci --generate-action` | Write scheduled watch → heal → PR workflow |

Global flags: `--json`, `--log-level debug|info|warn|error`, `--log-file <path>`.

---

## What it catches (OpenAPI)

- Removed endpoints / methods  
- Renamed or removed fields  
- Type changes  
- New required parameters / body fields  

SDK contracts surface **version bumps** (major = breaking signal). Pair with release notes / changelog watch.

---

## Product principles

- **Open source** — CLI and community catalog run on your machine  
- **BYOK** — your LLM keys; code stays local  
- **Automated** — CI opens PRs; you merge  
- **Web search** — optional bootstrap only (`resolve --web-search`), not daily change detection  

---

## Development

```bash
npm install
npm test
npm run build
npm run dev -- init
```

## License

MIT
