# GitHub Repository Bootstrap

A reusable Pi package that plans and applies safe, repeatable GitHub repository bootstrap changes.

## Use as a Pi package

Install a reviewed immutable ref at project scope:

```bash
pi install -l git:github.com/egdev6/github-repository-bootstrap@<tag-or-commit>
```

The package exposes `github-repository-bootstrap` through the conventional `skills/` directory and its `pi.skills` manifest entry.

## Verify

```bash
npm test
```

The skill instructions and bootstrap implementation live in `skills/github-repository-bootstrap/`.
