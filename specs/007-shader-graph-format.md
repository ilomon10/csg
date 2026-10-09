---
id: SGF
title: Shader graph format and compiler
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 003-pixel-render-pipeline, 006-shader-graph-editor]
last_updated: 2026-10-09
---

# 007 – Shader graph format and compiler

## Context

Spec 006 (EDT) describes the node editor that users see. This spec covers what sits underneath:

- the persisted **graph document** (`sprite-shadergraph`, file extension `.csgraph.json`),
- its validation and migrations,
- the **socket type system** and implicit casts,
- the **node type contract** that built-in and third-party nodes implement,
- the **compiler** that turns a document into three.js TSL nodes.

The architecture splits the work across two entry points (docs/architecture.md §1.1, §3.5, rule 3):

- `@csg/shader-graph` is the pure model (Zod schema, registry metadata, validation, migrations, commands, URL compression). It does not import three.js or React.
- `@csg/shader-graph/tsl` holds the compiler and node emitters. It compiles against a `CompileContext` that `@csg/engine` implements, so the compiler never imports the engine.

Exposed params become TSL `uniform()` nodes, so moving a slider changes `.value` and never recompiles (ADR-0003). The M2 pixel pipeline (spec 003) ships first as fixed stages. In M4 the built-in material and post graphs are rebuilt as documents, and they must reproduce the M2 golden images pixel for pixel.

Related: ADR-0003 (WebGPURenderer + TSL, r186 pinned), ADR-0004 (own graph model, React Flow view), research brief §Shader graph editor.

## Goals

- G1: A versioned, human-readable JSON format that stays loadable forever through ordered migrations.
- G2: A typed socket system with predictable implicit casts, shared by the editor (006) and the compiler.
- G3: A deterministic compiler from document to TSL that reports errors per node and socket.
- G4: Param and inline value edits apply on the next frame, with no shader recompile.
- G5: Default graphs that reproduce the M2 look exactly, so M4 changes nothing visually.
- G6: Contributors can add node types as data plus one emitter function (constitution P-11).

## Non-goals

- NG1: Raw GLSL/WGSL authoring by users, in any version. The P3 custom function node only picks from hand-written built-in functions; documents never carry `wgslFn`/`glslFn` source strings (security review 2026-10-08).
- NG2: Control flow as nodes (If/Loop/Fn). Those live inside hand-written custom function nodes (research brief).
- NG3: Vertex-stage graphs (displacement, skinning). v1 graphs are fragment/surface and post only.
- NG4: Loading node code from a URL or from the graph file. Node types are only registered in code.
- NG5: Cross-backend pixel identity. Determinism is per backend (constitution P-04).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | tech artist | to save my graph as a file and reopen it in a later app version | my look keeps working after updates |
| US-2 | P1 | tech artist | a slider change to show up immediately | I can tune the look interactively |
| US-3 | P1 | tech artist | errors to name the node and socket | I can fix a broken graph quickly |
| US-4 | P1 | indie game dev | the default look to stay identical when graphs ship | my existing exports don't change |
| US-5 | P2 | tech artist | to share a graph as a link | others can try my look without a file |
| US-6 | P3 | modder | to register my own node types | I can extend the editor without forking |

## Requirements

### Document and validation

**REQ-SGF-001 [P1]** THE SYSTEM SHALL persist a shader graph as a JSON document with `format: "sprite-shadergraph"`, an integer `version`, a `target` of `"material"` or `"post"`, and the fields `nodes`, `edges`, `params`, `groups` and `ui` defined in Data & contracts.

- **AC-SGF-001.1** Given the built-in default material graph, When it is serialized, Then the JSON validates against the published JSON Schema `shadergraph.v1.schema.json` and has `format`, `version: 1`, `target: "material"`.
- **AC-SGF-001.2** Given a document without `format` or with `format: "other"`, When it is loaded, Then loading fails with code `SGF_SCHEMA_INVALID` and the JSON path `$.format`.

**REQ-SGF-002 [P1]** THE SYSTEM SHALL validate every loaded document with the Zod schema from `@csg/shader-graph` and SHALL preserve unknown fields at every object level on a load → save round trip.

- **AC-SGF-002.1** Given a valid document with an extra top-level field `"x-author": "ann"` and an extra node field `"x-note": "hi"`, When it is loaded and saved without edits, Then both fields are present with identical values in the output.
- **AC-SGF-002.2** Given a document where `nodes[3].pos` is `"abc"`, When it is loaded, Then validation fails with `SGF_SCHEMA_INVALID` and an issue whose path is `nodes.3.pos`.

**REQ-SGF-003 [P1]** THE SYSTEM SHALL reject a document that has duplicate node IDs, an edge that refers to a missing node or socket, or more than one edge into the same input socket, and SHALL report each problem with its node and socket ID.

- **AC-SGF-003.1** Given two nodes with ID `n1`, When validated, Then an error `SGF_DUPLICATE_ID` names `n1`.
- **AC-SGF-003.2** Given an edge `to: ["n9","color"]` where `n9` does not exist, When validated, Then an error `SGF_DANGLING_EDGE` names the edge index and `n9`.
- **AC-SGF-003.3** Given two edges into `["n2","a"]`, When validated, Then an error `SGF_INPUT_MULTIPLE` names node `n2`, socket `a`.

**REQ-SGF-004 [P1]** THE SYSTEM SHALL identify sockets by stable string IDs declared in the node type, never by array position, in both edges and `inputs`.

- **AC-SGF-004.1** Given node type `math.mix@1` whose input order in the definition changes from `[a,b,t]` to `[t,a,b]`, When an existing document is loaded, Then every edge still connects to the same named socket and compiled output is unchanged.

**REQ-SGF-005 [P1]** THE SYSTEM SHALL serialize documents canonically: object keys in a fixed order (`format`, `version`, `target`, `name`, `nodes`, `edges`, `params`, `groups`, `ui`, then unknown keys sorted), nodes sorted by ID, edges sorted by `to` then `from`, 2-space indentation and a trailing newline.

- **AC-SGF-005.1** Given the same graph built through two different edit orders, When both are saved, Then the files are byte-identical.

### Migrations

**REQ-SGF-006 [P1]** WHEN a document with `version` lower than the current version is loaded THE SYSTEM SHALL apply the ordered pure document migrations `vN → vN+1` up to the current version before validation, and SHALL save only the current version.

- **AC-SGF-006.1** Given a fixture `v1` document and a test migration `v1 → v2`, When loaded with current version 2, Then the result validates as v2 and the migration ran exactly once.
- **AC-SGF-006.2** Given any migration, When it runs on a frozen (`Object.freeze`, deep) input, Then it does not throw and does not mutate the input.

**REQ-SGF-007 [P1]** WHEN a node's `type@ver` is older than the registered version of that type THE SYSTEM SHALL apply that type's migrations in order (`@1 → @2 → …`). Each migration may rename or retype sockets and SHALL rewrite the edges attached to them.

- **AC-SGF-007.1** Given a node `toon.ramp@1` with an edge into socket `bands`, and a registered `toon.ramp@2` whose migration renames `bands` to `steps`, When loaded, Then the node type is `toon.ramp@2`, its edge targets `steps`, and the compiled output equals the v1 output.

**REQ-SGF-008 [P1]** IF a document's `version` or a node's type version is newer than this app supports THEN THE SYSTEM SHALL refuse to load it with `SGF_VERSION_UNSUPPORTED`, name the version found and the maximum supported, and SHALL NOT modify or overwrite the stored document.

- **AC-SGF-008.1** Given a document with `version: 99`, When loaded, Then the error message contains "99" and the supported version, and the stored bytes are unchanged.

