---
id: WEB
title: Website (landing page + documentation site)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 005-export, 009-editor-shell-ux]
last_updated: 2026-10-08
---

# 010 – Website

## Context

The project needs a public site that does two jobs:

1. **Sell the product with the product itself.** People should see the sprites it makes before they read anything.
2. **Host the user guide and contributor docs** from plain Markdown in the repo.

ADR-0007 fixes the stack: `apps/site` is a Next.js App Router app with Fumadocs, Tailwind, and a static export. The guide lives in `docs/guide/**` and is read with `defineDocs({ dir: '../../docs/guide' })`. Architecture rule 5 says `apps/site` has **no runtime dependency on `@csg/*` packages in v1**. So every sprite on the landing page is a **pre-rendered static file** produced by the real export pipeline (spec 005), not drawn live by the engine. The editor (`apps/web`, Vite) is served beside the site at `/app/`.

The design bar comes from the project skill `.claude/skills/design-taste-frontend` (sections 0, 1, 9, 14). Hosting is GitHub Pages, which means:

- no server
- no rewrites, redirects or headers
- a project-path `basePath` (`/<repo>`) unless a custom domain is used

## Goals

- G1: A landing page where the hero *is* a sprite the generator made, which makes the 3D → pixel idea clear within 5 s.
- G2: Docs are rendered only from Markdown in the repo, readable on GitHub as-is and on the site with search, navigation and dark mode.
- G3: One static artifact (site + editor) deploys to GitHub Pages under any `basePath`.
- G4: Meet constitution P-06 (WCAG 2.2 AA) and P-07 (Lighthouse) with no tracking (P-03 spirit).

## Non-goals

- NG1: Writing guide content. That is owned by `docs/guide/**` (tech-writer). This spec defines the *structure* and the build rules.
- NG2: Running `@csg/engine` or WebGPU inside `apps/site` in v1 (architecture rule 5).
- NG3: Accounts, comments, newsletter sign-up, a CMS, server-side search or analytics in v1.
- NG4: A blog or changelog site (the changelog stays `CHANGELOG.md` on GitHub for now).
- NG5: Testimonials, user counts, star counters, "trusted by" logo walls, or any metric we cannot prove.

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to see real animated sprites in 8 directions as soon as the page opens | I can judge the output quality in seconds |
| US-2 | P1 | indie game dev | one obvious button to open the editor | I can try it with no sign-up |
| US-3 | P1 | any user | a searchable guide with a stable sidebar | I can find how to export for my engine |
| US-4 | P1 | modder / contributor | the docs to be Markdown files next to the code, with "Edit on GitHub" | I can fix a page in one PR |
| US-5 | P2 | pixel artist | to swap a few parts and palettes on the landing page | I can feel the mix-and-match idea before opening the editor |
| US-6 | P2 | tech artist | a node reference and recipes for the shader graph | I can change the look without reading the source |
| US-7 | P3 | non-English user | the guide in my language | I can learn the tool more easily |

## Information architecture

Routes are relative to `basePath`. `slug` is the file path under its source folder without `.md`, and `index.md` maps to the folder route.

| Route | Source | Notes |
|-------|--------|-------|
| `/` | `apps/site/app/page.tsx` | Landing page (REQ-WEB-019…034) |
| `/app/` | `apps/web` build output | Editor. It is not rendered by Next.js (REQ-WEB-004) |
| `/docs/` and `/docs/<slug>/` | `docs/guide/**/*.md` | User guide |
| `/docs/contribute/` and `/docs/contribute/<slug>/` | `docs/contributing/**/*.md` | Contributor guide |
| `/docs/contribute/architecture/` | `docs/architecture.md` | |
| `/docs/contribute/adr/` and `/docs/contribute/adr/<file>/` | `docs/adr/README.md`, `docs/adr/NNNN-*.md` | `docs/adr/template.md` is excluded |
| `/gallery/` | `apps/site/content/gallery.json` + `public/sprites/**` | P2 (REQ-WEB-030) |
| `/404.html`, `/sitemap.xml`, `/robots.txt`, `/api/search` (static index) | generated | |

The sidebar has two root tabs, **Guide** and **Contribute**. The required pages are listed below. A page marked (P2) or (P3) may be missing until its feature ships. Ordering comes from `meta.json`.

**Guide (`docs/guide/`)**

