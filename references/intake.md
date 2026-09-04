# Adaptive Intake

Build a manifest from facts, not defaults. Inspect the repository, remote, existing GitHub resources, and stack conventions first. Record each inference and its source. Ask only for values that cannot be established safely.

## Inferable Facts

Infer the repository target, owner/account candidate, remote binding, stack, existing labels, milestones, templates, and Projects v2 state when access permits. Treat discovery as evidence, not permission to manage or change anything.

## Required User Decisions

Use open-ended questions for the intended repository outcome, ownership when discovery is ambiguous, and the exact resources to manage. Confirm resource names, descriptions, colors, dates, template mode, project title, fields, options, and views only when the user elects that module. Accept arbitrary valid values; do not constrain answers to example names or project-specific terminology.

## Optional Modules

- **Git:** local repository binding and fixed template installation require a writable target repository.
- **GitHub:** labels and milestones are independent optional modules.
- **Projects v2:** a `project` manifest enables project discovery, linkage, fields, views, Project scopes, and GraphQL. Omit it to disable all Projects v2 work.
- **Templates:** configure the current fixed issue-form and pull-request templates, or omit `templates`. Arbitrary managed template files are a later module.

## Boundaries

Never invent project governance, milestones, workflows, labels, owners, field values, or views. Do not treat an existing resource as managed unless the manifest says so. Produce the manifest for review, then follow `plan → explicit SHA authorization → apply → verify`; a plan is not authorization.
