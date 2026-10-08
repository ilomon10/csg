---
id: XXX                    # area prefix from specs/000-overview.md registry (e.g. PIX)
title: <Feature name>
status: draft              # draft | accepted | implemented | deprecated
owner: <github-handle or role>
depends_on: []             # e.g. [000-overview, 002-anatomy]
last_updated: YYYY-MM-DD
---

# NNN – <Feature name>

> Copy this file to `specs/NNN-kebab-name.md`. Delete the guidance blockquotes before you set `status: accepted`.
> Follow `specs/constitution.md`. Use the terms from the glossary in `specs/000-overview.md`.

## Rules for IDs (read first)

- Requirements are `REQ-<AREA>-NNN` (3 digits, sequential within the area). Acceptance criteria are `AC-<AREA>-NNN.k` (k = 1, 2, …).
- `<AREA>` must be a prefix in the registry in `000-overview.md`. One spec file owns each area. Cross-cutting items use `GEN`.
- **Never renumber, reuse or delete an ID.** To retire one, strike it through and keep it:
  `~~REQ-PIX-004~~ (deprecated 2026-11-02: superseded by REQ-PIX-012)`.
- New requirements go at the end of the list with the next free number, even if they belong earlier logically.
- Every REQ has ≥ 1 AC. Every REQ carries one priority tag: `[P1]` MVP / must, `[P2]` should, `[P3]` could.
- Quantify thresholds (px, ms, fps, MB, counts) so a test can assert them.

## Rules for test naming

- A test that verifies an AC starts its name with the AC ID:
  `it('AC-PIX-003.1: snaps model translation to the texel grid', …)`.
- One test can cite several ACs (`it('AC-EXP-001.1, AC-EXP-001.2: …')`). Each P1 AC needs ≥ 1 test (constitution P-09).
- E2E (Playwright) tests follow the same rule: `test('AC-UX-010.2: …')`.

## Context

> Why this feature exists, the problem it solves and what came before it. Link the ADRs and research that apply.

## Goals

- G1: …

## Non-goals

- NG1: … (state what is out of scope so reviewers can reject scope creep)

## User stories

> Ordered by priority. Use the personas from `000-overview.md`.

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | … | … |

## Requirements

### EARS cheat-sheet

| Pattern | Template |
|---------|----------|
| Ubiquitous | `THE SYSTEM SHALL <response>.` |
| Event-driven | `WHEN <trigger> THE SYSTEM SHALL <response>.` |
| State-driven | `WHILE <state> THE SYSTEM SHALL <response>.` |
| Unwanted behaviour | `IF <unwanted condition> THEN THE SYSTEM SHALL <response>.` |
| Optional feature | `WHERE <feature is enabled/included> THE SYSTEM SHALL <response>.` |
| Complex | `WHILE <state>, WHEN <trigger> THE SYSTEM SHALL <response>.` |

Write one behavior per requirement. Keep the requirement testable and free of implementation detail, unless that detail is a contract other packages depend on.

### Example (delete when writing a real spec)

**REQ-XXX-001 [P1]** WHEN the user changes the output resolution THE SYSTEM SHALL re-render the preview at the new resolution within 200 ms.

- **AC-XXX-001.1** Given a character previewed at 64 px, When the user selects 32 px, Then the preview canvas backing store is 32×32 px per frame and updates within 200 ms.
- **AC-XXX-001.2** Given resolution 48 px, When the user enters 130 px, Then the value is rejected with the message "Resolution must be 32–128 px" and the preview stays at 48 px.

**REQ-XXX-002 [P2]** IF the GPU device is lost THEN THE SYSTEM SHALL recreate the renderer and restore the current preview without losing the `CharacterSpec`.

- **AC-XXX-002.1** Given an edited character, When a device-lost event is simulated, Then within 2 s the preview renders again and the serialized `CharacterSpec` is unchanged.

### Requirements

**REQ-XXX-001 [P1]** …

- **AC-XXX-001.1** Given …, When …, Then …

## Edge cases

> List each case with the REQ/AC that covers it. A case with no coverage is a gap. Add a REQ or an open question.

- Empty/missing input → REQ-XXX-…
- Maximum sizes and counts → …
- Concurrent edits, undo across this feature → …
- Renderer fallback (WebGL2) → …

## Data & contracts

> TypeScript interfaces, JSON examples or schema references that other packages depend on. Version every persisted format.

```ts
/** TSDoc on every exported member. */
export interface Example {
  readonly version: 1;
}
```

## Non-functional

> Performance, accessibility, security, privacy and determinism, with quantified thresholds. Reference constitution principles (P-04, P-07 …) instead of restating them.

- NFR-1: …

## Open questions

- [NEEDS CLARIFICATION: …] (who can answer it, and what is blocked until then)

## References

- ADR-000X: …
- External sources (URL + access date)