**REQ-SGF-009 [P1]** IF a migration throws THEN THE SYSTEM SHALL abort loading with `SGF_MIGRATION_FAILED`, naming the document or node ID and the step (`toon.ramp@1→@2`), and SHALL keep the original document unchanged.

- **AC-SGF-009.1** Given a migration that throws on node `n4`, When loaded, Then the error names `n4` and the step, and the original document can still be exported as-is.

### Types and casts

**REQ-SGF-010 [P1]** THE SYSTEM SHALL support the socket types `float`, `int`, `bool`, `vec2`, `vec3`, `vec4`, `color` and `texture`, plus the generic socket type `genType` that resolves per node instance (see Type system).

- **AC-SGF-010.1** Given the socket type registry, When listed, Then it contains exactly these 8 concrete types plus `genType`, and each entry has an ID, a label, a color token and a shape token (spec 006).

**REQ-SGF-011 [P1]** WHEN an edge connects sockets of different types THE SYSTEM SHALL accept it only when the implicit cast table allows that pair, and SHALL insert the listed cast during compilation.

- **AC-SGF-011.1** Given a `float` output connected to a `vec3` input, When compiled, Then the input receives `vec3(x, x, x)`.
- **AC-SGF-011.2** Given a `vec3` output connected to a `color` input, When compiled, Then the input receives `vec4(rgb, 1.0)`.
- **AC-SGF-011.3** For every pair in the cast table, a unit test asserts `canConnect(from, to)` matches the table's cell (allowed, allowed-lossy or rejected).

**REQ-SGF-012 [P1]** IF a document contains an edge between types the cast table rejects THEN THE SYSTEM SHALL load the document, keep the edge, and report `SGF_TYPE_MISMATCH` on the target node and socket during compilation.

- **AC-SGF-012.1** Given a hand-edited file with a `texture → float` edge, When loaded and compiled, Then loading succeeds, the edge is kept, and compile reports `SGF_TYPE_MISMATCH` for that target socket.

**REQ-SGF-013 [P1]** THE SYSTEM SHALL resolve each `genType` socket on a node instance to the widest concrete type connected to that node's `genType` inputs (`float < vec2 < vec3 < vec4`), and to `float` when none are connected. `color` counts as `vec4`.

- **AC-SGF-013.1** Given `math.add@1` with input `a` from a `vec3` and input `b` from a `float`, When compiled, Then output `out` is `vec3` and `b` is splatted.
- **AC-SGF-013.2** Given `math.add@1` with nothing connected, When typechecked, Then all its `genType` sockets resolve to `float`.

### Node types

**REQ-SGF-014 [P1]** THE SYSTEM SHALL define every node type through a `NodeTypeSpec` (pure metadata, root entry) and a matching `NodeEmitter` (TSL, `/tsl` entry), and a registry test SHALL fail if a spec has no emitter, if an emitter has no spec, or if their socket IDs differ.

- **AC-SGF-014.1** Given a spec `foo.bar@1` registered without an emitter, When the registry sync test runs, Then it fails and names `foo.bar@1`.

**REQ-SGF-015 [P1]** IF a document contains a node whose type is not registered THEN THE SYSTEM SHALL keep the node and all its fields and edges, report `SGF_UNKNOWN_NODE_TYPE` on it, and SHALL NOT compile the graph's output until the node is removed or its type is registered.

- **AC-SGF-015.1** Given a document with node `acme.glow@1` that is not registered, When loaded, edited elsewhere and saved, Then the node, its inputs and edges are preserved byte-for-byte, and compile returns `ok: false` with `SGF_UNKNOWN_NODE_TYPE` naming the node.

**REQ-SGF-016 [P1]** IF a node type's `targets` list does not include the document's `target` THEN THE SYSTEM SHALL report `SGF_TARGET_MISMATCH` on that node.

- **AC-SGF-016.1** Given a material graph that contains `post.sampleDepth@1`, When compiled, Then the error `SGF_TARGET_MISMATCH` names that node.

### Compiler

**REQ-SGF-017 [P1]** THE SYSTEM SHALL compile a document in this fixed order: (1) migrate and validate, (2) flatten groups, (3) find the single output node for the target, (4) drop nodes that do not reach the output, (5) detect cycles, (6) topologically sort, (7) resolve `genType`, typecheck and insert casts, (8) apply mute bypasses, (9) emit TSL through the `CompileContext`.

- **AC-SGF-017.1** Given a graph with an unconnected dangling subtree that has a type error, When compiled, Then compile succeeds (dead nodes are not typechecked) and returns a warning `SGF_UNUSED_NODE` for each dropped node.
- **AC-SGF-017.2** A unit test with a spy `CompileContext` asserts that `builtin()` and emitters are called only after the topological sort and only for live nodes.

**REQ-SGF-018 [P1]** IF the live part of a graph contains a cycle THEN THE SYSTEM SHALL fail compilation with `SGF_CYCLE` and list every node ID in the cycle.

- **AC-SGF-018.1** Given edges n1→n2→n3→n1 feeding the output, When compiled, Then `ok: false` and an `SGF_CYCLE` error per node lists `[n1, n2, n3]`.

**REQ-SGF-019 [P1]** THE SYSTEM SHALL break ties in the topological sort by node ID (code-unit order), so the emitted TSL node order is deterministic.

- **AC-SGF-019.1** Given the same document loaded 100 times with shuffled `nodes` array order, When compiled, Then `structureHash` and the emitted call sequence (spy context) are identical every time.

**REQ-SGF-020 [P1]** IF the graph has no output node for its target, or more than one THEN THE SYSTEM SHALL fail with `SGF_MISSING_OUTPUT` or `SGF_MULTIPLE_OUTPUTS`.

- **AC-SGF-020.1** Given a material graph with two `output.material@1` nodes, When compiled, Then `SGF_MULTIPLE_OUTPUTS` names both node IDs.

**REQ-SGF-021 [P1]** WHEN a node is muted THE SYSTEM SHALL compile it as a bypass: each output takes the value of the first input whose type can cast to that output's type, in declaration order, and otherwise takes the output's default value.

- **AC-SGF-021.1** Given a muted `post.posterize@1` between `post.sampleColor@1` and `output.post@1`, When compiled and rendered, Then the output pixels equal the graph without that node.
- **AC-SGF-021.2** Given a muted node with no castable input, When compiled, Then its output is the type default (`0`, `vec(0)`, black opaque `color`, `false`) and no error is raised.

**REQ-SGF-022 [P1]** THE SYSTEM SHALL compile each blackboard param to one TSL `uniform()` and return it in `CompileResult.uniforms`. WHEN a param value changes THE SYSTEM SHALL update that uniform's `.value` without recompiling.

- **AC-SGF-022.1** Given a compiled default post graph, When `setParam('outline.outer.widthPx', 2)` is called, Then the next rendered frame shows the 2 px outline, the compiler is not invoked (spy), and `structureHash` is unchanged.

**REQ-SGF-023 [P1]** THE SYSTEM SHALL compile unconnected `float`, `int`, `bool`, `vec2..4` and `color` inline input values as uniforms, so editing an inline value does not trigger a recompile.

- **AC-SGF-023.1** Given an inline `steps` value on `toon.ramp@1`, When it changes from 3 to 4, Then the preview updates on the next frame and the compile count does not increase.
- **AC-SGF-023.2** Given a graph that would need more than the per-backend uniform budget, When compiled, Then the compiler bakes the excess inline values as constants in node-ID order, and returns warning `SGF_UNIFORMS_BAKED` with the affected nodes. [NEEDS CLARIFICATION: uniform budget per backend for r186 WebGL2; proposal 200 vec4 slots per stage]

