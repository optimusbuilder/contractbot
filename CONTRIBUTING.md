# Contributing

Contractbot's safety boundary is intentional: contract sources and baseline
acceptance require human review, and CI must remain deterministic.

Before opening a pull request:

1. Add or update focused tests for behavior changes.
2. Run `npm run check`.
3. Do not add automatic baseline acceptance, live-response schema inference,
   autonomous code edits, or automatic pull-request creation.
4. Document any new network access or AI data sharing.

For new provider support, include deterministic evidence and a fixture that
exercises the expected contract change.
