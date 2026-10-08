---
title: Writing a shader node
description: Add a node type to the shader graph, with its metadata, its TSL emitter, its migrations and its tests.
---

The shader graph is a pure model with a compiler to three.js TSL. A node type has two parts that must stay in sync:

- **Metadata** in the `@csg/shader-graph` root (no three.js, no React). It lists the category, the targets (`material` or `post`), and the inputs and outputs with stable socket IDs and types.
- **Emitter** in `packages/shader-graph/src/tsl/`. It turns the inputs into a TSL expression, for example `(i) => mix(i.a, i.b, i.t)`.

Read spec 007 (`specs/007-shader-graph-format.md`) for the format and the SGF requirements before you start.

## Steps

1. **Check the spec.** If the node adds behavior, update spec 007 first and cite its IDs in the PR.
2. **Name the type.** Use `category.name@1`, for example `toon.ramp@1`. The version is part of the type.
3. **Write the metadata.** Add a `NodeTypeSpec` in the root of `packages/shader-graph`. Socket IDs are stable strings. Never use array positions.
4. **Write the emitter.** Add it in `src/tsl/`. Use only the TSL API of the pinned three.js version (r186). Check `node_modules/three` for it. The emitter receives a `CompileContext`, never the engine.
5. **Keep both in sync.** Add a test that fails when the emitter and the metadata disagree on type IDs or socket IDs.
6. **Add migrations when needed.** A new version of an existing type needs `migrateFrom` for the previous version. A behavior change means a new version, not an edit to the old one.
7. **Expose parameters.** Parameters you want as sliders go in the graph's blackboard as `GraphParam`s. Changing a parameter updates a uniform and does not recompile.
8. **Document it.** If users see the node, add a page or section in `docs/guide/`.

## Tests

- Test the metadata and graph validation in Node, under the root of the package.
- Test the compiler with a fake `CompileContext` in `src/tsl/`. Do not import the engine.
- Name each test after the SGF AC it checks, for example `it('AC-SGF-001.1: ...')`.

```sh
pnpm exec vitest run packages/shader-graph
pnpm --filter @csg/shader-graph build
```

## Rules to keep

- No `three` import outside `src/tsl/`.
- No React or DOM APIs in the package.
- No `any`. Use `unknown` and narrow it.
- Use named exports, a kebab-case file name, and TSDoc on every export.
- Compile errors name the node and socket they belong to, so the editor can show them on the node.