**REQ-SGF-024 [P1]** THE SYSTEM SHALL compute `structureHash` as a SHA-256 hex digest of the canonical serialization of: node IDs, node types, muted flags, edges, param IDs and types, group contents, and which inputs are inline vs connected. It SHALL exclude `pos`, `ui`, `collapsed`, `preview`, names, labels and all values.

- **AC-SGF-024.1** Given a document, When only a node position, a param default or an inline value changes, Then `structureHash` is unchanged.
- **AC-SGF-024.2** Given a document, When an edge is added or a node is muted, Then `structureHash` changes.

**REQ-SGF-025 [P1]** WHEN `structureHash` changes during editing THE SYSTEM SHALL recompile after a 150 ms debounce of the last structural edit. A compile plus material/pipeline rebuild of a 200-node graph SHALL take ≤ 300 ms on the reference machine.

- **AC-SGF-025.1** Given 5 structural edits 50 ms apart, When the last edit is made, Then exactly one compile runs, starting 150 ms (±20 ms) after it.
- **AC-SGF-025.2** Given the 200-node benchmark fixture `fixtures/graph-200.csgraph.json`, When compiled in Chromium on CI with 4× CPU throttling, Then compile + rebuild p95 over 20 runs is ≤ 300 ms.

**REQ-SGF-026 [P1]** IF compilation fails THEN THE SYSTEM SHALL keep rendering with the last successfully compiled program for that graph and SHALL return every error with `nodeId`, optional `socketId`, a `code` from the error registry and a human-readable `message`.

- **AC-SGF-026.1** Given a working graph, When the user introduces a cycle, Then the preview keeps showing the last good look and `CompileResult.errors` contains `SGF_CYCLE` entries with node IDs.
- **AC-SGF-026.2** Given an emitter that throws, When compiled, Then the error is `SGF_EMIT_FAILED` on that node, the stack trace is not in `message`, and other nodes report no errors.

### Groups (subgraphs)

**REQ-SGF-027 [P1]** THE SYSTEM SHALL store node groups in `groups`, each with a name, an interface (ordered input and output sockets with stable IDs and types), nodes, edges and params. Each group SHALL contain exactly one `group.input@1` and one `group.output@1` node, and SHALL be used through `group.instance@1` nodes that reference it by key.

- **AC-SGF-027.1** Given a group with interface input `width: float` and an instance node with an edge into `width`, When compiled, Then the group's internal `group.input@1.width` output carries that value.

**REQ-SGF-028 [P1]** THE SYSTEM SHALL compile groups by inlining (flattening) each instance with node IDs prefixed by the instance path (`<instanceId>/<innerId>`), and SHALL map errors inside groups back to the instance node and the inner node.

- **AC-SGF-028.1** Given a type error inside group `outline` used by instance `g1`, When compiled, Then the error has `nodeId: "g1"` and `innerPath: ["n3"]`.

**REQ-SGF-029 [P1]** IF a group directly or indirectly contains an instance of itself, or nesting is deeper than 8 levels THEN THE SYSTEM SHALL fail with `SGF_GROUP_RECURSION` or `SGF_LIMIT_EXCEEDED`.

- **AC-SGF-029.1** Given group A containing B containing A, When compiled, Then `SGF_GROUP_RECURSION` lists the path `A → B → A`.

**REQ-SGF-030 [P1]** THE SYSTEM SHALL ship the built-in pipeline stages as groups with an `origin` field (`"builtin:stage.outline@1"`, `"builtin:stage.palette@1"`, `"builtin:stage.dither@1"`, `"builtin:stage.alphaCutoff@1"`, `"builtin:stage.srgb@1"`, `"builtin:stage.toon@1"`, `"builtin:stage.rim@1"`), so the editor can reset a modified stage to its shipped version.

- **AC-SGF-030.1** Given the default post graph, When loaded, Then it contains groups whose `origin` values are the five post stages, chained in the order of REQ-PIX-025, and `resetGroup("outline")` restores the group byte-identical to the shipped one.

### Determinism and default graphs

**REQ-SGF-031 [P1]** THE SYSTEM SHALL produce identical compiled programs and identical export pixels for the same document, render settings, app version and backend (constitution P-04).

- **AC-SGF-031.1** Given the default project, When exported twice in fresh sessions on the same backend, Then the PNG pixel data is byte-identical.

**REQ-SGF-032 [P1]** WHILE compiling for export (`ctx.mode === "export"`) THE SYSTEM SHALL evaluate `input.time@1` as the constant `0` and SHALL return warning `SGF_TIME_IN_EXPORT` on each such node.

- **AC-SGF-032.1** Given a post graph that offsets UV by `sin(time)`, When exported twice 5 s apart, Then frames are byte-identical and the warning names the time node. [NEEDS CLARIFICATION: should export time be `frame / fps` of the clip instead of 0? Both are deterministic.]

**REQ-SGF-033 [P1]** THE SYSTEM SHALL ship `builtin:material-toon` and `builtin:post-default` graph documents that, with default params, render with 0 differing pixels against the M2 golden images, for every M2 golden fixture on both backends.

This is the same obligation as REQ-PIX-035. M2 stage functions keep the shape `(ctx, inputs, fields) => Record<outputId, node>` defined there (`StageEmitter`, the same argument order as `NodeEmitter.compile`), and each built-in `NodeEmitter.compile` wraps the matching stage function, passing the node's fields as typed `fields`. *(Amended 2026-10-09 (M2-01), A1; previously `(inputs, ctx) => node`.)*

- **AC-SGF-033.1** Given each M2 golden fixture (side, three-quarter, isometric at 32/64/128 px; 18 cases, REQ-PIX-028), When rendered with the graph-compiled pipeline on WebGPU and on `forceWebGL`, Then the pixel diff against the M2 golden for that backend is 0.

### Size limits, sharing and clipboard

**REQ-SGF-034 [P1]** IF a document exceeds 2,000 nodes in total (including groups), 8,000 edges, 256 params, 64 groups, nesting depth 8, 2 MB of JSON, 4,000 nodes after flattening, or 32 texture-sample nodes on the live path to the output THEN THE SYSTEM SHALL reject it with `SGF_LIMIT_EXCEEDED`, naming the limit and the value found. The flattened node count SHALL be computed BEFORE flattening, by memoized per-group multiplication of instance counts (a group's flattened size is its own node count plus, for each `group.instance@1` inside it, the referenced group's memoized flattened size), so no flattened graph is ever materialized for a rejected document. A texture-sample node is any node whose `NodeTypeSpec.samplesTexture` is `true`; the count is taken after dead-node removal (REQ-SGF-017 step 4) and counts each flattened instance. (Flattened-count and texture-sample limits added by security review 2026-10-08.)

- **AC-SGF-034.1** Given a 2.5 MB document, When loaded, Then it is rejected before full parsing finishes, with a message naming "2 MB".
- **AC-SGF-034.2** Given a 40 KB document with 8 nested groups, each containing 10 instances of the next level (10^8 flattened nodes), When loaded, Then it is rejected with `SGF_LIMIT_EXCEEDED` naming "4,000 flattened nodes" within 100 ms in Node, and heap growth during the check is < 10 MB.
- **AC-SGF-034.3** Given a document with 1,000 top-level nodes and one group of 20 nodes used by 160 instances (4,200 flattened nodes), When loaded, Then it is rejected with `SGF_LIMIT_EXCEEDED`; with 140 instances (3,800) it loads.
- **AC-SGF-034.4** Given a post graph with 33 `samplesTexture` nodes that all reach `output.post@1`, When compiled, Then compilation fails with `SGF_LIMIT_EXCEEDED` naming "32 texture samples"; Given 40 such nodes of which only 32 reach the output, Then it compiles.

