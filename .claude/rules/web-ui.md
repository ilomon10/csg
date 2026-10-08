---
paths:
  - 'apps/web/**'
---

# apps/web rules

Specs: 009 (UX, shell and shortcuts), 006 (EDT, graph editor UI), 001 (CMP), 002 (ANA), 004 (ANM), 005 (EXP), 008 (UPL UI). ADR-0004 for React Flow.

- Render only through `@csg/engine`. Import `three` with `import type` only. Do not create renderers, materials or scenes here. Gizmos and node previews are engine APIs.
- Feature folders are `src/features/{composer,anatomy,animation,look,export,shader-graph,upload}/`. They never import each other and export only through their `index.ts`. Shared code goes to `src/shared/`, which is a leaf. The shell and preview viewport live in `src/app/`, and only the shell imports from it.
- React Flow (`@xyflow/react`) is the view only. The graph model lives in `@csg/shader-graph`. Socket colors and implicit casts come from its registry.
- Keep state serializable. Zustand stores per feature hold `CharacterSpec` and graph JSON, never three.js objects.
- Never use `innerHTML` or `dangerouslySetInnerHTML`. Render user-supplied names as text.
- Every action has a keyboard path. Shortcuts come from one registry that also feeds the help overlay.
- Icon buttons have `aria-label`. Focus is always visible. Respect `prefers-reduced-motion`. Text contrast is at least 4.5:1.
- Show errors as messages with their code, never as raw stack traces (architecture 4.4).
- Keep the strict CSP (`connect-src 'self'`). Add no third-party scripts, analytics or trackers.
- Tests: Vitest with Testing Library for components. Playwright flows live in `apps/web/e2e/`. Names cite ACs, for example `AC-UX-010.2`.
- Put screenshots of changed UI in the PR.
- Verify with `pnpm --filter @csg/web build`, `pnpm exec vitest run apps/web` and `pnpm e2e`.
