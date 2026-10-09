/**
 * The pixel render pipeline (spec 003 REQ-PIX-002, 014, 023..025, 029, 034;
 * m2-plan 2.1 to 2.4). One instance per renderer; preview and export share it.
 *
 * Frame path: one MRT scene pass (`pass(scene, camera)` + `createSceneMrt`,
 * attachments `output` / `normalDepth` / `partId`, HalfFloat, nearest, no MSAA,
 * no mipmaps) → the post chain of {@link DEFAULT_POST_STAGES} built from the
 * emitter-shaped stages through a post `CompileContext` → a three
 * `RenderPipeline` with `outputColorTransform` off → the RGBA8 `NoColorSpace`
 * cell target, which export reads back (tight RGBA8, top-left origin,
 * `normalizeReadback`) and preview presents.
 *
 * Settings: uniform-only changes write the shared {@link SettingsBinder} and
 * never recompile (REQ-PIX-034). A structural change (dither mode, inner
 * sources, outline color mode, palette none ↔ on, post graph) rebuilds only
 * the post node; a resolution change resizes the targets and the drawing
 * buffer. Framing (camera + depth scale) comes from the caller (union bounds,
 * M2-16) through {@link PixelPipeline.setFraming}.
 *
 * The canvas drawing buffer must equal the cell size: `PassNode` sizes its
 * target from `renderer.getDrawingBufferSize()` (m2-plan 2.1 item 6). The
 * pipeline enforces pixel ratio 1 and `setSize(W, H, false)` (no CSS change).
 */
import {
  Color,
  HalfFloatType,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RenderTarget,
  UnsignedByteType,
  Vector2,
} from 'three';
import type {OrthographicCamera, Scene} from 'three';
import {floor, ivec2, pass, screenCoordinate} from 'three/tsl';
import {NodeUpdateType, RenderPipeline} from 'three/webgpu';
import type {
  Node,
  NodeFrame,
  PassNode,
  TextureNode,
  WebGPURenderer,
} from 'three/webgpu';
import type {HexColor, RenderSettings} from '@csg/parts-schema';
import type {TslNode} from '@csg/shader-graph/tsl';
import type {EngineError, Result} from '../contracts/errors';
import type {Framing, PostStageId, ReadbackLayout} from '../contracts/pipeline';
import {backendOf} from '../renderer/backend';
import {applyCameraFraming, createPixelCamera} from './camera';
import type {CameraPlacement, Vec3Tuple} from './camera';
import {buildPaletteLut} from './palette-lut';
import {normalizeReadback} from './readback';
import {activePaletteColors} from './settings-binder';
import type {RenderSettingsDiff, SettingsBinder} from './settings-binder';
import {createStageContext} from './stage-context';
import type {StageContext} from './stage-context';
import {
  DEFAULT_POST_STAGES,
  alphaCutoff,
  bayerDither,
  defaultAlphaCutoffInputs,
  defaultBayerDitherInputs,
  defaultEdgeDetectInputs,
  defaultFinalAlphaInputs,
  defaultOutlineInputs,
  defaultPaletteQuantizeInputs,
  defaultRimEdgeInputs,
  edgeDetect,
  edgeSourcesFromSettings,
  finalAlpha,
  linearToSrgb,
  outline,
  outlineFieldsFromSettings,
  paletteQuantize,
  rimEdge,
} from './stages/index';
import {
  SCENE_MRT_KEYS,
  createSceneDepthUniforms,
  createSceneMrt,
  setSceneDepth,
} from './toon-material';
import type {SceneDepthUniforms, SceneMrtKey} from './toon-material';
import {installFenceWait} from './webgl-fence-wait';

/** Builds the 512×512 RGBA8 palette LUT (sync in tests/export, a worker in preview). */
export type PaletteLutBuilder = (
  colors: readonly HexColor[],
  metric: RenderSettings['palette']['metric'],
) => Uint8Array | Promise<Uint8Array>;