**REQ-SGF-035 [P2]** WHEN the user shares a graph by URL THE SYSTEM SHALL encode the canonical JSON as `deflate-raw` (`CompressionStream`) then base64url, in the URL fragment `#g=<data>`, and SHALL refuse to create a link longer than 16,000 characters, offering file export instead. WHEN a `#g=` fragment is opened THE SYSTEM SHALL reject a fragment longer than 65,536 characters before decoding, SHALL decompress incrementally (streamed chunks, counting output bytes), and SHALL abort the stream with `SGF_LIMIT_EXCEEDED` as soon as the decompressed output exceeds 2 MB, without allocating a buffer for the full output. (Decoding limits added by security review 2026-10-08.)

- **AC-SGF-035.1** Given the default post graph, When shared and the link is opened in a new tab, Then the decoded document is byte-identical to the original's canonical JSON.
- **AC-SGF-035.2** Given a graph whose link would be 20,000 characters, When the user clicks Share link, Then no link is created and the message offers "Export .csgraph.json".
- **AC-SGF-035.3** Given a `#g=` fragment, When decoded, Then it goes through the same validation, limits and migrations as a file (REQ-SGF-002, -034, -006), and no network request is made (REQ-GEN-003).
- **AC-SGF-035.4** Given a `#g=` fragment longer than 65,536 characters, When the app opens it, Then it is rejected with `SGF_LIMIT_EXCEEDED` before base64url decoding or decompression starts.
- **AC-SGF-035.5** Given a 60 KB `#g=` fragment that inflates to 1 GB, When decoded, Then decompression is aborted as soon as the inflated output exceeds 2 MB, the result is `SGF_LIMIT_EXCEEDED`, and the tab's JS heap grows by < 50 MB during decoding.
**REQ-SGF-036 [P1]** THE SYSTEM SHALL use the clipboard payload format `sprite-shadergraph-clip` (version 1), which contains the selected nodes, the edges between them, the params they reference and the groups they instantiate, as JSON text.

- **AC-SGF-036.1** Given 3 selected nodes with 2 internal edges and 1 edge to an unselected node, When copied, Then the payload has 3 nodes, 2 edges and validates against the clip schema.
- **AC-SGF-036.2** Given a pasted payload whose node IDs or group keys collide with the target document, When pasted, Then new IDs are assigned and all internal edges are rewired to them.

### Previews and extension

**REQ-SGF-037 [P1]** WHEN a node preview is requested THE SYSTEM SHALL compile the upstream subgraph of that node's first previewable output, using a preview adapter for its type (`float` → grayscale, `vec2` → RG, `vec3`/`color` → RGB, `vec4` → RGB over a checkerboard), and render it through `CharacterRenderer.renderNodePreview` at 64×64 px.

- **AC-SGF-037.1** Given a `math.multiply@1` node with float output 0.5, When its preview is rendered, Then every pixel of the 64×64 bitmap is gray (128 ± 1).

**REQ-SGF-038 [P1]** THE SYSTEM SHALL export a JSON Schema for the document and clip formats (`tools/` script, generated from Zod) into `packages/shader-graph/schema/`, and CI SHALL fail if the committed schema is stale.

- **AC-SGF-038.1** Given a Zod schema change without regenerating, When CI runs, Then the schema-drift check fails and names the file.

**REQ-SGF-039 [P3]** WHERE third-party node registration is enabled THE SYSTEM SHALL accept node types through `registerNodeType(spec, emitter)` only if the type ID uses a namespace that is not reserved (`core.*`, `math.*`, `vector.*`, `color.*`, `toon.*`, `post.*`, `input.*`, `output.*`, `group.*`, `util.*`, `param.*` are reserved) and its spec passes schema validation.

- **AC-SGF-039.1** Given `registerNodeType` with type `math.foo@1`, When called, Then it throws `SGF_RESERVED_NAMESPACE`; with `acme.foo@1` it succeeds and the node appears in the registry.

**REQ-SGF-040 [P1]** THE SYSTEM SHALL keep built-in and plugin node types side-effect free during compile: emitters receive only the context and input nodes, and SHALL NOT read time, randomness or global state.

- **AC-SGF-040.1** A lint rule (`no-restricted-globals`/`no-restricted-properties` for `Date`, `performance`, `Math.random`) runs on `packages/shader-graph/src/tsl/**` and fails on a violation.

### Render settings binding

**REQ-SGF-041 [P1]** THE SYSTEM SHALL bind the typed `RenderSettings` fields of spec 003 to graphs only through the reserved param IDs in *Reserved built-in param IDs*, and IF a document declares a `GraphParam` whose ID is reserved but whose binding kind is not `uniform`, or whose `type` differs from the table, THEN THE SYSTEM SHALL report `SGF_RESERVED_PARAM` on that param at validation.

- **AC-SGF-041.1** Given a post graph that declares param `dither.strength` with `type: "int"`, When validated, Then `SGF_RESERVED_PARAM` names `dither.strength` and the expected type `float`.
- **AC-SGF-041.2** Given the built-in post graph, When `RenderSettings.palette.dither.strength` changes from 0.5 to 0.8, Then the uniform keyed `dither.strength` has value 0.8 on the next frame, the compiler is not invoked, and `RenderSettings.params` has no `dither.strength` key.
- **AC-SGF-041.3** Given a user post graph that does not declare `outline.outer.widthPx`, When the Render tab is shown, Then the outline width control is labelled "controlled by graph" (spec 003, Binding to graphs). *(Note 2026-10-09 (QA-E): not testable in M2; verification lands in M4, when user post graphs exist alongside the Render tab UI. Meaning unchanged.)*
- **AC-SGF-041.4** Given the built-in post graph and default RenderSettings, When compiled, Then the `post.outline@1` node has field `mode` `black` and field `innerMode` `darken`; When `RenderSettings.outline.inner.colorMode` changes to `black`, Then the graph is recompiled (a `field` binding, spec 003 REQ-PIX-034 note) with `innerMode` `black`, `mode` stays `black`, and `RenderSettings.params` has no `outline.inner.colorMode` key; and Given a document that declares a `GraphParam` with ID `outline.inner.colorMode`, When validated, Then `SGF_RESERVED_PARAM` names it (its binding kind is `field`, not `uniform`). *(Added 2026-10-09 (FX-J-spec2).)* *(Note 2026-10-09 (QA-E): not testable in M2; verification lands in M4 with the graph compiler (graph recompile on a `field` binding) and document validation (`SGF_RESERVED_PARAM`). Meaning unchanged.)*

### Emitter input hardening

**REQ-SGF-042 [P1]** THE SYSTEM SHALL treat every document value that reaches an emitter as untrusted: (a) every value that affects a loop count, kernel size, sample count or texture-sample count SHALL be clamped to the `min`/`max` declared for that socket in the node registry (`NodeTypeSpec`), never to bounds from the document (`GraphParam.min`/`max` are UI hints only); (b) an enum-valued input SHALL be accepted only if it is one of the `values` declared for that socket in the registry, otherwise the socket default is used and warning `SGF_VALUE_CLAMPED` is reported; (c) document strings and IDs (node IDs, param IDs, group keys, `name`, `label`, `description`) SHALL never be interpolated into shader source or used as TSL node names, varying names, uniform names or labels; emitters derive identifiers from a counter or a hash. (security review 2026-10-08)

- **AC-SGF-042.1** Given a `post.outline@1` node whose inline `outer` width is 10,000 and a document param declaring `max: 10000`, When compiled, Then the emitted loop/kernel uses the registry maximum for `outer`, and warning `SGF_VALUE_CLAMPED` names the node and socket.
- **AC-SGF-042.2** Given a `post.outline@1` node whose enum field `mode` is `"black\"; }) evil("` (not in the registry `values`), When compiled, Then the field default is used and `SGF_VALUE_CLAMPED` is reported.
- **AC-SGF-042.3** Given a document whose node IDs, labels, param names and group names contain `*/`, `"`, `;`, `}` and newline characters, When compiled on both backends, Then compilation succeeds, and none of those strings appears as a substring of the generated WGSL or GLSL source (checked by a test that dumps the generated shader source).
- **AC-SGF-042.4** A registry test fails if any socket that a `NodeEmitter` uses as a loop or sample bound has no registry `min` and `max`, or if any enum socket has no `values`.

