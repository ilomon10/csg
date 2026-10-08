# 0007. Next.js + Fumadocs website with Markdown in docs/guide

- Status: Accepted (amended 2026-10-08)
- Date: 2026-10-08
- Deciders: project owner, architect, web designer
- Related: spec 010 (website); ADR-0002; architecture §4.10

## Context

The project needs a landing page that sells the idea (sample sprites, features, call to action) and
a user guide. Documentation must stay close to the code so PRs update both together, and it must be
plain Markdown so contributors and AI agents can edit it without learning a site framework.

## Decision

- `apps/site` is a **Next.js App Router** app hosting the landing page and **Fumadocs** for the
  user guide.
- **Markdown is the source of truth.** The guide lives in `docs/guide/**` at the repo root (with
  `meta.json` for ordering). The site reads it via Fumadocs MDX
  `defineDocs({ dir: '../../docs/guide' })` in `apps/site/source.config.ts`. No guide content lives
  inside `apps/site`.
- Output is a **static export** (no server runtime needed), deployable to any static host.
- The landing page is designed with the project skill `design-taste-frontend`
  (`.claude/skills/`). Visual assets (sprite GIFs, screenshots) are static files produced from
  editor exports.
- `apps/site` has no runtime dependency on `@csg/*` packages in v1 (architecture rule 5). A live
  demo links to or embeds the built editor.
- Next.js-required default exports are the only allowed exception to the named-exports rule
  (ADR-0002).

## Amended 2026-10-08: hosting origin

Security review T13 (H1). "Any static host" is narrowed for the editor: because the editor keeps
user uploads in origin-scoped storage (IndexedDB, OPFS, localStorage), `/app/` must be served from a
**dedicated origin** (custom domain or subdomain, or a dedicated organization GitHub Pages site).
A shared `https://<owner>.github.io/` origin is not acceptable for persistent uploads. A framed
editor does not open persisted data (frame guard), so the live demo links to the editor rather than
embedding it. The site may share the editor's origin and then runs no third-party scripts. The
domain itself is pending the owner's decision. Details: architecture §4.10, spec 000 GEN origin and
CSP rules. The rest of this decision is unchanged.

## Consequences

- Good: docs render on GitHub as-is and on the site with search, navigation and dark mode.
- Good: the site build does not depend on WebGPU or the engine, so it stays fast and stable.
- Good: static hosting is free and simple.
- Bad: two frontend stacks (Vite for the editor, Next.js for the site). Accepted because each is
  the best fit for its job and they share only Markdown and design tokens.
- Bad: Fumadocs and Next.js major upgrades can break the docs build. Mitigation: pinned versions,
  `next build` + link check in CI.
- Risk: MDX features creeping into `.md` guide files. Mitigation: guide pages stay plain Markdown;
  rich components are allowed only on landing pages (spec 010).

## Alternatives considered

- **Docusaurus**: mature, but React + its own build; less flexible for a custom landing page.
- **VitePress / Starlight (Astro)**: excellent docs tools, but a separate ecosystem from the React
  editor, and the user chose Next.js.
- **Landing page inside the Vite editor app**: couples marketing to the app bundle and hurts
  performance.
- **Docs inside `apps/site/content`**: hides docs from contributors browsing the repo root.

## Amended 2026-10-08: hosting on Vercel

The owner will deploy the site and editor to **Vercel** manually. A Vercel project gets its own subdomain (and later a custom domain), which satisfies the dedicated-origin requirement (REQ-GEN-009) and allows real response headers (CSP, `frame-ancestors`) in addition to the `<meta>` CSP. The static export (`output: 'export'`) stays, so the build also works on any static host. Specs and docs that mention GitHub Pages remain valid for the build output; the deploy target is updated in a follow-up.