/** Options of {@link createPixelPipeline}. */
export interface PixelPipelineOptions {
  /** An initialized renderer; the pipeline owns its drawing-buffer size. */
  readonly renderer: WebGPURenderer;
  /** Scene rendered by the scene pass (its meshes carry `userData.partId`). */
  readonly scene: Scene;
  /** Shared uniform owner (one per renderer); not disposed by the pipeline. */
  readonly binder: SettingsBinder;
  /** Camera placed by {@link PixelPipeline.setFraming}; default {@link createPixelCamera}. */
  readonly camera?: OrthographicCamera;
  /** Compile mode of the post context (default `export`). */
  readonly mode?: 'preview' | 'export';
  /** LUT builder (default the synchronous `buildPaletteLut`). */
  readonly buildPaletteLut?: PaletteLutBuilder;
}

/** Counters for tests and diagnostics (AC-PIX-014.2, AC-PIX-034.1). */
export interface PixelPipelineStats {
  /** Post-node compilations requested (first build included). */
  readonly rebuilds: number;
  /** Frames rendered with {@link PixelPipeline.render}. */
  readonly frames: number;
}

/** The post output node of the default chain and the stage IDs in build order. */
export interface PostChain {
  /** Final RGBA (sRGB, palette-quantized, binary alpha) for the cell target. */
  readonly output: TslNode;
  /** Stage IDs in the order they were chained (= {@link DEFAULT_POST_STAGES}). */
  readonly stages: readonly PostStageId[];
}

/**
 * Builds the default post chain (REQ-PIX-025, AC-PIX-025.1) from the
 * emitter-shaped stages: coverage → screen-space rim → edge-detect + outline → sRGB → Bayer
 * dither (`{matrix: ctx.ditherMatrixSize}`) → palette lookup → final alpha.
 * Compile-time fields come from `settings` (inner sources, outline color
 * mode); every value is a uniform of the context's binder.
 *
 * @param ctx - Post context whose `scene.*` builtins are the MRT TextureNodes.
 * @param settings - The applied settings (fields only).
 * @returns The output node and the chained stage IDs.
 */
export function buildDefaultPostChain(
  ctx: StageContext,
  settings: RenderSettings,
): PostChain {
  let color: TslNode | undefined;
  const stages: PostStageId[] = [];
  const need = (): TslNode => {
    if (color === undefined) throw new Error('post chain: no input color');
    return color;
  };
  for (const stage of DEFAULT_POST_STAGES) {
    switch (stage) {
      case 'coverage':
        color = alphaCutoff(ctx, defaultAlphaCutoffInputs(ctx), {}).color;
        break;
      case 'rim':
        color = rimEdge(
          ctx,
          {color: need(), ...defaultRimEdgeInputs(ctx)},
          {},
        ).color;
        break;
      case 'outline': {
        const edges = edgeDetect(ctx, defaultEdgeDetectInputs(ctx), {
          sources: edgeSourcesFromSettings(settings.outline.inner),
        });
        color = outline(
          ctx,
          {
            color: need(),
            outer: edges.outer,
            inner: edges.inner,
            source: edges.source,
            ...defaultOutlineInputs(ctx),
          },
          outlineFieldsFromSettings(settings.outline),
        ).color;
        break;
      }
      case 'srgb':
        color = linearToSrgb(ctx, {color: need()}, {}).out;
        break;
      case 'dither':
        color = bayerDither(
          ctx,
          {color: need(), ...defaultBayerDitherInputs(ctx)},
          {matrix: ctx.ditherMatrixSize},
        ).color;
        break;
      case 'palette':
        color = paletteQuantize(
          ctx,
          {color: need(), ...defaultPaletteQuantizeInputs(ctx)},
          {},
        ).color;
        break;
      case 'final-alpha':
        color = finalAlpha(
          ctx,
          {color: need(), ...defaultFinalAlphaInputs(ctx)},
          {},
        ).color;
        break;
    }
    stages.push(stage);
  }
  return {output: need(), stages};
}

/** Readback layout of `readRenderTargetPixelsAsync` for an RGBA8 target (REQ-PIX-029). */
export function cellReadbackLayout(
  backend: 'webgpu' | 'webgl2',
  width: number,
): ReadbackLayout {
  return backend === 'webgpu'
    ? {rowStrideBytes: Math.ceil((width * 4) / 256) * 256, bottomUp: false}
    : {rowStrideBytes: width * 4, bottomUp: true};
}

