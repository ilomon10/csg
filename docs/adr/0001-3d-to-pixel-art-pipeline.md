# 0001. 3D modular models rendered through a pixel-art shader pipeline

- Status: Accepted
- Date: 2026-10-08
- Deciders: project owner, architect
- Related: specs 001 (composer), 002 (anatomy), 003 (pixel pipeline), 004 (animation); ADR-0003

## Context

The product generates game-ready character sprite sheets from mix-and-match parts. Users need many
combinations, several animations, 1/2/4/8 directions, side-view and top-down/3/4/isometric cameras,
and resolutions from 32 to 128 px. Each extra axis multiplies the art needed in a 2D workflow.

High-quality CC0 3D sources exist: Quaternius Universal Base Characters (6 bodies, 20 hairstyles),
Modular Character Outfits - Fantasy (62 parts), and the Universal Animation Library (120+ clips).
A third-party source claims they share one 65-joint UE5-style skeleton with identical bind poses.
**This is unverified.**

## Decision

Characters are composed from rigged 3D parts and rendered in the browser through a pixel-art shader
pipeline: low-res integer render target, toon ramp + rim light, outlines from depth/normal/part-ID
edges, palette quantization (LUT) with optional Bayer dither, and hard alpha cutoff. Camera and
model translation snap to texel size. Exports are deterministic.

## Consequences

- Good: combinations, directions, animations and resolutions are all "free" once parts exist; one
  asset set serves platformer and RPG cameras.
- Good: CC0 sources keep the project and its outputs license-clean.
- Good: users can bring their own models (ADR-0005).
- Bad: output can look like "downscaled 3D" unless the pipeline is tuned (chibi head bias, limb
  thickness, pixel-snapped face decals, outline rules). This tuning is ongoing work.
- Bad: requires WebGPU/WebGL2 and a reasonably capable GPU.
- Risk: if the shared skeleton claim is false, parts cannot be rebound by bone name.
  Mitigation: the M1 asset spike (`tools/verify-rig.ts`) checks bone names, hierarchy and bind
  poses across all packs before engine work depends on it. Fallbacks: per-pack bone maps through
  the retargeter, or KayKit Adventurers (CC0).

## Alternatives considered

- **Hand-drawn layered sprites**: best pixel quality, but each part needs art per animation frame,
  per direction and per resolution. Not feasible for an open source project with few artists.
- **LPC (Liberated Pixel Cup) sprite layering**: large existing library, but fixed 64 px
  resolution, fixed 4 directions and fixed top-down style. Mixed CC-BY-SA/GPL licensing creates
  attribution and share-alike obligations for users' games. Does not meet the side-view or
  resolution goals.
- **Server-side rendering (Blender headless)**: highest fidelity, but needs a backend, costs money
  and breaks local-first (ADR-0005).
