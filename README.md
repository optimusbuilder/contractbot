# contractbot

**Dependabot for APIs** — open-source CLI that discovers the APIs your codebase depends on, watches contracts for breaking changes, and opens PRs with AI-generated fixes. **BYOK**. Humans review and merge.

```
setup once → watch (mechanical) → heal (BYOK) → PR
```

---

## Setup (2–3 steps)

```bash
npx contractbot setup
# add repo secret: CONTRACTBOT_API_KEY   (or: contractbot setup --secret)
git add .contractbot.yml .github && git commit -m "chore: add contractbot" && git push
```

That’s it. Watching runs every **15 minutes** (HTTP + ETag — no LLM). Fix PRs open **only when something changed**, using your key.

Fold secret setup into one command if you have [GitHub CLI](https://cli.github.com):

```bash
npx contractbot setup --secret   # prompts / uses env, runs gh secret set
git add .contractbot.yml .github && git commit -m "chore: add contractbot" && git push
```

### Fast watch, cheap detection

1. **Every 15 minutes** — fetch OpenAPI / SDK versions with **ETag / 304**
2. **Only if something moved** — `contractbot pr` with your key → open a fix PR

```yaml
apis:
  - name: stripe
    urgency: critical   # payments — keep in the 15m watch
  - name: analytics
    urgency: low        # skip with: contractbot ci --min-urgency normal
```

Catalog defaults: Stripe, Plaid, Supabase → `critical`; others → `normal`.

---

## How discovery works

`setup` (and `init`) scan packages, env vars, and URLs in code. **Unknown APIs stay in config** — they are not dropped because they were missing from a static list.

| Signal | Example | Result |
|--------|---------|--------|
| SDK package | `stripe`, `@supabase/supabase-js` | Catalog enrichment (OpenAPI or SDK watch) |
| Env vars | `STRIPE_SECRET_KEY` | Same |
| Host in code | `https://api.acme.dev/...` | Candidate; resolved via catalog / well-known paths |

Supabase has no public OpenAPI — it is watched via **`sdk_package`** (`@supabase/supabase-js` version bumps).

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

ai:
  provider: openai          # openai | anthropic | ollama
  model: gpt-4o-mini
  budget_usd: 5
  cache: true

healing:
  auto_apply: none
  output: pr
```

Legacy `spec: <url>` still works and is normalized to `contract.type: openapi` on load.

---

## Commands

| Command | Description |
|---------|-------------|
| `contractbot setup` | **Start here** — discover + resolve + write config + GitHub Action |
| `contractbot setup --secret` | Same, plus `gh secret set CONTRACTBOT_API_KEY` |
| `contractbot watch` | Poll OpenAPI / SDK versions / changelogs |
| `contractbot heal` | Diff + scan + BYOK patches |
| `contractbot pr` | Heal and open GitHub PRs |
| `contractbot apply <id>` | Apply a saved patch (`--undo` supported) |
| `contractbot ci` | CI contract check |

Global flags: `--json`, `--log-level debug|info|warn|error`, `--log-file <path>`.

### Advanced

| Command | Description |
|---------|-------------|
| `contractbot init` | Config only (no Action) |
| `contractbot resolve` | Re-resolve unresolved contracts |
| `contractbot resolve --web-search` | One-time bootstrap search for OpenAPI URLs |
| `contractbot ci --generate-action` | Write workflow without re-running discovery |

**LLM keys:** prefer `CONTRACTBOT_API_KEY`. Also accepts `LLM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `ai.api_key_env` for vendor keys (Kimi, GLM, …) with `ai.base_url`.

```yaml
ai:
  provider: openai
  model: kimi-k2.5
  base_url: https://api.moonshot.cn/v1
  api_key_env: MOONSHOT_API_KEY
```

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
npm run dev -- setup
```

## License

MIT
