---
title: Spec process
description: How behavior is specified in specs/ with EARS requirements and stable REQ and AC IDs, and how to change it.
---

Specs in `specs/` are the source of truth for behavior. Code, tests and user docs follow them. ADR-0006 records why.

## Find the spec

Start with `specs/000-overview.md`. It has the feature map, the area-prefix registry and the glossary. Each feature has its own file, named `NNN-name.md`.

## IDs

- Requirement: `REQ-<AREA>-NNN`, for example `REQ-PIX-003`.
- Acceptance criterion: `AC-<AREA>-NNN.k`, for example `AC-PIX-003.2`.
- Areas are GEN, CMP, ANA, PIX, ANM, EXP, EDT, SGF, UPL, UX, WEB and AST. A new area needs an edit to the registry table in `specs/000-overview.md`.

IDs are permanent. Never renumber or reuse one. To retire a requirement, strike it through and say why:

```text
~~REQ-PIX-004~~ (deprecated 2026-11-02: superseded by REQ-PIX-012)
```

New requirements take the next free number at the end of the list. `pnpm spec:immutability` runs in pre-commit and CI and blocks any change that removes an ID, for every contributor. The `guard-spec-ids` hook does the same check during Claude Code edits. It is Claude-only, so do not rely on it alone.

## Write a requirement

Requirements use EARS. Each one describes one behavior and carries a priority tag:

```text
**REQ-XXX-001 [P1]** WHEN the user selects a resolution THE SYSTEM SHALL re-render the preview at that resolution within 200 ms.

- **AC-XXX-001.1** Given a character at 64 px, When the user selects 32 px, Then the preview updates to 32 px within 200 ms.
```

Priorities: `[P1]` is MVP, `[P2]` should, `[P3]` could. Every requirement needs at least one acceptance criterion, and thresholds need numbers so a test can assert them.

Start a new spec from `specs/_template.md`. Aim for 150 to 400 lines per spec. Split a spec above roughly 600 lines rather than bloat it.

## Open questions

Write `[NEEDS CLARIFICATION: question, and who can answer it]` instead of guessing. Work that depends on the question waits until it is answered.

## Change behavior

1. Update the spec first, in the same PR or an earlier one.
2. Add or change the REQ and AC IDs. Deprecate instead of deleting.
3. Write the code and tests. Each test name starts with the AC ID it checks.
4. Run `pnpm spec:check`.

Trivial fixes that change no behavior skip steps 1 and 2. Say so in the PR.

Specs must not contradict the constitution or an accepted ADR. If one does, raise it under Open questions.

## Constitution changes

The constitution changes only through its amendment process. Open a PR labelled `constitution` that edits only the constitution (and any affected specs or ADRs). It needs approval from two maintainers and stays open for at least 7 days.

## Tools

- `pnpm spec:check` validates IDs, prefixes and structure. It runs in pre-commit and CI.
- `pnpm spec:immutability` fails when a REQ or AC ID was removed compared with the base branch. It runs in pre-commit and CI.
- `pnpm spec:trace` writes `specs/traceability.md`, a matrix of ACs and the tests that cite them. Do not edit that file by hand.
