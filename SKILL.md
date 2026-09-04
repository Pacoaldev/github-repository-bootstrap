---
name: github-repository-bootstrap
description: "Trigger: GitHub repository bootstrap, labels, milestones, issue templates, PR templates, Projects v2, project fields, project views. Plan and apply repository bootstrap safely."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

# GitHub Project Bootstrap

## Activation Contract

Use for repeatable GitHub repository governance or Projects v2 bootstrap. Treat `assets/config.schema.json` as the configuration contract and `scripts/bootstrap.mjs` as the execution authority.

## Hard Rules

- Run `plan` first; it must not mutate local or remote state.
- Run `apply` only after the human explicitly authorizes it with the exact SHA-256 authorization value emitted by the reviewed `plan`; never reuse a value after config, discovery, repository target, or plan changes.
- Require `gh`, an authenticated account, required scopes, access to the configured account and repository, and a valid configuration before any mutation.
- Discover before every ensure operation. Create missing configured resources; update only resources marked `managed: true` or templates with `mode: "replace"`; never delete.
- Do not invent milestones, labels, fields, views, or templates outside the configuration.
- Configure labels, milestones, project fields, and project views as object maps keyed by their managed identity; the executor sorts those keys before planning.

## Decision Gates

| Condition | Action |
|---|---|
| Preview or uncertain authorization | Run `plan` and inspect its JSON report. |
| Approved changes | Run `apply` with the exact authorization token. |
| Views API unavailable | Preserve the unsupported result; do not emulate or delete views. |
| Existing unmanaged resource differs | Report it as skipped; do not update it. |

## Execution Steps

1. Copy and tailor `assets/example.config.json`; validate it with the schema.
2. From the target repository, preview: `node .pi/skills/github-project-bootstrap/scripts/bootstrap.mjs --config governance.json --mode plan`.
3. Review the machine-readable report and obtain human approval.
4. Copy `authorization.value` from that exact plan report and apply only with explicit approval: `node .pi/skills/github-project-bootstrap/scripts/bootstrap.mjs --config governance.json --mode apply --authorize '<authorization.value>'`. The script recomputes it after discovery and fails closed if any reviewed input changed.
5. Archive the JSON report produced on stdout. Use stderr only for diagnostics.

## Output Contract

The script emits one JSON execution report with validation evidence, discovered state summary, planned actions, completed actions, skipped actions, and failures. A nonzero exit means no success claim; partial mutations, if any, remain reported.

## References

- [Configuration schema](assets/config.schema.json)
- [Minimal configuration](assets/example.config.json)
- [Bootstrap executor](scripts/bootstrap.mjs)
