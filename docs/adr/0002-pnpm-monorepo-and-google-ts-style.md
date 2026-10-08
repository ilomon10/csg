# 0002. pnpm monorepo and Google TypeScript Style (gts)

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect
- Related: docs/architecture.md sections 1 and 4.9

## Context

The codebase has a framework-agnostic rendering engine, a pure graph model and compiler, a schema
package, a React editor, a Next.js website and Node tools. They share types and must evolve together.
The project is open source, so contributors (human and AI) need one consistent style that tooling
enforces rather than reviewers.

## Decision

Use a **pnpm workspace monorepo**:

- `packages/engine`, `packages/shader-graph`, `packages/parts-schema` (scope `@csg/*`)
- `apps/web` (Vite + React), `apps/site` (Next.js + Fumadocs), `tools/`
- Dependency directions as in `docs/architecture.md` 1.2; enforced by lint import restrictions.

Use the **Google TypeScript Style Guide enforced by `gts`** (ESLint flat config + Prettier):

- Named exports only, kebab-case filenames, strict TS, TSDoc on public package APIs, no `any`.
- Exception: default exports where a framework requires them (Next.js `page`/`layout`/`route` etc.
  under `apps/site/app/**`, `mdx-components.tsx`, and `*.config.*` files), scoped by an ESLint
  override, never globally.

## Consequences

- Good: atomic cross-package changes; one lockfile; shared tsconfig and lint config.
- Good: pnpm's strict `node_modules` catches undeclared dependencies.
- Good: style debates are settled by a tool; CI fails on violations.
- Bad: gts defaults sometimes lag ESLint/TS releases; we may need local rule overrides, each
  documented in `eslint.config.js`.
- Bad: contributors new to pnpm need a short setup note (CONTRIBUTING).

## Alternatives considered

- **Polyrepo**: independent releases, but cross-cutting changes (schema + engine + UI) need
  coordinated PRs. Too much overhead for a small team.
- **npm/yarn workspaces**: workable, but slower installs and hoisting hides missing dependencies.
- **Nx / Turborepo as the primary tool**: useful for caching later; not needed to start. Turborepo
  may be added on top of pnpm without changing this decision.
- **Airbnb or StandardJS style**: the user chose Google style; gts gives a maintained, zero-config
  setup.
