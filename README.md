# contractbot

Contractbot helps teams review approved OpenAPI contract changes and verify application compatibility before deployment.

```
discover -> review source -> approve baseline -> CI check -> verify -> accept
```

## What It Is

Contractbot is a CI-native compatibility check for external APIs. For an approved OpenAPI source, it compares the latest upstream contract to the contract your repository accepted, runs an integration command you define, and saves an auditable pending change-set.

It is deliberately not an autonomous API repair agent. It never probes live endpoints to infer a contract, silently updates an approved baseline, edits code in CI, opens pull requests, or auto-merges changes.

## What Works Today

Contractbot is focused on one dependable workflow: compare a provider's approved OpenAPI source to your committed baseline, then run the integration verification command you own.

It supports:

- Approved OpenAPI sources and repository-stored baselines.
- Static diffs for common endpoint, method, parameter, request, and response field changes.
- Configured integration verification after a confirmed OpenAPI change.
- Explicit baseline acceptance.
- Optional manual AI migration suggestions from a confirmed change-set.
- A source-built GitHub Action that runs without an npm package release.
- Changelog contracts that flag newly published provider updates for review.

Outside the current scope:

- Complete OpenAPI compatibility coverage, especially composed, nested, security, enum, and status-code changes.
- Server-contract detection for APIs without a trustworthy published contract.
- First-class SDK upgrade verification. SDK version changes are only a signal today.
- Hosted or npm-distributed workflows.

## Try It From Source

```bash
git clone https://github.com/optimusbuilder/contractbot.git
cd contractbot
npm install
npm run build

# Discover candidate dependencies and write a config.
npm run dev -- setup

# Review .contractbot.yml, then fetch approved OpenAPI baselines.
npm run dev -- baseline

# Commit the reviewed source and baseline.
git add .contractbot.yml .contractbot/baselines .github
git commit -m "chore: baseline external API contracts"
```

Discovery is only a suggestion. Review each detected provider, source URL, and scope before creating a baseline. The committed baseline is the trust boundary. Use `contractbot ignore <name>` to persistently remove a false positive from the config.

## GitHub Action

`setup` writes a read-only workflow that uses the source-built action at `optimusbuilder/contractbot@main`. It installs the target project's dependencies, builds Contractbot from the action source, runs `ci --fail-on breaking`, and uploads the report and pending change-sets as artifacts.

Before using it for production enforcement, pin the action reference in `.github/workflows/contractbot.yml` to a reviewed commit or release tag.

## Configure An Integration

```yaml
apis:
  - name: stripe
    contract:
      type: openapi
      url: https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json
    scan_paths:
      - src/**/*.ts
    verify:
      # Uses a controlled Stripe test account and must be safe to run in CI.
      command: npm run test:integration:stripe
      timeout_ms: 120000

# Optional. This is used only by `suggest`, never by CI.
ai:
  provider: openai
  model: gpt-4o-mini
```

Keep credentials in your normal CI secret manager. The verification command is your integration test, so it should use a dedicated test account, fixtures, and resources that are safe to create or modify.

## Daily Workflow

Run a compatibility check from a branch or CI job:

```bash
npm run dev -- ci --fail-on breaking --output api-report.json
```

When a provider contract differs from the approved baseline, Contractbot writes:

```text
.contractbot/changes/<api>.json
```

The change-set includes:

- The old approved contract and the new provider contract.
- The structural diff.
- The configured verification command and its result.
- Source metadata and timestamps.

The old baseline remains unchanged. Review the report and change-set, update the integration, then rerun verification. Once the migration is safe, accept the provider's new contract explicitly:

```bash
npm run dev -- accept stripe
git add .contractbot/baselines
git commit -m "chore: accept Stripe contract update"
```

## Optional AI Suggestions

After a confirmed change-set exists, you may ask an LLM for a local migration draft:

```bash
npm run dev -- suggest stripe
```

This is optional and manual. It reads the affected source files and sends them to the configured LLM provider. It saves a patch locally; it does not edit source files, create a branch, open a pull request, or run in CI. Review a patch before applying it:

```bash
npm run dev -- apply <patch-id> --interactive
```

## Discovery Confidence

Setup looks for SDK packages, environment-variable names, and literal API hosts. These signals have different confidence levels:

| Signal | Confidence | Example |
| --- | --- | --- |
| Provider-specific package import | Usually high | `stripe`, `openai` |
| Provider-specific host | Medium to high | `https://api.stripe.com` |
| Environment variable name | Medium | `STRIPE_SECRET_KEY` |
| Generic host or key | Low | `API_KEY`, `api.acme.dev` |

Contractbot must never be trusted to pick the contract source without review. Unknown APIs remain unresolved until you provide a source or choose to ignore them.

## Commands

| Command | Purpose |
| --- | --- |
| `setup` | Discover candidate API dependencies and write configuration. |
| `baseline` | Fetch an approved OpenAPI baseline. |
| `ci` | Compare the current contract to the approved baseline and run verification on change. |
| `show <api>` | Read a pending change-set in the terminal. |
| `accept <api>` | Promote a reviewed pending change-set to the approved baseline. |
| `suggest <api>` | Generate an optional local AI migration draft from a pending change-set. |
| `apply <patch-id>` | Interactively apply a saved migration draft. |
| `resolve` | Resolve an explicitly configured but unresolved API source. |

`watch` is currently a non-blocking alias for `ci`. It is not live-response probing.

Changelog-only integrations can use `contract.type: changelog`. Contractbot records the first check as a baseline, then reports newly published entries as review signals. A changelog is not treated as a verified API contract diff.

## Principles

- Contract sources and baselines are explicit and reviewable.
- CI is deterministic; it does not use AI or make code changes.
- Your auth-aware integration verification is the compatibility authority.
- AI is optional assistance after evidence exists, not a decision-maker.
- A provider that changes its server without publishing a contract, SDK update, or notice cannot be fully detected ahead of time.

## AI Agent Usage

Contractbot is designed to work with coding agents, but agents must not treat a detected change as approval to change production code or accept a new provider contract. The repository includes [`AGENTS.md`](AGENTS.md) with the required safe workflow:

```text
detect -> show evidence -> run verification -> request review -> accept only with explicit approval
```

`suggest` is optional and sends relevant source files to the configured LLM provider. An agent must obtain explicit approval before invoking it, applying a generated patch, or accepting a change-set.

## Development

```bash
npm install
npm test
npm run test:pack
npm run build
npm run dev -- --help
```

`prepublishOnly` runs tests and package smoke tests. No new package version should be published until the alpha workflow has been validated with real users.

## License

MIT
