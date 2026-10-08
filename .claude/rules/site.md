---
paths:
  - 'apps/site/**'
  - 'docs/guide/**'
---

# apps/site and docs/guide rules

Specs: 010 (WEB, landing page, docs, performance and a11y bars). ADR-0007. Architecture 1.2, rule 5.

- The site renders Markdown from `docs/guide/`. Write guide content there, never inside `apps/site`. Sidebar order comes from `meta.json`.
- No runtime dependency on `@csg/*` in v1. A later live demo links to the editor at `/app/` (never framed: the editor's frame guard refuses iframes, ADR-0007 amendment), not engine code.
- Default exports are allowed only in `apps/site/app/**/{page,layout,not-found,error,loading,template}.tsx`, `apps/site/app/**/route.ts`, `apps/site/mdx-components.tsx` and `*.config.*` files (architecture 4.9). `sitemap.xml` and `robots.txt` come from the postbuild script, not Next metadata files. Keep those files thin. Every other export is named.
- Build as a static export (`output: 'export'`) for GitHub Pages. Use no server-only features.
- Never hotlink images. Use our own rendered sprites and screenshots in `apps/site/public/`, and list each image in the provenance manifest (spec 010).
- Pixel art renders with `image-rendering: pixelated` at an integer scale.
- Animated sprites show a static frame when `prefers-reduced-motion` is set.
- Use the `design-taste-frontend` skill (`.claude/skills/`). Meet WCAG 2.2 AA in light and dark themes.
- Lighthouse mobile bars (P-07): Performance at least 90, Accessibility at least 95.
- Each guide page has `title` and `description` front matter, the same as `docs/contributing/`.
- Every built page must map to a Markdown file in `docs/guide/` or `docs/contributing/`.
- Verify with `pnpm --filter @csg/site build`.