### Built-in values contract

**REQ-SGF-043 [P1]** THE SYSTEM SHALL implement in `CompileContext.builtin()` every name in the *Built-in values* table with the type, space and unit given there, and SHALL return the same TSL node for repeated calls with the same name within one compile. *(Added 2026-10-09 (M2-01), amendment A4: `render.paletteDarkest`, `render.paletteEnabled` and the `screenPos` definition. The M2 stage context implements the same table.)*

- **AC-SGF-043.1** Given the engine's `CompileContext` with palette `endesga-32`, When `builtin('render.paletteDarkest')` is evaluated, Then it is the linear RGBA of #181425 with alpha 1; with palette `none` it is (0, 0, 0, 1); and `builtin('render.paletteEnabled')` is `true` and `false` respectively. Changing the palette from `endesga-32` to `pico-8` updates `render.paletteDarkest` to #000000 without recompiling (a `none` ↔ preset change may rebuild, spec 003 REQ-PIX-034).
- **AC-SGF-043.2** Given a post pass at 48×40 whose output writes `builtin('screenPos')` into the red and green channels as integers, When read back (top-left origin, spec 003 REQ-PIX-029), Then pixel (x, y) holds (x, y) for every pixel, on both backends.
- **AC-SGF-043.3** Given the node registry (M4), Then `post.edgeDetect@1` has output `source: color`, `post.outline@1` has inputs `source: color` and `black: color` with `defaultBuiltin: 'render.paletteDarkest'`, and `post.paletteQuantize@1` has input `enabled: bool` with `defaultBuiltin: 'render.paletteEnabled'` (spec 006 catalog).
- **AC-SGF-043.4** Given `builtin('unknown.name')`, When called during emit, Then it throws, and the compiler reports `SGF_EMIT_FAILED` on the calling node.
- **AC-SGF-043.5** Given the engine's post `CompileContext`, When `builtin('light.dir')` is evaluated, Then it equals the material-target value for the same settings (spec 003 AC-PIX-013.3: (-0.5, 0.5, 0.70711) ± 1e-5 for the default light); and Given a material that writes `light_k = 0.575` (3 bands, ambient 0.15, `k = 1`) and a material with `output.material.light` unconnected, When a post pass writes `builtin('scene.light')` to its red channel and it is read back, Then the pixels read 0.575 and 1.0 respectively (± 1/255). *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-SGF-043.6** Given the node registry (M4), Then `post.rimEdge@1` has inputs `color: color`, `coverage: float`, `cutoff: float` (`defaultBuiltin: 'render.alphaCutoff'`), `lightDir: vec3` (`defaultBuiltin: 'light.dir'`), `light: float` (`defaultBuiltin: 'scene.light'`), `strength: float` and `enabled: bool`, and outputs `color: color` and `rim: float`; and `output.material@1` has input `light: float` with default 1 (spec 006 catalog). *(Added 2026-10-09 (FX-J, user D2).)*

## Type system

| Type | TSL shape | Default | Notes |
|------|-----------|---------|-------|
| `float` | `float` | `0` | |
| `int` | `int` | `0` | |
| `bool` | `bool` | `false` | |
| `vec2` | `vec2` | `[0,0]` | |
| `vec3` | `vec3` | `[0,0,0]` | directions, normals |
| `vec4` | `vec4` | `[0,0,0,0]` | |
| `color` | `vec4` (linear RGBA) | `#000000ff` | Stored as hex sRGB in JSON (`#rrggbb` or `#rrggbbaa`). The compiler converts it to linear. |
| `texture` | texture node | none | Not inline-editable. Built-ins only in v1 (palette LUT, part albedo). |
| `genType` | resolves to `float`/`vec2`/`vec3`/`vec4` | `0` | REQ-SGF-013 |

### Implicit cast table (row = from, column = to)

`✓` allowed, `~` allowed-lossy (the editor shows a lossy marker on the wire, see spec 006), `✗` rejected.

| from \ to | float | int | bool | vec2 | vec3 | vec4 | color | texture |
|-----------|-------|-----|------|------|------|------|-------|---------|
| float | ✓ | ✗ | ✗ | ✓ splat | ✓ splat | ✓ splat | ✓ gray, a=1 | ✗ |
| int | ✓ | ✓ | ✗ | ✓ splat | ✓ splat | ✓ splat | ✗ | ✗ |
| bool | ✓ 0/1 | ✓ 0/1 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| vec2 | ✗ | ✗ | ✗ | ✓ | ✓ z=0 | ✓ z=0,w=1 | ✗ | ✗ |
| vec3 | ✗ | ✗ | ✗ | ~ xy | ✓ | ✓ w=1 | ✓ a=1 | ✗ |
| vec4 | ✗ | ✗ | ✗ | ~ xy | ~ xyz | ✓ | ✓ | ✗ |
| color | ✗ | ✗ | ✗ | ✗ | ~ rgb | ✓ | ✓ | ✗ |
| texture | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

Vector → scalar is always rejected. Users pick a component with `vector.split@1`. `util.reroute@1` is special-cased: its `in`/`out` sockets have pseudo-type `any` and take the concrete type of the source wired into `in` (an unconnected reroute is `float`). A reroute never inserts a cast; the cast happens at the reroute's targets. `genType` inputs accept anything whose resolved type casts to the resolved width.

## Built-in values

Names accepted by `CompileContext.builtin()` (REQ-SGF-043). Added 2026-10-09 (M2-01); before that the names were listed only in the `CompileContext` comment. View space: x screen-right, y screen-up, z toward the viewer. Cell pixel coordinates: origin top-left, x right, y down.

| Name | Target | Type | Value |
|------|--------|------|-------|
| `uv` | M P | `vec2` | Mesh UV (M); `(screenPos + 0.5) / resolution` (P) |
| `normal` | M | `vec3` | View-space unit normal |
| `viewDir` | M | `vec3` | Surface → camera, view space; `(0, 0, 1)` for the orthographic camera |
| `light.dir` | ~~M~~ M P | `vec3` | Surface → key light, view space, from `light.azimuthDeg`/`light.elevationDeg` (spec 003 REQ-PIX-013 note). *(Amended 2026-10-09 (FX-J, user D2): also available in post graphs, for `post.rimEdge@1.lightDir`; the light is directional, so the value is the same for every pixel.)* |
| `partId` | M | `int` | Part ID of the drawn mesh (spec 003 REQ-PIX-014) |
| `tint.<slot>` | M | `color` | Tint uniform of that slot (linear) |
| `part.albedo` | M | `color` | Part base texture × vertex color (linear), sampled per spec 003 REQ-PIX-038. *(Note 2026-10-09 (M2-01b): in M2 vertex colors are not applied, so the value is the base texture alone (A = texel alpha); applying vertex colors is deferred to M3.)* |
| `screenPos` | M P | `vec2` | Integer cell pixel index `(x, y)`, top-left origin, 0..W−1 / 0..H−1 (amendment A4; not the pixel center) |
| `resolution` | M P | `vec2` | Cell size `(W, H)` in px |
| `texelSize` | M P | `vec2` | `1 / resolution` |
| `time` | M P | `float` | Seconds in preview; `0` in export (REQ-SGF-032) |
| `scene.color` | P | `color` | Scene pass color, linear RGB, A = material alpha |
| `scene.normal` | P | `vec3` | Scene pass view-space normal |
| `scene.depth` | P | `float` | Signed distance from the pivot plane in output px, + toward the camera (spec 003 REQ-PIX-014 note) |
| `scene.partId` | P | `int` | Scene pass part ID, 0 = background |
| `scene.light` | P | `float` | Scene pass band brightness `light_k` (spec 003 REQ-PIX-011), 0..1, as written by `output.material.light` (1 when unconnected); 0 on background pixels. *(Added 2026-10-09 (FX-J, user D2), for `post.rimEdge@1`.)* |
| `render.paletteLut` | P | `texture` | Palette LUT (spec 003 REQ-PIX-021 note) |
| `render.paletteEnabled` | P | `bool` | `true` unless the palette is `none` (amendment A4) |
| `render.paletteDarkest` | P | `color` | Linear RGBA (A = 1) of the palette entry with the lowest OKLab lightness, ties lowest index; #000000 when the palette is `none` (amendment A4, spec 003 REQ-PIX-017 note) |
| `render.ditherMode` | P | field default | `palette.dither.mode` (`none`/`bayer2`/`bayer4`/`bayer8`), read at compile time as the default of `post.bayerDither@1` field `matrix`; not a shader value |
| `render.ditherStrength` | P | `float` | The `dither.strength` uniform (rule 3 below) |
| `render.alphaCutoff` | P | `float` | The `alpha.cutoff` uniform (rule 3 below) |