- `index.md`: What it is, who it is for, and what it is not
- `getting-started/`: `index` (quick start: first sprite sheet in 5 minutes), `system-requirements` (browsers, WebGPU / WebGL2, storage), `interface-tour`, `keyboard-shortcuts`
- `composer/`: `index`, `parts-and-slots`, `colors-and-tints`, `randomize-and-presets`, `save-load-share`
- `anatomy/`: `index` (proportion sliders), `chibi-and-readability`
- `render-settings/`: `index`, `camera-styles` (side, top-down 3/4, isometric), `directions`, `resolution`, `toon-and-outlines`, `palettes-and-dither`
- `animation/`: `index`, `clips`, `frames-and-timing`
- `export/`: `index`, `sheet-layouts`, `metadata-json`, `credits-and-licensing`, `using-in-game-engines`
- `shader-graph/`: `index` (overview), `editor-basics`, `blackboard`, `nodes/` (node reference: `index` + one page per node category) (P2), `recipes/` (`index` + ≥ 3 recipes, for example thicker outlines, cel bands, custom palette) (P2)
- `custom-models/`: `index`, `preparing-models` (Blender tips), `upload`, `bone-mapping`, `props-and-sockets`, `budgets-and-limits`, `licensing`
- `faq.md`, `troubleshooting.md`

**Contribute (`docs/contributing/` + `docs/architecture.md` + `docs/adr/`)**

- `docs/contributing/`: `index` (how to contribute), `development-setup`, `adding-parts`, `writing-a-node`, `spec-process`, `writing-docs`, `code-style`
- `architecture` (from `docs/architecture.md`)
- `adr/` (from `docs/adr/`, ordered by ADR number)

## Requirements

Script names (consistency review 2026-10-08): `pnpm docs:nodes`, `docs:shortcuts` and `site:sprites` are root package scripts (repository root `package.json`) and are the canonical names; a script whose milestone has not landed prints "not implemented (Mx)" and exits non-zero. Site-local steps run through `pnpm --filter @csg/site <script>`.

### Build, sources and deployment

**REQ-WEB-001 [P1]** THE SYSTEM SHALL build `apps/site` as a fully static export (`output: 'export'`). The output must need no server runtime, rewrites, redirects or custom headers.

- **AC-WEB-001.1** Given a clean checkout, When `pnpm --filter @csg/site build` runs, Then it exits 0 and `apps/site/out/` contains `index.html`, `404.html`, `docs/index.html`, `sitemap.xml` and `robots.txt`.
- **AC-WEB-001.2** Given the export, When it is served by a plain static file server with no rewrite rules, Then every route in the IA table returns 200. Directory-style URLs with a trailing slash resolve (`trailingSlash: true`).

**REQ-WEB-002 [P1]** THE SYSTEM SHALL prefix every internal URL with a configurable `basePath` taken from `SITE_BASE_PATH`, which defaults to empty. This covers links, scripts, styles, images, fonts, the search index, OG images, the sitemap and canonical URLs.

- **AC-WEB-002.1** Given `SITE_BASE_PATH=/csg-test`, When the export is served under `/csg-test/` and crawled from `/csg-test/`, Then no request targets a same-origin path outside `/csg-test/`, and there are 0 broken links or 404 assets.
- **AC-WEB-002.2** Given `SITE_BASE_PATH` is empty (custom domain), When the same crawl runs from `/`, Then there are 0 broken links.

**REQ-WEB-003 [P1]** WHEN the deploy workflow runs on the default branch THE SYSTEM SHALL publish one artifact to GitHub Pages. The artifact contains the site export, the editor build at `/app/`, and a `.nojekyll` file at the root.

- **AC-WEB-003.1** Given a push to the default branch, When `.github/workflows/deploy-site.yml` completes, Then the Pages artifact contains `index.html`, `.nojekyll`, `app/index.html` and `_next/`.
- **AC-WEB-003.2** Given a pull request, When CI runs, Then the site builds (including link checks) but nothing is deployed.

**REQ-WEB-004 [P1]** THE SYSTEM SHALL serve the editor at `<basePath>/app/`. The `apps/web` build uses Vite `base` = `<basePath>/app/`, so every editor asset loads from under that path.

- **AC-WEB-004.1** Given the merged artifact served under `/csg-test/`, When a browser opens `/csg-test/app/`, Then the editor loads, and every same-origin request it makes starts with `/csg-test/app/`.
- **AC-WEB-004.2** Given `pnpm --filter @csg/site build` runs without an editor build, Then it still succeeds. The link checker treats `/app/` as a known external-to-Next route, not a broken link.

**REQ-WEB-005 [P1]** THE SYSTEM SHALL render documentation pages only from Markdown (`.md`) files in the allowed sources:

- `docs/guide/**`
- `docs/contributing/**`
- `docs/architecture.md`
- `docs/adr/*.md` (excluding `template.md`)

No guide or contributor content may live inside `apps/site`.

- **AC-WEB-005.1** Given the build's page list, When it is compared with the source files, Then every `/docs/**` route maps to exactly one `.md` file in the allowed sources, and every such file maps to one route.
- **AC-WEB-005.2** Given a page component or `.md`/`.mdx` content file is added under `apps/site` for a `/docs/**` route, When the build runs, Then it fails and names the offending file.
- **AC-WEB-005.3** Given an `.mdx` file under `docs/guide/`, When the build runs, Then it fails with "Guide pages must be plain Markdown (.md)".