/** Creates the RGBA8 `NoColorSpace` cell target (nearest, no mipmaps, no MSAA, no depth). */
function createCellTarget(width: number, height: number): RenderTarget {
  const target = new RenderTarget(width, height, {
    type: UnsignedByteType,
    format: RGBAFormat,
    colorSpace: NoColorSpace,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    samples: 0,
  });
  target.texture.name = 'cell';
  return target;
}

/**
 * Checks that the backend can render the HalfFloat MRT (WebGL2 needs
 * `EXT_color_buffer_float`; m2-plan R3, PM decision: no RGBA8 fallback in M2).
 */
function checkBackend(
  renderer: WebGPURenderer,
): Result<'webgpu' | 'webgl2', EngineError> {
  const backend = backendOf(renderer);
  if (backend === 'webgl2') {
    const gl = (renderer.backend as {gl?: WebGL2RenderingContext}).gl;
    const ok =
      gl !== undefined && gl.getExtension('EXT_color_buffer_float') !== null;
    if (!ok) {
      return {
        ok: false,
        error: {
          code: 'PIX_BACKEND_UNAVAILABLE',
          message:
            'WebGL2 cannot render half-float targets (EXT_color_buffer_float missing)',
          details: {backend, reason: 'EXT_color_buffer_float'},
        },
      };
    }
  }
  return {ok: true, value: backend};
}

/**
 * three r186 advances `NodeFrame.frameId` only in its requestAnimationFrame
 * loop, and skinning updates bone matrices once per `frameId`. Frames rendered
 * back to back (export, readback between frames) would then draw skinned
 * meshes with the previous frame's bones. The pipeline advances the frame
 * itself; this reads the renderer's (internal, version-pinned) node frame.
 *
 * @throws Error when the renderer is not initialized or the internals moved
 *   (three upgrade): fail loudly instead of rendering stale bones.
 */
function nodeFrameOf(renderer: WebGPURenderer): {update(): void} {
  const nodes = (renderer as unknown as {_nodes?: {nodeFrame?: unknown}})
    ._nodes;
  const frame = nodes?.nodeFrame as {update?: unknown} | undefined;
  if (frame === undefined || typeof frame.update !== 'function') {
    throw new Error(
      'PixelPipeline: renderer node frame not found (renderer not initialized, or three internals changed)',
    );
  }
  return frame as {update(): void};
}

/**
 * Creates the pixel pipeline for an initialized renderer. Call
 * {@link PixelPipeline.setRenderSettings} and {@link PixelPipeline.setFraming}
 * before the first {@link PixelPipeline.render}.
 *
 * @param options - Renderer, scene, binder, camera, mode, LUT builder.
 * @returns The pipeline, or `PIX_BACKEND_UNAVAILABLE` when the backend cannot
 *   render the half-float scene MRT.
 */
export function createPixelPipeline(
  options: PixelPipelineOptions,
): Result<PixelPipeline, EngineError> {
  const backend = checkBackend(options.renderer);
  if (!backend.ok) return backend;
  return {ok: true, value: new PixelPipeline(options, backend.value)};
}

/** The pixel pipeline; see the module comment. Create with {@link createPixelPipeline}. */
export class PixelPipeline {
  /** Active backend. */
  readonly backend: 'webgpu' | 'webgl2';
  /** The renderer. */
  readonly renderer: WebGPURenderer;
  /** The pipeline camera (placed by {@link setFraming}). */
  readonly camera: OrthographicCamera;
  /** Shared uniform owner. */
  readonly binder: SettingsBinder;
  /** RGBA8 `NoColorSpace` target holding the finished cell (export reads it; preview shows it). */
  readonly cellTarget: RenderTarget;
  /** Depth-in-pixels uniforms of the scene MRT. */
  readonly sceneDepth: SceneDepthUniforms;
  /** The single MRT scene pass. */
  readonly scenePass: PassNode;

  private readonly mode: 'preview' | 'export';
  private readonly lutBuilder: PaletteLutBuilder;
  private readonly post: RenderPipeline;
  private readonly sceneTextures: Readonly<Record<SceneMrtKey, TextureNode>>;
  private current: RenderSettings | undefined;
  private currentFraming: Framing | undefined;
  private placement: CameraPlacement | undefined;
  private lutGeneration = 0;
  private rebuildCount = 0;
  private frameCount = 0;
  private disposed = false;
  private readonly passFrame: NodeFrame;
  private readonly nodeFrame: {update(): void};
  private readonly _size = new Vector2();
  private readonly _clearColor = new Color();