## Reserved built-in param IDs

This is the single mapping between the typed `RenderSettings` fields (spec 003, Data & contracts) and graph params. Spec 003 and spec 006 reference this table and do not repeat it.

Binding kinds:

- `uniform`: a `GraphParam` with this ID and type, compiled to one `uniform()` keyed by the ID (REQ-SGF-022). Changing the value never recompiles.
- `field`: a node field of the built-in graphs, written by the editor. Changing it recompiles (spec 003 REQ-PIX-034 allows a rebuild ≤ 300 ms). It is not a `GraphParam`.
- `builtin`: supplied by the engine through `CompileContext.builtin()`. It is not a `GraphParam`.

| `RenderSettings` field (spec 003) | Reserved ID | Kind | Type / range | Built-in graph socket or builtin |
|------|------|------|------|------|
| `toon.bands` | `toon.bands` | uniform | `int` 2–4 | `toon.ramp@1.steps` |
| `toon.thresholds` | `toon.thresholds` | uniform | `vec3` (t1, t2, t3; components ≥ `bands - 1` ignored) | `toon.ramp@1.t1..t3` via `vector.split@1` |
| `toon.rim.enabled` | `rim.enabled` | uniform | `bool` | ~~gates `toon.rim@1.rim` (`math.select@1`)~~ `post.rimEdge@1.enabled` (amended 2026-10-09 (FX-J, user D2)) |
| `toon.rim.strength` | `rim.strength` | uniform | `float` 0–1 | ~~`toon.rim@1.strength`~~ `post.rimEdge@1.strength` (amended 2026-10-09 (FX-J, user D2)) |
| `toon.rim.width` | `rim.width` | ~~uniform~~ deprecated | `float` 0–1 | ~~`toon.rim@1.width`~~ **Deprecated 2026-10-09 (FX-J, user D2):** superseded by the screen-space rim of spec 003 REQ-PIX-012, which has no width. The built-in graphs do not bind it. The ID stays reserved, so no user param can take it. A saved `toon.rim.width` value is still accepted (0–1) and ignored. User graphs that use the legacy `toon.rim@1` set its `width` socket inline or through a user param. *(Clarified 2026-10-09 (FX-J-spec2).)* The engine's settings binder still supplies a `rim.width` uniform for legacy graphs that read it with `param.get@1`: the saved value, or 0.25 when absent. RenderSettings validation never fills in a default. |
| `lighting.azimuthDeg` | `light.azimuthDeg` | uniform | `float` 0–360 | engine derives builtin `light.dir` |
| `lighting.elevationDeg` | `light.elevationDeg` | uniform | `float` 0–90 | engine derives builtin `light.dir` |
| `lighting.ambient` | `light.ambient` | uniform | `float` 0–1 | `toon.ramp@1.ambient` |
| `outline.outer.enabled` | `outline.outer.enabled` | uniform | `bool` | gates `post.edgeDetect@1.outer` |
| `outline.outer.widthPx` | `outline.outer.widthPx` | uniform | `int` 1–3 | `post.edgeDetect@1.width` |
| `outline.inner.enabled` | `outline.inner.enabled` | uniform | `bool` | gates `post.edgeDetect@1.inner` |
| `outline.inner.partId` / `.depth` / `.normal` | `outline.inner.sources` | field | set of `id`, `depth`, `normal` | `post.edgeDetect@1` field `sources` |
| `outline.inner.depthThresholdPx` | `outline.inner.depthThresholdPx` | uniform | `float` > 0 | `post.edgeDetect@1.depthThresholdPx` |
| `outline.inner.normalThresholdDeg` | `outline.inner.normalThresholdDeg` | uniform | `float` 1–179 | `post.edgeDetect@1.normalThresholdDeg` |
| `outline.colorMode` | `outline.colorMode` | field | `black` / `darken` / `custom` | `post.outline@1` field `mode` (outer outline only since 2026-10-09 (FX-J-spec2), spec 003 REQ-PIX-017 note) |
| `outline.inner.colorMode` | `outline.inner.colorMode` | field | `black` / `darken` / `custom` | `post.outline@1` field `innerMode` (added 2026-10-09 (FX-J-spec2); spec 003 default `darken`) |
| `outline.darkenAmount` | `outline.darkenAmount` | uniform | `float` 0–1 | `post.outline@1.darkenAmount` |
| `outline.color` | `outline.color` | uniform | `color` | `post.outline@1.customColor` |
| `palette.id`, `palette.colors`, `palette.metric` | `palette.id`, `palette.colors`, `palette.metric` | builtin | LUT texture (REQ-PIX-021); darkest color; enabled flag | `render.paletteLut` → `post.paletteQuantize@1.lut`; `render.paletteEnabled` → `post.paletteQuantize@1.enabled`; `render.paletteDarkest` → `post.outline@1.black` (last two added 2026-10-09 (M2-01), A4) |
| `palette.dither.mode` | `dither.mode` | builtin | `none` / `bayer2` / `bayer4` / `bayer8` | `render.ditherMode` → `post.bayerDither@1` field `matrix` default |
| `palette.dither.strength` | `dither.strength` | uniform | `float` 0–1 | `post.bayerDither@1.strength`; builtin `render.ditherStrength` returns this uniform |
| `alphaCutoff` | `alpha.cutoff` | uniform | `float` 0.01–1 | `post.alphaCutoff@1.cutoff`, `post.edgeDetect@1.cutoff`; builtin `render.alphaCutoff` returns this uniform |

Rules:

1. Every reserved ID contains a `.`. User-declared param IDs match `[A-Za-z][A-Za-z0-9_-]{0,63}` (no `.`), so they never collide with reserved IDs. Reserved param IDs are separate from the reserved node-type namespaces of REQ-SGF-039.
2. Values of reserved IDs are stored in the typed `RenderSettings` field, never in `RenderSettings.params`. `RenderSettings.params` holds only user-declared param IDs (spec 006 REQ-EDT-033).
3. The builtins `render.ditherStrength` and `render.alphaCutoff` return the same uniform node as the matching reserved param, so a socket that defaults to the builtin and a `param.get@1` of the reserved param always read the same value.
4. Inline input uniforms are keyed `node:<nodeId>.<socketId>`, so they never collide with param keys.
5. Node socket defaults in the spec 006 catalog are the node's own standalone defaults. The built-in graphs wire these sockets to the reserved params, whose defaults are the spec 003 defaults.