**REQ-WEB-006 [P1]** IF a guide Markdown file contains MDX-only syntax THEN THE SYSTEM SHALL fail the build. MDX-only syntax means `import`/`export` statements, JSX elements, or `{expression}` blocks outside code. This keeps pages rendering correctly on GitHub (ADR-0007 risk).

- **AC-WEB-006.1** Given `docs/guide/faq.md` contains `<Callout>Hi</Callout>`, When the build runs, Then it fails and reports the file and line.
- **AC-WEB-006.2** Given a page uses GitHub alert syntax (`> [!NOTE]`), When it is rendered, Then the site shows a styled callout with the matching type (note, tip, important, warning, caution).

**REQ-WEB-007 [P1]** THE SYSTEM SHALL validate front matter on every guide and contributing page:

- `title`: required, 1–70 chars
- `description`: required, 50–160 chars

Pages from `docs/architecture.md` and `docs/adr/*.md` may omit front matter. Their title then comes from the first `# H1` and their description from the first paragraph, truncated to 160 chars.

- **AC-WEB-007.1** Given a guide page without `description`, When the build runs, Then it fails and names the file and field.
- **AC-WEB-007.2** Given `docs/adr/0003-webgpu-renderer-and-tsl.md` without front matter, When it is rendered, Then the page title is "0003. WebGPU renderer and TSL" (its H1), and `<meta name="description">` is non-empty.

**REQ-WEB-008 [P1]** IF any internal link or anchor in the built site, or any relative link in a source `.md` file, does not resolve THEN THE SYSTEM SHALL fail the build.

- **AC-WEB-008.1** Given `docs/guide/export/index.md` links to `./missing.md`, When the build runs, Then it fails and reports the source file, line and target.
- **AC-WEB-008.2** Given a link to `../anatomy/index.md#child-compensation` where that heading does not exist, Then the build fails.
- **AC-WEB-008.3** Given the built export, When the HTML link checker crawls it, Then 0 internal `href`/`src` values (including `#fragment`s) are broken.

**REQ-WEB-009 [P1]** THE SYSTEM SHALL turn relative `.md` links into site routes. Links that point to repo files outside the published sources (for example `specs/003-*.md` or `packages/**`) become GitHub `blob` URLs on the default branch. The same Markdown therefore works both on GitHub and on the site.

- **AC-WEB-009.1** Given `[export](../export/index.md)` in a guide page, Then the rendered `href` is `<basePath>/docs/export/`.
- **AC-WEB-009.2** Given `[spec](../../../specs/005-export.md)`, Then the rendered `href` is `<REPO_URL>/blob/<REPO_BRANCH>/specs/005-export.md`.

**REQ-WEB-010 [P1]** THE SYSTEM SHALL order the sidebar from `meta.json` files next to the Markdown files. Every folder under `docs/guide/` and `docs/contributing/` has a `meta.json` with `title` and `pages`.

- **AC-WEB-010.1** Given `docs/guide/meta.json` lists `["index", "getting-started", "composer", …]`, Then the sidebar shows the sections in that order.
- **AC-WEB-010.2** Given a folder with no `meta.json`, or a page not reachable from any `meta.json` (no `"..."` rest entry covers it), When the build runs, Then it fails and names the folder or page.

**REQ-WEB-011 [P1]** THE SYSTEM SHALL contain every P1 page listed in the Information architecture section. A test checks the list against the built route list.

- **AC-WEB-011.1** Given the IA list in `apps/site/test/ia.ts` (mirrors this spec), When the site test suite runs, Then every P1 route exists in the export.

**REQ-WEB-012 [P1]** THE SYSTEM SHALL provide full-text search over all docs pages without any server or third-party service. It uses Fumadocs Orama static search, with the index exported at build time.

- **AC-WEB-012.1** Given the export, When the user presses `Ctrl/⌘+K` and types "bone map", Then within 300 ms of the index loading, the results include `/docs/custom-models/bone-mapping/`.
- **AC-WEB-012.2** Given search is opened, When network requests are recorded, Then all of them go to the site's own origin. The index is ≤ 400 KB gzipped for the P1 page set.

**REQ-WEB-013 [P1]** THE SYSTEM SHALL show an "Edit on GitHub" link on every docs page. The link points to `<REPO_URL>/edit/<REPO_BRANCH>/<repo-relative source path>`.

- **AC-WEB-013.1** Given `/docs/anatomy/`, Then the link is `<REPO_URL>/edit/main/docs/guide/anatomy/index.md`.

**REQ-WEB-014 [P2]** THE SYSTEM SHALL show a "Last updated" date on every docs page. The date is the last git commit date of its source file, taken at build time and formatted as ISO `YYYY-MM-DD`.

- **AC-WEB-014.1** Given a file last committed on 2026-10-08, Then its page shows "Last updated 2026-10-08".
- **AC-WEB-014.2** Given a shallow clone where git history is unavailable, When the build runs, Then the date is omitted. The build does not fail, and it logs a single warning. (The deploy workflow uses `fetch-depth: 0`.)

