# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: multi-context

This repo is a 3-package npm workspace monorepo (`backend/`, `web/`, `shared/`), each with distinct concerns (Express API, React web app, shared calc/client library). Domain docs are split per package.

```
/
├── CONTEXT-MAP.md              ← points to each package's CONTEXT.md
├── docs/adr/                   ← system-wide decisions (cross-package)
├── backend/
│   ├── CONTEXT.md
│   └── docs/adr/               ← backend-specific decisions
├── web/
│   ├── CONTEXT.md
│   └── docs/adr/
└── shared/
    ├── CONTEXT.md
    └── docs/adr/
```

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: points at the `CONTEXT.md` for each package. Read the one(s) relevant to the topic (e.g. only `backend/CONTEXT.md` for an API-only change).
- **`docs/adr/`** at the repo root: system-wide decisions that span packages. Also check `<package>/docs/adr/` for package-scoped decisions relevant to the area you're about to work in.

If any of these files don't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant package's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR (root or package-scoped), surface it explicitly rather than silently overriding:

> _Contradicts `backend/docs/adr/0003-jwt-refresh-rotation.md`, but worth reopening because…_