*(Note 2026-10-09 (M2-01b), informational.)* three r186 on WebGL2 fails to compile a TSL `select` whose branch contains a texture fetch. The M2 stages gate with an exact 0/1 blend (`pick`) instead (spec 003, Notes for implementers). The M4 emitter of `math.select@1`, which gates ~~`rim.enabled` and~~ the outline booleans above (`rim.enabled` is an input of `post.rimEdge@1` since 2026-10-09 (FX-J, user D2)), must give the same result on WebGL2, for example by emitting the same blend when a branch samples a texture.

## Error registry

| Code | Severity | Raised by |
|------|----------|-----------|
| `SGF_SCHEMA_INVALID` | error | load |
| `SGF_VERSION_UNSUPPORTED` | error | load |
| `SGF_MIGRATION_FAILED` | error | load |
| `SGF_LIMIT_EXCEEDED` | error | load, compile |
| `SGF_DUPLICATE_ID`, `SGF_DANGLING_EDGE`, `SGF_INPUT_MULTIPLE` | error | validate |
| `SGF_UNKNOWN_NODE_TYPE`, `SGF_TARGET_MISMATCH` | error | compile |
| `SGF_MISSING_OUTPUT`, `SGF_MULTIPLE_OUTPUTS` | error | compile |
| `SGF_CYCLE`, `SGF_GROUP_RECURSION` | error | compile |
| `SGF_TYPE_MISMATCH` | error | typecheck |
| `SGF_PARAM_UNKNOWN` | error | compile (a `param.get@1` references a missing param) |
| `SGF_EMIT_FAILED` | error | emit |
| `SGF_UNUSED_NODE`, `SGF_UNIFORMS_BAKED`, `SGF_TIME_IN_EXPORT`, `SGF_LOSSY_CAST` | warning | compile |
| `SGF_VALUE_CLAMPED` | warning | compile (REQ-SGF-042) |
| `SGF_RESERVED_NAMESPACE` | error | plugin registration |
| `SGF_RESERVED_PARAM` | error | validate (REQ-SGF-041) |

## Edge cases

- Empty document (no nodes) → `SGF_MISSING_OUTPUT` (REQ-SGF-020). The engine keeps the last good or default program (REQ-SGF-026).
- Unknown node type from a plugin that is not loaded → preserved, error (REQ-SGF-015).
- Unknown fields from a newer minor tool → preserved (REQ-SGF-002).
- Edge to a socket that a type migration removed → the migration must rewrite or drop it and report `SGF_MIGRATION_FAILED` if it cannot (REQ-SGF-007, -009).
- Muted output node → treated as unmuted; mute does not apply to output nodes (REQ-SGF-021). [NEEDS CLARIFICATION: confirm or show "output cannot be muted" in the UI]
- Param removed while a `param.get@1` still references it → `SGF_PARAM_UNKNOWN` on that node.
- Cycle through a group boundary → detected after flattening (REQ-SGF-017 step 2 before 5).
- Huge pasted payload → same limits as documents (REQ-SGF-034).
- Small document whose nested group instances multiply to millions of nodes → rejected before flattening (REQ-SGF-034, AC-SGF-034.2).
- Compression-bomb `#g=` link → aborted at 2 MB of output (REQ-SGF-035, AC-SGF-035.5).
- Node IDs, labels or enum values crafted to look like shader code → never reach shader source (REQ-SGF-042).
- WebGL2 fallback → every built-in emitter must compile on `forceWebGL` (AC-SGF-033.1). A WebGPU-only node must declare `backends: ['webgpu']`, and on WebGL2 it reports `SGF_EMIT_FAILED` with a clear message (ADR-0003).
- Two parts using the same material graph → compiled once per `structureHash` and shared (architecture §2.1).

## Data & contracts

Refines docs/architecture.md §3.5. Changes against §3.5: added `name`, group `name`/`interface`/`origin`, `GraphFrame`, `genType`, `NodeEmitter`, extended `CompileContext`, `innerPath`/`severity` on errors. The architecture doc must be updated in the same PR (architecture rule: spec wins for behavior).

```ts
/** Concrete socket types. */
export type SocketType =
  | 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'texture';
/** Socket type as declared by a node type; genType resolves per instance. */
export type SocketTypeRef = SocketType | 'genType';
/** `namespace.name@version`, e.g. 'toon.ramp@1'. */
export type NodeTypeId = `${string}@${number}`;

export interface GraphNode {
  id: string;                      // [A-Za-z0-9_-]{1,64}, unique in its scope
  type: NodeTypeId;
  pos: [number, number];
  inputs: Record<string, unknown>; // inline values by socket id
  label?: string;
  collapsed?: boolean;
  muted?: boolean;
  preview?: boolean;
  hideUnused?: boolean;
  group?: string;                  // group.instance@1 only
  param?: string;                  // param.get@1 only
  [unknownField: string]: unknown;
}

export interface GraphEdge {
  from: [nodeId: string, socketId: string];
  to: [nodeId: string, socketId: string];
  [unknownField: string]: unknown;
}

export interface GraphParam {
  id: string;                      // stable; user ids [A-Za-z][A-Za-z0-9_-]{0,63} (in RenderSettings.params), or a reserved id (Reserved built-in param IDs)
  name: string;
  type: Exclude<SocketType, 'texture'>;
  default: unknown;
  min?: number; max?: number; step?: number;
  group?: string;                  // blackboard section
  description?: string;
  /** Shown in the simplified Look panel (spec 006, REQ-EDT-034). */
  exposeInLook?: boolean;
}

export interface GroupSocket { id: string; name: string; type: SocketTypeRef; default?: unknown }

export interface GraphGroup {
  name: string;
  interface: { inputs: GroupSocket[]; outputs: GroupSocket[] };
  nodes: GraphNode[];
  edges: GraphEdge[];
  params: GraphParam[];
  /** Shipped stage this group came from; enables "reset to default". */
  origin?: `builtin:${string}`;
}

export interface GraphFrame {
  id: string; label: string; color?: string;
  rect: [x: number, y: number, w: number, h: number];
  nodeIds: string[];
}

export interface ShaderGraphDocument {
  format: 'sprite-shadergraph';
  version: 1;
  target: 'material' | 'post';
  name?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  params: GraphParam[];
  groups: Record<string, GraphGroup>;
  /** UI-only; ignored by compiler and structureHash. */
  ui: {
    viewport?: { x: number; y: number; zoom: number };
    frames?: GraphFrame[];
    blackboardOrder?: string[];
  };
  [unknownField: string]: unknown;
}

export interface ShaderGraphClip {
  format: 'sprite-shadergraph-clip';
  version: 1;
  target: 'material' | 'post';
  nodes: GraphNode[];
  edges: GraphEdge[];
  params: GraphParam[];
  groups: Record<string, GraphGroup>;
}

/** Pure metadata (root entry; no three). */
export interface NodeTypeSpec {
  type: NodeTypeId;
  label: string;
  category: 'input' | 'math' | 'vector' | 'color' | 'toon' | 'post' | 'utility' | 'output' | 'group' | string;
  description: string;
  targets: Array<'material' | 'post'>;
  inputs: Array<{
    id: string; label: string; type: SocketTypeRef;
    /** Registry bounds; authoritative for clamping (REQ-SGF-042). Required on loop/sample-bound sockets. */
    default?: unknown; min?: number; max?: number;
    /** Allowed values for enum sockets (REQ-SGF-042). */
    values?: readonly string[];
    /** Built-in that feeds this socket when unconnected, e.g. 'uv'. */
    defaultBuiltin?: string;
    /** Not inline-editable (e.g. textures). */
    connectOnly?: boolean;
  }>;
  outputs: Array<{ id: string; label: string; type: SocketTypeRef; previewable?: boolean }>;
  backends?: Array<'webgpu' | 'webgl2'>;   // default: both
  /** True if the emitter samples a texture; counted against the 32-sample limit (REQ-SGF-034). */
  samplesTexture?: boolean;
  /** Migration from the previous version of this type (type@N-1 → type@N). */
  migrateFrom?: (old: GraphNode) => GraphNode;
}

/** TSL side (`@csg/shader-graph/tsl`). TslNode is three's TSL node type. */
export interface NodeEmitter {
  type: NodeTypeId;
  /** Pure: same inputs ⇒ same TSL graph. Inputs are already cast to the declared/resolved types. */
  compile(
    ctx: CompileContext,
    inputs: Readonly<Record<string, TslNode>>,
    node: Readonly<GraphNode>,
  ): Record<string, TslNode>;
}

/** Implemented by @csg/engine. */
export interface CompileContext {
  target: 'material' | 'post';
  mode: 'preview' | 'export' | 'node-preview';
  backend: 'webgpu' | 'webgl2';
  /** Names, types and units: section "Built-in values" (REQ-SGF-043). 'uv','normal','viewDir','light.dir',
   *  'partId','screenPos','texelSize','time','tint.<slot>','part.albedo','scene.color','scene.normal',
   *  'scene.depth','scene.partId','scene.light' (added 2026-10-09, FX-J),'resolution','render.paletteLut','render.paletteEnabled',
   *  'render.paletteDarkest','render.ditherMode','render.ditherStrength','render.alphaCutoff'.
   *  Unknown name ⇒ throws (→ SGF_EMIT_FAILED). */
  builtin(name: string): TslNode;
  /** Creates or reuses a uniform keyed by a stable id: a param id (user or reserved, see Reserved built-in param IDs) or `node:${nodeId}.${socketId}` for inline values. */
  uniform(key: string, type: SocketType, initial: unknown): TslNode;
}

export interface CompileError {
  nodeId?: string;
  innerPath?: string[];            // path inside groups
  socketId?: string;
  severity: 'error' | 'warning';
  code: string;                    // from the error registry
  message: string;
}

export interface CompileResult {
  ok: boolean;
  output?: unknown;                // opaque TSL node(s)
  uniforms: Record<string, { value: unknown }>;
  errors: CompileError[];
  structureHash: string;
}

/** Root entry API. */
export function parseGraph(json: unknown): Result<ShaderGraphDocument, CompileError[]>;
export function serializeGraph(doc: ShaderGraphDocument): string;            // canonical
export function canConnect(from: SocketType, to: SocketType): 'ok' | 'lossy' | 'rejected';
export function encodeGraphUrl(doc: ShaderGraphDocument): Promise<string>;  // '#g=…'
export function decodeGraphUrl(fragment: string): Promise<Result<ShaderGraphDocument, CompileError[]>>;
/** /tsl entry. */
export function compileGraph(doc: ShaderGraphDocument, ctx: CompileContext): CompileResult;
export function registerNodeType(spec: NodeTypeSpec, emitter: NodeEmitter): void; // P3 for third parties
```

