# 0006. Spec-driven development with EARS and stable IDs

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect
- Related: specs/constitution.md, specs/_template.md, AGENTS.md

## Context

The project is open source and much of the work is done by AI coding agents alongside human
contributors. Without a written source of truth, behavior drifts, tests check the wrong things, and
agents guess. We need requirements that are precise, traceable to tests, and readable by any tool.

## Decision

- **Specs** live in `specs/NNN-name.md` (spec-kit/Kiro hybrid) with front matter `id` (area
  prefix), `status: draft | accepted | implemented`, `owner`. Sections: Context, Goals, Non-goals,
  Requirements, Open questions, optional Design notes / Tasks. `specs/constitution.md` holds the
  invariant principles.
- **Requirements use EARS**: "WHEN <trigger> THE SYSTEM SHALL <response>", "WHILE <state> ...",
  "IF <condition> THEN ...", plus ubiquitous "THE SYSTEM SHALL ...".
- **Stable IDs**: `REQ-<AREA>-NNN`; acceptance criteria `AC-<AREA>-NNN.k` in Given/When/Then.
  Area prefixes: CMP, ANA, PIX, ANM, EXP, EDT, SGF, UPL, UX, WEB, AST. IDs are never renumbered or
  reused; deprecate instead.
- **Traceability**: tests cite AC IDs in their names (`it('AC-EDT-001.1: ...')`). Tools
  `spec:check` (format, IDs) and `spec:trace` (AC to test coverage) run in CI.
- Unknowns are written as `[NEEDS CLARIFICATION: ...]`, never guessed. A behavior-changing PR
  updates the spec first.
- **Agent rules**: `AGENTS.md` (tool-neutral, under 200 lines) is canonical. `CLAUDE.md` imports it
  (`@AGENTS.md`) and adds Claude-specific notes, because Claude Code reads `AGENTS.md` only when no
  `CLAUDE.md` exists. Path-scoped `.claude/rules/*.md` use a `paths:` glob. Hard rules are enforced
  by hooks in `.claude/settings.json`, not prose. `CLAUDE.local.md` is gitignored.

## Consequences

- Good: every behavior has an ID that links spec, code review and tests.
- Good: works with any AI tool (AGENTS.md) and with Claude Code specifically (CLAUDE.md).
- Good: EARS keeps requirements testable and short.
- Bad: writing specs first slows down small changes. Mitigation: trivial fixes that do not change
  behavior skip the spec step (stated in CONTRIBUTING).
- Bad: specs and ADRs can contradict each other. Mitigation: consistency review (T12) and the rule
  that specs govern behavior, ADRs govern rationale.

## Alternatives considered

- **Issues/PR descriptions only**: no stable source of truth; hard for agents to find.
- **Gherkin `.feature` files with Cucumber**: executable, but heavy tooling and poor fit for
  rendering requirements. We keep Given/When/Then wording without the runner.
- **Full spec-kit or Kiro layout (separate requirements/design/tasks files per feature)**: more
  files than this project needs; the hybrid keeps one file per feature.
- **CLAUDE.md as canonical**: excludes other tools; AGENTS.md is the emerging neutral convention.