  /**
   * Use {@link createPixelPipeline}, which checks the backend first.
   *
   * @param options - Pipeline options.
   * @param backend - Checked backend.
   */
  constructor(options: PixelPipelineOptions, backend: 'webgpu' | 'webgl2') {
    this.backend = backend;
    this.renderer = options.renderer;
    this.binder = options.binder;
    this.camera = options.camera ?? createPixelCamera();
    this.mode = options.mode ?? 'export';
    this.lutBuilder = options.buildPaletteLut ?? buildPaletteLut;
    this.sceneDepth = createSceneDepthUniforms();
    this.cellTarget = createCellTarget(1, 1);

    this.scenePass = pass(options.scene, this.camera, {
      type: HalfFloatType,
      samples: 0,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    this.scenePass.name = 'pixel-scene';
    // three runs a FRAME-updated pass once per animation-loop tick, so frames
    // rendered back to back (export) would reuse a stale scene render. The
    // pipeline drives the pass itself, exactly once per render() (AC-PIX-014.2).
    this.scenePass.updateBeforeType = NodeUpdateType.NONE;
    this.passFrame = {renderer: this.renderer} as unknown as NodeFrame;
    this.nodeFrame = nodeFrameOf(this.renderer);
    this.scenePass.setMRT(createSceneMrt(this.sceneDepth));
    // Creates the attachment textures now, named after their MRT keys (PassNode
    // matches attachments by texture name).
    const textures = {} as Record<SceneMrtKey, TextureNode>;
    for (const key of SCENE_MRT_KEYS) {
      textures[key] = this.scenePass.getTextureNode(key) as TextureNode;
    }
    this.sceneTextures = textures;

    this.post = new RenderPipeline(this.renderer);
    this.post.outputColorTransform = false;
    // WebGL2 readback waits on a fence polled once per rAF in three r186;
    // poll per task instead (M2-19, see webgl-fence-wait.ts). Same bytes.
    if (backend === 'webgl2') installFenceWait(this.renderer.backend);
  }

  /** Settings last applied with {@link setRenderSettings}. */
  get settings(): RenderSettings | undefined {
    return this.current;
  }

  /** Framing last set with {@link setFraming}. */
  get framing(): Framing | undefined {
    return this.currentFraming;
  }

  /** Rebuild and frame counters. */
  get stats(): PixelPipelineStats {
    return {rebuilds: this.rebuildCount, frames: this.frameCount};
  }

  /** Every render target the pipeline renders into (AC-PIX-002.1 inspection). */
  renderTargets(): readonly RenderTarget[] {
    return [this.scenePass.renderTarget, this.cellTarget];
  }

  /**
   * Applies validated settings (REQ-PIX-034): writes the binder uniforms in
   * place, resizes on a resolution change, rebuilds the post node only on a
   * structural change, and uploads the palette LUT when the effective palette
   * changed. A later call supersedes the LUT of an earlier one still building.
   *
   * @param settings - Validated settings (`parseRenderSettings`).
   * @returns The change classification; resolves once the LUT is uploaded.
   */
  async setRenderSettings(
    settings: RenderSettings,
  ): Promise<RenderSettingsDiff> {
    this.assertLive();
    const first = this.current === undefined;
    const diff = this.binder.apply(settings);
    this.current = settings;
    if (first || diff.resize) this.resize();
    if (first || diff.post) this.rebuildPost();
    if (first || diff.palette) {
      const colors = activePaletteColors(settings.palette);
      const generation = ++this.lutGeneration;
      if (colors !== null) {
        const lut = await this.lutBuilder(colors, settings.palette.metric);
        if (generation === this.lutGeneration && !this.disposed) {
          this.binder.setPaletteLut(lut);
        }
      }
    }
    return diff;
  }

  /**
   * Places the camera for a framing and writes the depth scale (no recompile).
   *
   * @param framing - From `computeFraming` (union bounds or fixed).
   * @param pivot - World position of the ground pivot (default origin).
   * @returns The camera placement.
   */
  setFraming(framing: Framing, pivot?: Vec3Tuple): CameraPlacement {
    this.assertLive();
    const placement = applyCameraFraming(this.camera, framing, pivot);
    setSceneDepth(this.sceneDepth, placement.distance, framing.worldPerPx);
    this.currentFraming = framing;
    this.placement = placement;
    return placement;
  }

  /**
   * Renders one frame into {@link cellTarget}: exactly one scene render
   * (AC-PIX-014.2, driven here rather than by three's per-tick node update)
   * followed by the post quad. Clears to transparent black and
   * restores the renderer's clear color and render target. Allocates nothing.
   *
   * @throws Error before settings/framing are set or while the palette LUT is pending.
   */
  render(): void {
    this.assertLive();
    const settings = this.current;
    if (settings === undefined || this.placement === undefined) {
      throw new Error(
        'PixelPipeline.render: settings and framing are required',
      );
    }
    if (!this.binder.paletteReady) {
      throw new Error('PixelPipeline.render: palette LUT not uploaded yet');
    }
    const r = this.renderer;
    const {width, height} = settings.resolution;
    r.getDrawingBufferSize(this._size);
    if (this._size.x !== width || this._size.y !== height) this.resize();

    const previousTarget = r.getRenderTarget();
    r.getClearColor(this._clearColor);
    const previousAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    try {
      // One logical frame per render(): FRAME-keyed node updates (skeleton
      // bone matrices, OnObjectUpdate) must see this pose and stage yaw even
      // when no animation-loop tick happened since the last frame.
      this.nodeFrame.update();
      this.scenePass.updateBefore(this.passFrame);
      r.setRenderTarget(this.cellTarget);
      this.post.render();
    } finally {
      r.setRenderTarget(previousTarget);
      r.setClearColor(this._clearColor, previousAlpha);
    }
    this.frameCount++;
  }

  /**
   * Reads {@link cellTarget} back as tight RGBA8 rows, top-left origin
   * (REQ-PIX-029), on both backends.
   *
   * @returns `width · height · 4` bytes.
   */
  async read(): Promise<Uint8ClampedArray> {
    this.assertLive();
    const {width, height} = this.cellTarget;
    const raw = (await this.renderer.readRenderTargetPixelsAsync(
      this.cellTarget,
      0,
      0,
      width,
      height,
    )) as Uint8Array;
    return normalizeReadback(
      raw,
      width,
      height,
      cellReadbackLayout(this.backend, width),
    );
  }

  /**
   * Releases the post material, the scene pass target and the cell target.
   * The binder, scene and renderer stay owned by the caller.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lutGeneration++;
    this.post.dispose();
    this.scenePass.dispose();
    this.cellTarget.dispose();
  }

  private resize(): void {
    const settings = this.current;
    if (settings === undefined) return;
    const {width, height} = settings.resolution;
    const r = this.renderer;
    if (r.getPixelRatio() !== 1) r.setPixelRatio(1);
    r.getDrawingBufferSize(this._size);
    if (this._size.x !== width || this._size.y !== height) {
      r.setSize(width, height, false);
    }
    if (this.cellTarget.width !== width || this.cellTarget.height !== height) {
      this.cellTarget.setSize(width, height);
    }
    this.scenePass.setSize(width, height);
  }

  private rebuildPost(): void {
    const settings = this.current;
    if (settings === undefined) return;
    const ctx = createStageContext({
      binder: this.binder,
      target: 'post',
      mode: this.mode,
      backend: this.backend,
      sources: {
        'scene.color': this.sceneTextures.output,
        'scene.normal': this.sceneTextures.normalDepth,
        'scene.depth': this.sceneTextures.normalDepth,
        'scene.partId': this.sceneTextures.partId,
        // Band brightness light_k in the free G channel of `partId` (FX-J).
        'scene.light': this.sceneTextures.partId.load(
          ivec2(floor(screenCoordinate)),
        ).g,
      },
    });
    this.post.outputNode = buildDefaultPostChain(ctx, settings)
      .output as Node<'vec4'>;
    this.post.needsUpdate = true;
    this.rebuildCount++;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('PixelPipeline is disposed');
  }
}
