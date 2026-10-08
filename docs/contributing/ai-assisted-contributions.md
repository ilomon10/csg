---
title: AI-assisted contributions
description: The project's policy for contributions written with AI coding tools, and what the contributor must check.
---

AI-assisted contributions are allowed. Use whatever tool helps you. The rules below apply to every contribution, whatever tool wrote it.

## You are responsible

- You are the contributor. You must understand every line you submit and be able to explain it in review.
- You must check that the code works and passes the checks in `AGENTS.md`.
- You must check the license of anything the tool adds, such as an asset, a font or a snippet of code.

## Follow AGENTS.md

`AGENTS.md` in the repository root is the canonical rule set for all contributors and tools. Claude Code also reads it through `CLAUDE.md`. Work in this order:

1. Find the spec IDs. Update the spec first if behavior changes (ADR-0006).
2. Write the tests with the AC IDs in their names.
3. Make the change.
4. Run the checks: lint, typecheck, test, spec check and build.

Do not let a tool skip these steps.

## Disclose it

Tick the AI-assistance box in the pull request checklist. You do not need to name the tool, but a reviewer must know the change was AI-assisted.

## Protect the project

- Do not commit secrets, private data or personal notes. Keep `CLAUDE.local.md` out of the repository.
- Do not change agent configuration (`AGENTS.md`, `CLAUDE.md`, `.claude/`) in an unrelated PR. Propose such changes in their own PR, and expect extra review.
- Do not bypass git hooks, the permission settings or the CI checks.
- Do not submit generated art or assets unless you have the rights to them and their license is recorded (see `ASSETS_LICENSE.md`).

## Review standard

AI-assisted code gets the same review as any other code. Reviewers check the spec IDs, the tests, the architecture rules and the license of new files. A change that cannot be explained by its author is not accepted.
