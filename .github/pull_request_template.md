## Summary

<!-- What changes, and why. One or two sentences. -->

## Spec IDs

- Implements or touches: <!-- for example REQ-PIX-003, AC-PIX-003.1 -->
- [ ] No behavior changes. Explain below.

## Spec

- [ ] The spec was updated first, in this PR or an earlier one (or no behavior changes)
- [ ] `pnpm spec:check` passes

## Tests

- [ ] Every test that checks spec behavior is named with its AC ID
- [ ] Every P1 AC touched has a passing test
- [ ] `pnpm test` passes
- [ ] Golden images were regenerated per backend, with the reason (rendering changes only)
- [ ] Golden images changed: the reason is recorded in the PR and they were regenerated in the canonical container (`pnpm goldens:docker` or the `Update goldens` workflow), not locally

## Assets

Only if this PR adds or changes assets (spec 011, REQ-AST-023); otherwise delete this section.

- [ ] License is CC0 or CC-BY and is recorded in the pack's `pack.config.json`
- [ ] `pnpm assets:check` passes
- [ ] No source packs (`assets-src/`) are committed

## Screenshots or recordings

<!-- UI changes: before and after. Rendering changes: golden diffs. -->

## Checklist

- [ ] `pnpm lint` and `pnpm typecheck` pass
- [ ] `pnpm build` passes. `pnpm e2e` passes if the UI changed.
- [ ] Commit messages follow Conventional Commits
- [ ] `pnpm changeset` was run for changes to `@csg/*` packages
- [ ] Docs were updated if behavior or structure changed (`docs/guide/`, `docs/contributing/`, `docs/architecture.md`)
- [ ] New exports have TSDoc. No default exports outside the listed exceptions.
- [ ] No network requests for user files. No hotlinked images.
- [ ] New assets have a license, author and source URL in the manifest and a row in `ASSETS_LICENSE.md`
- [ ] UI changes: keyboard path, focus and contrast checked (WCAG 2.2 AA)
- [ ] AI assistance was used. I reviewed and understand every line (see CONTRIBUTING.md).