**REQ-WEB-015 [P2]** THE SYSTEM SHALL generate the shader-graph node reference pages (`docs/guide/shader-graph/nodes/*.md`) as committed Markdown, using a tool that reads the node registry (spec 007). CI fails if the committed files are stale.

- **AC-WEB-015.1** Given a node type is added to the registry, When `pnpm docs:nodes --check` runs without regenerating, Then it exits non-zero and names the stale file.
- **AC-WEB-015.2** Given the generated pages, Then each node has its `type@ver`, a description, and a table of input/output sockets (id, type, default).

**REQ-WEB-016 [P2]** THE SYSTEM SHALL render images referenced from Markdown with relative paths, so they show on GitHub too. Images whose filename ends in `.pixel.png` render with `image-rendering: pixelated` at an integer scale.

- **AC-WEB-016.1** Given `![Side camera](./images/side.pixel.png)` (64×64 px), Then the rendered `<img>` has `width`/`height` attributes set, a CSS size that is an integer multiple of 64, and computed `image-rendering: pixelated`.

**REQ-WEB-017 [P3]** WHERE docs versioning is enabled THE SYSTEM SHALL publish the guide of each released major version under `/docs/v<major>/`. `/docs/` always shows the latest version, and a version switcher is shown.

- **AC-WEB-017.1** Given releases v1 and v2, Then `/docs/v1/export/` serves the v1 text, `/docs/export/` serves the v2 text, and the switcher lists both.

**REQ-WEB-018 [P3]** WHERE a guide translation exists THE SYSTEM SHALL serve it under `/<lang>/docs/…`. Translations use Fumadocs dot-suffix files (`index.de.md` next to `index.md`). Untranslated pages fall back to English with a visible notice. Landing strings come from message catalogs (REQ-GEN-006).

- **AC-WEB-018.1** Given `docs/guide/faq.de.md` exists and `export/index.de.md` does not, Then `/de/docs/faq/` shows German, and `/de/docs/export/` shows English with the notice "Diese Seite ist noch nicht übersetzt".

### Landing page

> Design read (to be confirmed by web-designer): *developer-tool landing for indie game devs and pixel artists, with a crafted, playful-but-precise pixel language, leaning toward Tailwind + Fumadocs UI tokens, one accent color, real sprite art as the only imagery.* Proposed dials: VARIANCE 7, MOTION 6, DENSITY 4.

**REQ-WEB-019 [P1]** THE SYSTEM SHALL show a hero with:

- (a) a headline of ≤ 2 lines and a subtext of ≤ 20 words
- (b) a primary CTA "Open the editor" linking to `<basePath>/app/`
- (c) a secondary CTA "Read the docs" linking to `<basePath>/docs/`
- (d) an animated pixel character from our own exported sprite sheets

All of these are visible without scrolling at 1440×900 and 390×844.

- **AC-WEB-019.1** Given viewports 1440×900 and 390×844, When `/` loads, Then the headline, both CTAs and the sprite are fully inside the first viewport, and neither CTA label wraps.
- **AC-WEB-019.2** Given the hero, Then it has at most 4 text elements and no version label, eyebrow numbering, scroll cue or decorative text strip (taste skill §9.F).

**REQ-WEB-020 [P1]** THE SYSTEM SHALL animate the hero character as an 8-direction turnaround. It plays one looping clip (e.g. idle or walk) for ≥ 1 cycle per direction, then rotates to the next direction (S, SW, W, NW, N, NE, E, SE). It is rendered at an integer scale with `image-rendering: pixelated`.

- **AC-WEB-020.1** Given the hero over 20 s, Then all 8 directions are shown in order, and each shown frame is pixel-identical to a cell of the sheet in `public/sprites/` (no resampling: displayed size = sheet cell size × integer k, k ∈ {2,3,4,5,6}).
- **AC-WEB-020.2** Given the user presses ←/→ while the hero sprite is focused, Then the direction steps once in that direction, and auto-rotation pauses.

**REQ-WEB-021 [P1]** THE SYSTEM SHALL provide a visible, keyboard-operable pause/play control for every animation that lasts longer than 5 s (WCAG 2.2.2). The paused state persists for the session.

- **AC-WEB-021.1** Given the hero is animating, When the user activates "Pause animation" with the keyboard, Then all landing animations stop within 1 frame and stay stopped after scrolling.

**REQ-WEB-022 [P1]** WHILE `prefers-reduced-motion: reduce` is set THE SYSTEM SHALL show static sprites instead of animations: the hero shows the 8 directions as a static row or grid of single frames. No scroll-triggered motion runs.

- **AC-WEB-022.1** Given reduced motion is emulated, When `/` loads and the page is scrolled to the bottom, Then no element's transform, opacity or background-position changes over 3 s (except focus and hover styles), and the hero shows 8 distinct direction frames.

