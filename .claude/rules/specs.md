---
paths:
  - 'specs/**'
---

# specs/ rules

Governing docs: `specs/constitution.md` (wins over any spec), `specs/_template.md`, `specs/000-overview.md` (registry and glossary). ADR-0006.

- Start from `specs/_template.md`. Front matter: `id`, `title`, `status` (draft, accepted, implemented or deprecated), `owner`, `depends_on`, `last_updated`.
- Requirements use EARS: `WHEN ... THE SYSTEM SHALL ...`, `WHILE ...`, `IF ... THEN ...`, `WHERE ...`, or the ubiquitous `THE SYSTEM SHALL ...`. One behavior per requirement.
- Every REQ has a priority tag (`[P1]`, `[P2]` or `[P3]`) and at least one AC in Given/When/Then form.
- Quantify thresholds (px, ms, fps, MB, counts) so a test can assert them.
- Never renumber, reuse or delete an ID. Deprecate with strikethrough and a reason. The `guard-spec-ids` hook blocks removals during Claude Code edits. Husky and CI enforce the same rule for everyone.
- Edit specs with normal file edits. `pnpm spec:immutability` in CI and pre-commit rejects removed IDs regardless of tool. The `guard-spec-ids` hook is an extra Claude Code check.
- Unknowns are written `[NEEDS CLARIFICATION: ...]` with the person who can answer. Never guess.
- Do not contradict the constitution or an accepted ADR. If you must, raise it under Open questions.
- Aim for 150 to 400 lines per spec. Split a spec above roughly 600 lines rather than bloat it.
- Do not hand-edit `specs/traceability.md`. `pnpm spec:trace` generates it.
- Run `pnpm spec:check` before you finish.
