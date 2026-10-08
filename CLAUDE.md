@AGENTS.md

# Claude Code notes

Everything in `AGENTS.md` applies. This file adds Claude Code specifics and never overrides it. Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists, so this import keeps both files in use.

## Project subagents (`.claude/agents/`)

- `spec-writer` (opus): writes `specs/**` only. Use before any feature work. It has no shell, so the main session must run `pnpm spec:check`.
- `graphics-engineer` (opus): `packages/engine` rendering, TSL materials, the pixel pipeline, camera snapping, skinning and anatomy math, shader-graph emitters. Use for shader and performance tasks.
- `asset-pipeline-engineer` (sonnet): `tools/**`, `packages/parts-schema`, engine asset loading, manifests, upload validation, retargeting, licensing data.
- `editor-ux-engineer` (sonnet): `apps/web` features, the React Flow graph editor view, shortcuts, undo UI, accessibility.
- `web-designer` (sonnet): `apps/site` landing page and docs site. Uses the `design-taste-frontend` skill.
- Generic office roles (analyst, architect, developer, qa-engineer, code-reviewer, security-engineer, tech-writer) are assigned by the office workflow. They have no files under `.claude/agents/`.

Pick the agent by the area a change touches. A change that crosses areas goes to the owner of the spec area it changes.

## Office workflow

- `/office-kickoff` starts a multi-agent wave. The lead splits the work, gives each agent its spec IDs, and collects the results. The command is defined by the office tooling, not in this repo.
- Every agent ends its final message with a handoff block, which the office parses:

```handoff
status: done | blocked | failed
summary: <one line, cite REQ IDs>
files: <comma-separated paths, or none>
tests: <what ran and the result, or none>
next: <role to pick this up, or none>
blockers: <what is needed, or none>
```

- Scratch and inputs live in `.tagconn/work/` (for example `research.md`). Treat them as background. Accepted specs and ADRs are the record.

## Skill

- `design-taste-frontend` (`.claude/skills/design-taste-frontend/`) is design guidance for `apps/site`. It is vendored from taste-skill under the MIT license (see `VENDORED.md` and `LICENSE` in that folder).
- Project override from `VENDORED.md`: never hotlink external images.

## Hooks (`.claude/settings.json`)

- PreToolUse on Edit and Write runs `tools/hooks/guard-spec-ids.mjs`. It blocks an edit under `specs/` that removes an existing REQ or AC ID (exit code 2). Strikethrough deprecation is allowed. Internal errors fail open. This hook is Claude Code only. Husky (`pre-commit`) and CI run `pnpm spec:immutability` for every contributor.
- PostToolUse on Edit and Write runs `tools/hooks/format-file.mjs`, which runs `prettier --write` on ts, tsx, js, mjs, cjs, json and md files. It never blocks.
- Hard rules belong in hooks. Prose in `AGENTS.md` is guidance; do not rely on it for a rule a hook can enforce.

## Path-scoped rules

- `.claude/rules/*.md` load when you touch matching files: engine, shader-graph, parts-schema, web-ui, site, specs, tests and tools.
- Per-package `CLAUDE.md` files load when you work in that directory.

## Personal notes

- `CLAUDE.local.md` holds personal preferences. It is gitignored. Never commit it, and keep team rules in `AGENTS.md`.