**REQ-WEB-023 [P1]** THE SYSTEM SHALL render all landing content, including the hero, without WebGL or WebGPU. Sprites are static PNG/WebP sheets animated by CSS `steps()` or a 2D canvas.

- **AC-WEB-023.1** Given a browser with WebGL and WebGPU disabled, When `/` loads, Then every section renders with no console errors, and the hero animates.

**REQ-WEB-024 [P2]** IF the visitor's browser supports neither WebGPU nor WebGL2 THEN THE SYSTEM SHALL show a short notice next to "Open the editor": "The editor needs WebGPU or WebGL2. See system requirements." The notice links to `/docs/getting-started/system-requirements/`. The CTA stays usable.

- **AC-WEB-024.1** Given `getContext('webgl2')` returns null and `navigator.gpu` is undefined, Then the notice is shown. With either available, it is not shown and the layout does not shift (CLS contribution 0).

**REQ-WEB-025 [P1]** THE SYSTEM SHALL include a "How it works" section that shows the pipeline in 4 steps: 3D parts → anatomy → pixel shader → sprite sheet. Each step is illustrated with a real capture from the engine or editor (no div-built fake UI) and named by its action, not "Step 1/2/3".

- **AC-WEB-025.1** Given the section, Then it contains 4 images whose files are listed in `public/sprites/manifest.json` with provenance (REQ-WEB-033), and no label matches `/^(step|stage|phase)\s*\d/i`.

**REQ-WEB-026 [P1]** THE SYSTEM SHALL present feature highlights for:

- mix-and-match parts
- anatomy
- camera styles (the same character in side view and in top-down 3/4, side by side)
- the shader graph editor
- custom models (local-first, private)
- export formats (PNG sheet + metadata JSON + `CREDITS.txt`)

Each feature has a real visual and a link to its guide page. The layout is not a row of 3 equal cards (taste §9.C). A bento layout uses exactly N cells for N items.

- **AC-WEB-026.1** Given the section, Then 6 features are shown, each with an image from `public/sprites/` or `public/shots/` and a link to an existing `/docs/**` route.
- **AC-WEB-026.2** Given a feature whose status in `apps/site/content/features.json` is `planned`, Then it is either hidden or labelled "Planned" with no CTA into the editor. No planned feature is presented as available.

**REQ-WEB-027 [P2]** THE SYSTEM SHALL offer an interactive mini demo where the visitor swaps between ≥ 3 pre-rendered part combinations and ≥ 4 palettes, live. Palette swaps remap the indexed palette colors of the pre-rendered frames on a 2D canvas, so the output equals a real export with that palette.

- **AC-WEB-027.1** Given combination B with palette "Endesga-32" is selected, Then the displayed frame equals the corresponding golden file produced by the export pipeline, pixel for pixel.
- **AC-WEB-027.2** Given keyboard-only use, Then every demo control is reachable by Tab, operable by Enter/Space/arrows, has a visible label, and announces the change through an `aria-live="polite"` region.
- **AC-WEB-027.3** Given the demo's assets, Then they are lazy-loaded when the section nears the viewport (≤ 1 viewport away) and total ≤ 250 KB.
- **AC-WEB-027.4** Given the demo, Then it has an "Open this in the editor" link that loads the same `CharacterSpec` and palette in `/app/` (share-by-URL format owned by spec 009 / 001).

**REQ-WEB-028 [P3]** WHERE the embedded live demo is enabled THE SYSTEM SHALL embed the built editor in a lazy-loaded `<iframe>` (architecture rule 5). The iframe is loaded only after an explicit user click.

- **AC-WEB-028.1** Given `/` loads, Then no `/app/` resource is requested until the user activates "Try it live".

**REQ-WEB-029 [P1]** THE SYSTEM SHALL include an "Open source" section that credits the bundled assets. The credits name Quaternius (and any other pack used), the license (CC0) and source links, and are generated at build time from `ASSETS_LICENSE.md`. The section also links to the repository and its `LICENSE`.

- **AC-WEB-029.1** Given `ASSETS_LICENSE.md` lists 3 packs, Then the section lists the same 3 packs with author, license and source URL. Adding a pack to that file and rebuilding adds it to the page with no site code change.

**REQ-WEB-030 [P2]** THE SYSTEM SHALL show a gallery of ≥ 6 generated sprite sheets (on `/` as a preview and on `/gallery/` in full). The sheets mix side and top-down cameras and at least 2 resolutions. Each sheet offers its PNG download, its credits, and "Open in editor" for its `CharacterSpec`.

- **AC-WEB-030.1** Given a gallery item, Then its PNG, metadata JSON and `CREDITS.txt` exist under `public/sprites/gallery/<id>/` and match the provenance entry.

**REQ-WEB-031 [P1]** THE SYSTEM SHALL include a community/contribute call to action that links to the Contribute docs, the repository, and the issue list filtered by the `good first issue` label.

