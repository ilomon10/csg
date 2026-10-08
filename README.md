# Character Sprite Generator

Build game-ready pixel-art character sprite sheets in your browser. Pick modular 3D parts, adjust the anatomy, choose a camera, and export.

Status: pre-release. Every feature below is **Planned**. The specs in `specs/` define the scope.

## Why it exists

- **3D to pixel art.** One character renders in any number of directions, animations and resolutions (32 to 128 px).
- **Two camera families.** Side-view (platformer) and top-down, 3/4 or isometric (RPG) are equal first-class targets.
- **Local-first and free.** No account and no server. Your files stay in your browser.
- **Hackable.** Data-driven parts and palettes, an editable node-based shader graph, and Markdown docs.

## Features

- **Planned:** modular character composer with slots, tints and prop sockets (spec 001)
- **Planned:** bone-scale anatomy sliders with child compensation (spec 002)
- **Planned:** pixel render pipeline with toon shading, outlines, palettes, dither and texel snapping (spec 003)
- **Planned:** animation playback and frame sampling (spec 004)
- **Planned:** deterministic sprite-sheet export with PNG, JSON metadata and `CREDITS.txt` (spec 005)
- **Planned:** node-based shader graph editor (specs 006 and 007)
- **Planned:** custom model upload for GLB/glTF and VRM, with license capture (spec 008)
- **Planned:** editor shell with undo/redo, shortcuts, persistence and accessibility (spec 009)
- **Planned:** website with a landing page and user guide (spec 010)

## Screenshots

TODO: add editor screenshots and sprite animations once the first export works (spec 010).

## Quick start

You need Node.js 24 (see `.nvmrc`). pnpm is pinned in `package.json`; enable it with Corepack.

```sh
git clone https://github.com/ilomon10/csg.git
cd character-sprite-generator
corepack enable
pnpm install
pnpm --filter @csg/web dev
```

Open the local URL that Vite prints. To check your work, run `pnpm lint`, `pnpm typecheck` and `pnpm test`.

## Documentation

- User guide: `docs/guide/` (the source for the website)
- Specs: `specs/000-overview.md` (feature map) and `specs/constitution.md` (principles)
- Architecture: `docs/architecture.md`
- Decisions: `docs/adr/`
- Contributing: `CONTRIBUTING.md` and `docs/contributing/`
- Rules for AI agents and contributors: `AGENTS.md`

## Credits

Built-in characters, outfits and animations come from Quaternius under CC0:

- Universal Base Characters
- Modular Character Outfits - Fantasy
- Universal Animation Library

Fallback characters and props come from KayKit (CC0). Each export also includes a `CREDITS.txt` that lists the assets it uses. Full sources and licenses are in `ASSETS_LICENSE.md`.

## Community

- Code of conduct: `CODE_OF_CONDUCT.md`
- Security reports: `SECURITY.md` (do not open public issues for vulnerabilities)

## License

The code is released under the MIT License. See `LICENSE`. Bundled assets keep their own licenses; see `ASSETS_LICENSE.md`.
