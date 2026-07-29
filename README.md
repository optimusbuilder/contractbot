# Contractbot

Catch breaking changes in third-party APIs before they break your application.

Contractbot watches an approved OpenAPI contract, compares it with the latest
provider version, runs your existing verification command when it changes, and
requires a human to approve the next baseline.

```text
review source -> baseline -> CI detects change -> verify -> human accepts
```

## Start Here

Run this in the repository that consumes external APIs:

```bash
npx contractbot setup
```

It creates `.contractbot.yml` and, when every detected contract is resolved,
`.github/workflows/contractbot.yml`.

Review `.contractbot.yml` before continuing. You must confirm that every
contract URL is provider-owned and that each verification command is safe to
run in CI.

```bash
npx contractbot baseline
git add .contractbot.yml .contractbot/baselines .github/workflows/contractbot.yml
git commit -m "chore: monitor external API contracts"
```

That is the initial setup. The committed baseline is the provider contract your
repository currently accepts.

## When An API Changes

CI runs this command every four hours and on pull requests:

```bash
npx contractbot ci --fail-on breaking
```

If nothing changed, CI passes. If the provider makes a breaking change:

1. CI fails and writes `.contractbot/changes/<api>.json`.
2. Contractbot runs the configured verification command.
3. Read the pending change:

```bash
npx contractbot show openai
```

4. Update your integration and tests if required.
5. After a human reviews the provider contract and the verification result:

```bash
npx contractbot accept openai
git add .contractbot/baselines
git commit -m "chore: accept OpenAI contract update"
```

`accept` is deliberately manual. Contractbot never silently replaces an
approved baseline.

## Configuration

This is a complete minimal example:

```yaml
apis:
  - name: openai
    contract:
      type: openapi
      url: https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml
    scan_paths:
      - backend/utils/llm/providers.py
      - backend/utils/llm/clients.py
    verify:
      command: cd backend && pytest tests/unit/test_llm_gateway_openai_provider.py -v
      timeout_ms: 120000
```

`scan_paths` identify the local integration. `verify.command` is your existing
test or verification command. It should use a dedicated test account, fixtures,
and the least-privileged credentials required for CI.

## GitHub Actions

`setup` generates a workflow using `optimusbuilder/contractbot@v0`. Pin a
production workflow to a reviewed release tag or commit SHA.

The generated schedule is six checks per day:

```yaml
schedule:
  - cron: '17 */4 * * *'
```

Change that cron expression in `.github/workflows/contractbot.yml` to choose
your own cadence. For example, `'17 6 * * *'` runs once daily at 06:17 UTC.
More frequent checks can rerun a failing `verify.command`, so keep that command
idempotent and safe for your selected schedule.

The action installs Contractbot's own runtime. Your repository still needs to
install dependencies for `verify.command`. For example, add Python setup and
dependency installation before the Contractbot action in a Python project.

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.12"
- run: pip install -r backend/requirements.txt
- uses: optimusbuilder/contractbot@v0
```

## Credentials And BYOK

Contractbot has no hosted account, key-upload form, or secret storage.

### Provider Keys

Public OpenAPI sources need no Contractbot key. If `verify.command` needs a
provider key, supply it through your normal environment or CI secret manager.
Do not put secret values in `.contractbot.yml`.

```bash
export OPENAI_API_KEY="..."
npx contractbot ci --fail-on breaking
```

```yaml
- uses: optimusbuilder/contractbot@v0
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Private OpenAPI sources requiring authenticated fetches are not yet supported
by the core contract-fetching workflow.

### Optional AI Key

The core workflow needs no AI key. AI is only used when someone explicitly runs
an experimental AI command.

Supported AI backends are OpenAI, Anthropic, Ollama (local, no key), and
OpenAI-compatible services.

```yaml
ai:
  provider: openai
  model: gpt-4o-mini
  api_key_env: OPENAI_API_KEY
```

For an OpenAI-compatible provider, set `provider: openai`, add `base_url`, and
set `api_key_env` to its key variable. When omitted, Contractbot checks
`CONTRACTBOT_API_KEY`, `LLM_API_KEY`, then the provider default.

## AI Agent Playbook

Contractbot is designed for coding agents, but agents must not confuse a
detected change with approval to change application code or replace a baseline.

Put this in your repository's `AGENTS.md`, `CLAUDE.md`, or agent instructions:

```text
Use Contractbot's trusted workflow:
review contract source -> baseline -> detect change -> run verification -> human review -> accept

- Treat discovery and all AI output as suggestions.
- Inspect .contractbot.yml before baseline.
- Do not run baseline until the user approves the contract source.
- On a detected change, run: contractbot show <api>.
- Run the configured verification command and inspect its output.
- Do not run accept unless the user explicitly approves the new provider contract.
- Do not run suggest or apply unless the user explicitly opts in. They may send
  source code to an LLM provider or modify local files.
- Never make a live provider call merely to infer a contract.
```

Agents can use structured output for scripting:

```bash
contractbot --json discover
contractbot --json ci --fail-on breaking
```

The repository's own [`AGENTS.md`](AGENTS.md) contains the full agent safety
policy used to develop Contractbot.

## Optional AI Assistance

These commands are experimental and never run in CI:

- `discover --ai`: identifier-only source suggestions.
- `discover --agent`: bounded investigation using cited local call-site context.
- `investigate <api>`: assesses a confirmed pending change against local usage.
- `scaffold <api>`: creates a review-only verification draft.
- `suggest <api>`: creates a local migration draft from a pending change.
- `apply <patch-id>`: applies a reviewed migration draft.

AI output is a review queue, not a decision. `suggest` can send relevant source
files to the configured LLM, so it always requires explicit opt-in.

## Command Reference

- `setup`: discover integrations, resolve candidates, and write configuration.
- `baseline`: fetch approved provider contracts into `.contractbot/baselines`.
- `ci --fail-on breaking`: check contracts and create pending change-sets.
- `show <api>`: explain a pending change-set.
- `accept <api>`: manually approve a reviewed contract as the next baseline.
- `resolve`: resolve an explicitly configured unresolved contract.
- `ignore <name>`: persistently ignore an irrelevant detected provider.
- `review`: inspect or make explicit decisions about AI discovery findings.

Run `contractbot --help` for all commands and options.

## Scope

Contractbot currently supports approved OpenAPI sources, stored baselines, and
static diffs for common endpoint, method, parameter, request, and response-field
changes. It does not provide complete OpenAPI compatibility coverage, reliable
monitoring for providers without a trustworthy published contract, or hosted
workflows.

## Develop From Source

```bash
git clone https://github.com/optimusbuilder/contractbot.git
cd contractbot
npm install
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for
project policies.

## License

[MIT](LICENSE)