- **AC-WEB-031.1** Given the section, Then it contains those 3 links, and its CTA intent does not duplicate any other CTA on the page (taste §14).

**REQ-WEB-032 [P1]** THE SYSTEM SHALL show a footer with links to:

- Docs, Editor, Gallery (once present), Contribute
- the GitHub repository, the license, the asset credits

The footer also contains a theme toggle. It has no version string, build ID, or locale/time strip.

- **AC-WEB-032.1** Given the footer, Then all links resolve (REQ-WEB-008), and its text does not match `/v\d+\.\d+|build \d+/i`.

**REQ-WEB-033 [P1]** THE SYSTEM SHALL record the provenance of every sprite or screenshot on the landing page and gallery in `apps/site/public/sprites/manifest.json`. Each entry includes:

- the `CharacterSpec` file
- the render settings
- the app version
- the backend
- the asset IDs

Production builds fail if an image has no entry or is marked `placeholder`.

- **AC-WEB-033.1** Given `NODE_ENV=production` and an image in `public/sprites/` without a manifest entry, When the build runs, Then it fails and names the file.
- **AC-WEB-033.2** Given `pnpm site:sprites` (headless export via `apps/web` + Playwright, spec 005), When it is run twice on the same backend, Then the produced PNGs are byte-identical (P-04).

**REQ-WEB-034 [P1]** THE SYSTEM SHALL contain no hotlinked external images, fonts, scripts or styles. Every runtime request from `/` and `/docs/**` goes to the site's own origin.

- **AC-WEB-034.1** Given `/`, `/docs/` and one guide page are loaded and scrolled, When requests are recorded, Then 0 requests go to another origin.

### Visual design and theming

**REQ-WEB-035 [P1]** THE SYSTEM SHALL support light and dark themes:

- The default follows `prefers-color-scheme`.
- A manual toggle is provided, and the choice persists in `localStorage`.
- The theme loads with no flash of the wrong theme.
- The landing page and docs share one set of design tokens.

- **AC-WEB-035.1** Given dark OS preference and no stored choice, When `/` loads, Then the first paint is dark (no light frame in a 60 fps trace).
- **AC-WEB-035.2** Given both themes, Then every text/background pair on `/` and a docs page meets ≥ 4.5:1 contrast (≥ 3:1 for large text and UI boundaries), measured by axe.

**REQ-WEB-036 [P1]** THE SYSTEM SHALL use at most 3 self-hosted font families with OFL or CC0 licenses. The fonts are recorded in `ASSETS_LICENSE.md` (P-02):

- a pixel display face, for headings ≥ 24 px only, at sizes that are integer multiples of its design grid
- a readable sans for body and UI (not Inter by default, per taste §9.B)
- a monospace face for code

Body text is never set in the pixel face.

- **AC-WEB-036.1** Given the built CSS, Then every `@font-face` `src` is same-origin, uses `font-display: swap`, and has a metric-matched fallback (`size-adjust`) so font swap adds ≤ 0.01 CLS.
- **AC-WEB-036.2** Given any element whose computed `font-family` is the pixel face, Then its `font-size` is ≥ 24 px and an integer multiple of the face's grid unit.

**REQ-WEB-037 [P1]** THE SYSTEM SHALL use one accent color and one corner-radius system across the landing page and docs. The page contains no AI-template tells from taste skill §9, including:

- em-dash or en-dash separators
- purple gradients
- neon glows
- pure `#000`
- fake product UI made of divs
- generic step labels
- section-number eyebrows

- **AC-WEB-037.1** Given the built HTML of `/`, Then visible text contains 0 `—` and 0 `–` characters, and computed colors include no `rgb(0, 0, 0)` backgrounds.
- **AC-WEB-037.2** Given the web-designer's handoff, Then it includes the taste skill §14 pre-flight checklist with every box ticked or a justified exception.

### SEO, metadata and privacy

**REQ-WEB-038 [P1]** THE SYSTEM SHALL emit the following for every page:

- a unique `<title>`, a meta description and a canonical URL (with `SITE_URL` + `basePath`)
- Open Graph and Twitter card tags
- an OG image of 1200×630 PNG, generated at build time (pixel-art for `/`, title-based for docs)

- **AC-WEB-038.1** Given the export, Then no two pages share a `<title>`, every page has `og:image` resolving to a 1200×630 PNG in the export, and `rel=canonical` is absolute.

**REQ-WEB-039 [P1]** THE SYSTEM SHALL generate `sitemap.xml` listing every public HTML route with absolute URLs, and a `robots.txt` that references it. Both files SHALL be written into `apps/site/out/` by the site's `postbuild` script from the build page list, not by Next.js metadata routes (`app/sitemap.ts`, `app/robots.ts`), so they can include `/app/` (not a Next.js route) and honour `SITE_URL` + `basePath`. (consistency review 2026-10-08)