File: `<name>.csgraph.json`, media type `application/vnd.csg.shadergraph+json`. Within a `ProjectDocument`, graphs are embedded in `graphs` (architecture §3.3).

Minimal example:

```json
{
  "format": "sprite-shadergraph",
  "version": 1,
  "target": "post",
  "name": "GameBoy 4-color",
  "nodes": [
    { "id": "c", "type": "post.sampleColor@1", "pos": [0, 0], "inputs": {} },
    { "id": "q", "type": "post.paletteQuantize@1", "pos": [240, 0], "inputs": {} },
    { "id": "o", "type": "output.post@1", "pos": [480, 0], "inputs": {} }
  ],
  "edges": [
    { "from": ["c", "color"], "to": ["q", "color"] },
    { "from": ["q", "color"], "to": ["o", "color"] }
  ],
  "params": [{ "id": "dither.strength", "name": "Dither", "type": "float", "default": 0.5, "min": 0, "max": 1, "exposeInLook": true }],
  "groups": {},
  "ui": { "viewport": { "x": 0, "y": 0, "zoom": 1 } }
}
```

## Non-functional

- NFR-1 Performance: param/inline change applies on the next frame with 0 recompiles (REQ-SGF-022, -023). Structural recompile ≤ 300 ms at 200 nodes (REQ-SGF-025). Parse + validate + migrate of a 1 MB document ≤ 100 ms in Node.
- NFR-2 Determinism: constitution P-04. Canonical serialization (REQ-SGF-005), sorted topo order (REQ-SGF-019), no time/random in emitters (REQ-SGF-040).
- NFR-3 Security: graph files and `#g=` links are untrusted input. They go through Zod only, never `eval`/`Function`, with size limits applied before deep parsing and before flattening (REQ-SGF-034), and share-link decoding capped before and during decompression (REQ-SGF-035). Node code is never loaded from documents (NG1, NG4), and document values reach shaders only as registry-clamped values, never as source text (REQ-SGF-042). Spec 000 GEN rules for persisted and imported data apply.
- NFR-4 Portability: the root entry runs in Node 22 with no DOM (constitution P-10). A Vitest suite loads, migrates and validates every fixture in Node.
- NFR-5 Compatibility: every released document version keeps a fixture in `packages/shader-graph/test/fixtures/v<N>/`, which must load in all later versions.

## Open questions

- [NEEDS CLARIFICATION: Export semantics of `input.time@1`: constant 0 (current spec) or `frame / fps`? Owner: product + graphics-engineer. Blocks AC-SGF-032.1 only.]
- [NEEDS CLARIFICATION: WebGL2 uniform budget per stage for r186 TSL, which sets the baking threshold in AC-SGF-023.2. Owner: graphics-engineer, measured in M4 spike.]
- ~~Custom function node (P3): user-authored `wgslFn`/`glslFn` strings or built-in functions only?~~ Resolved by security review 2026-10-08: built-in functions only. A custom function node references a function registered in code by ID; a document that carries shader source strings is not supported (NG1, NG4, REQ-SGF-042).
- [NEEDS CLARIFICATION: Per-slot material graph overrides need a `RenderSettings` field (proposal: `materialGraphOverrides?: Partial<Record<SlotId, string>>`). Owner: spec 003 author + architect. Blocks REQ-EDT-002.]
- ~~Builtin names `render.*` must match the RenderSettings → uniform binding defined in spec 003.~~ Resolved 2026-10-08: the *Reserved built-in param IDs* table in this spec is the single mapping, referenced from spec 003 and spec 006.
- [NEEDS CLARIFICATION: Can output nodes be muted? Owner: editor-ux-engineer.]

## References

- ADR-0003 WebGPURenderer, TSL and RenderPipeline on pinned three r186; ADR-0004 React Flow, own graph model.
- docs/architecture.md §1.2 rule 3, §3.5, §4.1, §4.5.
- `.tagconn/work/research.md` §Shader graph editor (2026-10-08).
- `.tagconn/work/m2-plan.md` §2.4 and §5, amendments A1/A4 (2026-10-09).
- three.js Shading Language wiki: https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language (accessed 2026-10-08).
- Unity Shader Graph, Data types and implicit conversion: https://docs.unity3d.com/Packages/com.unity.shadergraph@17.0/manual/Data-Types.html (accessed 2026-10-08).
- Blender Manual, Node groups: https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html (accessed 2026-10-08).
- MDN, CompressionStream: https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream (accessed 2026-10-08).
- Zod, passthrough/loose objects: https://zod.dev (accessed 2026-10-08).
