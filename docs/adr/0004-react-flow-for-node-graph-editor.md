# 0004. React Flow for the node graph editor, own graph model

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect, editor UX engineer
- Related: specs 006 (graph editor), 007 (graph format/compiler); ADR-0003

## Context

Users tweak materials and post-processing in a Blender/Unity-style node editor: typed colored
sockets, search popup, reroutes, frames, node groups, previews, mute, blackboard params, minimap,
undo/redo, copy/paste. Nodes need rich widgets (sliders, color pickers, preview images). The editor
app is React (ADR-0002). The graph must also be compiled, validated, migrated and tested without a
browser.

## Decision

- Use **`@xyflow/react` (React Flow v12, MIT)** as the view layer in `apps/web/src/features/shader-graph`.
- Keep a **pure-TS graph model** in `@csg/shader-graph`, independent of React Flow: document format
  (`sprite-shadergraph`, versioned, per-node-type versions `type@ver`), typed socket registry with
  implicit casts, validation, command stack for undo/redo, migrations.
- React Flow state is a projection of the model. All edits go through model commands; React Flow
  callbacks (`onConnect`, `isValidConnection`, `onNodesChange`) translate into commands.
- UI-only state (viewport, frames) is stored in the document's `ui` field and ignored by the
  compiler.

## Consequences

- Good: nodes are plain React components, so sliders, color pickers and previews are easy.
- Good: built-in minimap, controls, selection and large active community.
- Good: the model is unit-testable in Node and reusable by tools; the view can be replaced later.
- Bad: two representations (model and React Flow nodes) must be kept in sync; a mapping layer and
  tests are required.
- Bad: Blender-style features (reroutes, frames, groups, socket-filtered search) are custom code on
  top of React Flow.
- Risk: performance with very large graphs. Mitigation: memoized node components, collapse, and a
  node-count budget in spec 006.

## Alternatives considered

- **Rete.js v2**: framework-agnostic and graph-oriented, but a smaller community and fewer
  maintained plugins.
- **litegraph.js**: canvas-based and fast, but unmaintained since 2024-08; widgets are not React.
- **ComfyUI litegraph fork**: archived 2025-08.
- **Baklava.js**: Vue-based; would add a second UI framework.
- **Use React Flow's state as the source of truth**: simpler at first, but couples format,
  compiler and tests to a UI library.