- **AC-WEB-039.1** Given the export, Then `sitemap.xml` has exactly one `<loc>` per route in the build page list (`/app/` included once, 404 excluded).
- **AC-WEB-039.2** Given the `apps/site/app/` tree, Then it contains no `sitemap.ts`, `sitemap.xml`, `robots.ts` or `robots.txt`; Given `pnpm --filter @csg/site build` completes, Then `out/sitemap.xml` and `out/robots.txt` exist and `robots.txt` contains `Sitemap: <SITE_URL><basePath>/sitemap.xml`.

**REQ-WEB-040 [P1]** THE SYSTEM SHALL NOT include analytics, tracking pixels, third-party embeds or cookies on the site in v1.

- **AC-WEB-040.1** Given `/` and a docs page, When storage and requests are inspected, Then no cookies are set, and the only `localStorage` keys are the theme and the animation pause preference.

**REQ-WEB-041 [P1]** THE SYSTEM SHALL serve a custom 404 page with links to `/`, `/docs/` and the search. For paths under `/app/`, it offers a link back to `<basePath>/app/`.

- **AC-WEB-041.1** Given `/docs/nope/`, Then the 404 page renders in the site theme with those links and returns HTTP 404 on GitHub Pages.

## Edge cases

- `basePath` empty vs `/<repo>`, and the editor under `/app/` → REQ-WEB-002, 004, AC-WEB-002.1/2
- Deep links into the editor (`/app/some/route`) on a host with no rewrites → REQ-WEB-041; the editor itself has no path routes (spec 009 REQ-UX-048)
- Shallow git clone with no history for "Last updated" → AC-WEB-014.2
- Guide page with MDX syntax or a `.mdx` extension → REQ-WEB-005, 006
- Page missing from `meta.json`, or a folder without it → AC-WEB-010.2
- Relative links to `specs/` or code → REQ-WEB-009
- No WebGL/WebGPU on the visitor's machine → REQ-WEB-023, 024
- Reduced motion, and auto-playing animation longer than 5 s → REQ-WEB-021, 022
- Font loading or theme flash causing CLS → REQ-WEB-035, 036
- Sprite assets not yet producible (before M3 export exists) → REQ-WEB-033 (placeholder allowed only outside production) and the open question below
- Very large search index as docs grow → AC-WEB-012.2 budget; revisit if exceeded
- Planned features advertised before they ship → AC-WEB-026.2

## Data & contracts

```ts
/** Front matter of docs/guide/** and docs/contributing/** pages (validated with Zod at build). */
export interface GuideFrontmatter {
  /** 1-70 chars, used as <title> and H1. */
  readonly title: string;
  /** 50-160 chars, used as meta description and search snippet. */
  readonly description: string;
  /** Optional sidebar icon name from the site's icon package. */
  readonly icon?: string;
}

/** Build-time configuration (environment variables). */
export interface SiteEnv {
  /** Absolute origin, e.g. https://<owner>.github.io . */
  readonly SITE_URL: string;
  /** '' or '/<repo>'. No trailing slash. */
  readonly SITE_BASE_PATH: string;
  /** e.g. https://github.com/<owner>/<repo> . */
  readonly REPO_URL: string;
  /** Default 'main'. */
  readonly REPO_BRANCH: string;
}

/** apps/site/public/sprites/manifest.json */
export interface SpriteManifest {
  readonly format: 'csg-site-sprites';
  readonly version: 1;
  readonly items: ReadonlyArray<{
    /** Path relative to public/, e.g. 'sprites/hero/knight-walk-8dir.png'. */
    readonly file: string;
    readonly kind: 'sheet' | 'frame' | 'screenshot';
    /** Repo path of the CharacterSpec / project fixture used. Absent for screenshots. */
    readonly characterSpec?: string;
    /** Sheet cell size in px (integer). Required for kind 'sheet'. */
    readonly cell?: { readonly w: number; readonly h: number };
    readonly renderSettings?: Record<string, unknown>;
    readonly appVersion: string;
    readonly backend: 'webgpu' | 'webgl2';
    /** Bundled asset IDs used, for credits. */
    readonly assets: readonly string[];
    readonly placeholder?: boolean;
  }>;
}

/** apps/site/content/features.json entries (REQ-WEB-026). */
export interface FeatureEntry {
  readonly id: 'parts' | 'anatomy' | 'cameras' | 'shader-graph' | 'custom-models' | 'export';
  readonly status: 'available' | 'planned';
  /** Route under /docs/ that explains the feature. */
  readonly docs: string;
  /** Path under public/. */
  readonly image: string;
}
```

Example `docs/guide/meta.json`:

```json
{
  "title": "Guide",
  "root": true,
  "pages": ["index", "getting-started", "composer", "anatomy", "render-settings",
            "animation", "export", "shader-graph", "custom-models", "---Help---", "faq", "troubleshooting"]
}
```

## Non-functional

