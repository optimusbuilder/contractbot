# Contractbot Agent Instructions

Contractbot's trusted workflow is explicit:

```text
review contract source -> create baseline -> detect change -> run verification -> human review -> accept
```

## Safe Usage In A Consumer Repository

1. Treat discovery as a suggestion. Inspect `.contractbot.yml` before creating a baseline.
2. Treat `contractbot discover --ai` as an untrusted suggestion. It sends only identifiers, but its output must not be written to configuration without human review.
3. Treat `contractbot discover --agent` as an evidence-backed review queue, not an approval. It may inspect bounded call-site contexts, but no candidate, source, or classification may be written to configuration without human review.
4. Use `contractbot review add` only with a source explicitly approved by the user. `review ignore` and `review internal` also require explicit user confirmation.
5. Run `contractbot baseline` only after the user approves the configured contract source.
6. Run `contractbot ci --fail-on breaking` to create or update a pending change-set.
7. Read evidence with `contractbot show <api>`.
8. Run the configured verification command and inspect its output.
9. Only run `contractbot accept <api>` after the user explicitly approves the new provider contract.

Never run `accept`, `apply`, or `suggest` merely because CI detected a change. `suggest` can send relevant source files to the configured LLM provider and must be explicit user opt-in.

Use `contractbot ignore <name>` only after confirming a detected API is irrelevant. It persists the choice by removing the API from `.contractbot.yml` and adding it to `discovery.ignore`.

## Working On Contractbot

Run the complete release gate before proposing a release:

```bash
npm run check
```

It runs unit tests, TypeScript compilation, and the tarball lifecycle smoke test. Do not publish to npm, create a release, or move a dist-tag unless the user explicitly requests it.

Keep the CI trust boundary deterministic. Do not add live-response schema inference, automatic baseline acceptance, automatic code edits, or autonomous pull-request creation.