- **NFR-1 Lighthouse (mobile preset, Lighthouse CI, median of 3 runs) on `/`, `/docs/` and `/docs/export/`:**
  - Performance ≥ 90 (P-07 floor; target 95)
  - Accessibility ≥ 95
  - Best Practices ≥ 95
  - SEO ≥ 95
  - A drop below these values fails CI.
- **NFR-2 Web vitals on `/` (mobile, Lighthouse lab):**
  - LCP ≤ 2.0 s and CLS ≤ 0.05 (architecture §4.3; stricter than the 0.1 "good" threshold)
  - TBT ≤ 200 ms
  - Every image and canvas has explicit dimensions.
- **NFR-3 Weight of `/`:**
  - initial JS ≤ 120 KB gzipped
  - above-the-fold images ≤ 150 KB in total
  - the hero sprite sheet ≤ 60 KB, with its first frame preloaded
  - all images below the fold are lazy-loaded
- **NFR-4 Accessibility (P-06, WCAG 2.2 AA):**
  - axe-core reports 0 serious or critical violations on `/`, `/docs/`, `/gallery/` and one docs page, in both themes.
  - The page has a skip link, landmarks (`header`, `nav`, `main`, `footer`), and visible focus.
  - Targets are ≥ 24×24 px.
  - Each sprite has alt text describing the character and action. An animated canvas uses `role="img"` and an `aria-label`.
- **NFR-5 Privacy:** REQ-WEB-034 and REQ-WEB-040. The site makes no requests to third parties at runtime.
- **NFR-6 Build time:** a cold `pnpm --filter @csg/site build` takes ≤ 3 min in CI for the P1 page set.
- **NFR-7 Code style:** P-08. Default exports appear only in the Next.js files listed in architecture §4.9.

## Open questions

- [NEEDS CLARIFICATION: Production origin. Will the site use the GitHub Pages project URL (`https://<owner>.github.io/<repo>/`, so `basePath=/<repo>`) or a custom domain? This affects canonical URLs, OG and the sitemap (REQ-WEB-038/039). Owner: maintainers. Not blocking: `SITE_URL`/`SITE_BASE_PATH` are config.]
- [NEEDS CLARIFICATION: Repository owner/name and default branch for `REPO_URL`, needed by the edit links (REQ-WEB-013) and the credits section. Owner: maintainers.]
- ~~Editor routing under `/app/` on a host without rewrites.~~ Resolved by spec 009 REQ-UX-048: the editor is a single route at `<basePath>/app/` with deep state only in the URL fragment, so no rewrites or `404.html` redirect are needed. REQ-WEB-041 stays as the fallback link.
- ~~Until M3 export exists, what does the hero show in production?~~ Resolved 2026-10-08 (PM): clearly marked placeholder sprites are allowed only in non-production builds; the production provenance gate (REQ-WEB-033) stays on, so production waits for real sheets.
- [NEEDS CLARIFICATION: Opt-in, cookie-less, self-hosted analytics after v1? v1 has none (REQ-WEB-040). Owner: maintainers.]
- [NEEDS CLARIFICATION: Community channel beyond GitHub (Discussions, Discord, Matrix) for REQ-WEB-031. Owner: maintainers.]
- ~~Conflict with `.claude/agents/web-designer.md`~~ Resolved 2026-10-08 (PM): ADR-0007 wins and the agent file was updated. Original note: `.claude/agents/web-designer.md` said hero sprites are "rendered by `@csg/engine`" and set Lighthouse ≥ 95 for performance. ADR-0007 and architecture rule 5 forbid engine runtime dependencies in `apps/site` in v1, and constitution P-07 sets performance ≥ 90. This spec follows the ADR and the constitution: sprites are pre-rendered, performance is ≥ 90 with a target of 95. `web-designer.md` should be updated to match (owner: PM / T8).
- Engine-specific export targets named in feature highlights and `export/using-in-game-engines` (Godot, Unity, Phaser, …) follow spec 005. Do not list engines the exporter does not support.

## References

- ADR-0007 Next.js + Fumadocs website; ADR-0002 (style, default-export exception); `docs/architecture.md` §1 rule 5, §4.3, §4.7–4.9, §5 Website track
- `specs/constitution.md` P-02, P-03, P-04, P-06, P-07, P-08, P-11
- `.claude/skills/design-taste-frontend/SKILL.md` §0, §1, §9, §14
- Next.js static exports (v16.4 docs): https://nextjs.org/docs/app/guides/static-exports (accessed 2026-10-08)
- Fumadocs Orama static search (`staticGET`, `staticClient`): https://fumadocs.dev/docs/headless/search/orama (accessed 2026-10-08)
- Next.js GitHub Pages template: https://github.com/nextjs/deploy-github-pages
- WCAG 2.2, SC 2.2.2 Pause, Stop, Hide; SC 2.5.8 Target Size (Minimum): https://www.w3.org/TR/WCAG22/
- GitHub Markdown alerts syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts
- Quaternius asset packs (CC0): https://quaternius.com
