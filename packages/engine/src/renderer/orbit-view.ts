/**
 * The 3D view mode (spec 009 REQ-UX-003, engine part): an orbitable, full-resolution
 * perspective view of the preview scene. It draws the same character (the same toon materials,
 * bound to the renderer's settings binder) through a `RenderPipeline` with one `pass()`, with
 * `outputColorTransform` on (this view is not palette-quantized), into the canvas at the
 * viewport's device resolution. Works on WebGPU and WebGL2 (TSL only).
 *
 * Deterministic: the camera is a pure function of the `OrbitState` (`orbitEyeInto`); the
 * node frame time is set by the caller (the clip time), never the wall clock; the scene pass is
 * driven once per {@link OrbitView.render} rather than once per animation-loop tick, so draws
 * outside the loop (seek, direction change) are never stale.
 */
import {Color, PerspectiveCamera, Vector2} from 'three';
import type {RenderTarget, Scene} from 'three';
import {mrt, output as materialOutput, pass} from 'three/tsl';
import {NodeUpdateType, RenderPipeline} from 'three/webgpu';
import type {Node, NodeFrame, WebGPURenderer} from 'three/webgpu';
import {ORBIT_FOV_DEG, orbitEyeInto, orbitFar, orbitNear} from './orbit-camera';
import type {OrbitState} from './orbit-camera';

/** Draws the scene through the orbit camera. */
export interface OrbitView {
  /** The perspective camera (placed from the state on every render). */
  readonly camera: PerspectiveCamera;
  /**
   * Renders one frame at `width` x `height` device pixels: sets the drawing buffer to that size
   * (pixel ratio 1) when it differs, places the camera from `state` ({@link orbitEye}) and draws
   * into the output with a transparent clear.
   *
   * @param state Orbit state.
   * @param width Drawing-buffer width (rounded, at least 1).
   * @param height Drawing-buffer height (rounded, at least 1).
   * @param frameTimeSec Node-frame time (the drawn clip time); never the wall clock.
   */
  render(
    state: OrbitState,
    width: number,
    height: number,
    frameTimeSec: number,
  ): void;
  /** Releases the pipeline and its pass target. */
  dispose(): void;
}

/** Options of {@link createOrbitView}. */
export interface OrbitViewOptions {
  /**
   * Where to draw: `null` (default) = the canvas. A target lets GPU tests read the view back
   * (vitest browser mode loses the WebGPU instance when presenting to a canvas).
   */
  readonly output?: RenderTarget | null;
}

/** The writable part of three's node frame that the view drives (version-pinned internals). */
interface DrivenNodeFrame {
  update(): void;
  time: number;
  deltaTime: number;
}

function nodeFrameOf(renderer: WebGPURenderer): DrivenNodeFrame {
  const nodes = (renderer as unknown as {_nodes?: {nodeFrame?: unknown}})
    ._nodes;
  const frame = nodes?.nodeFrame as {update?: unknown} | undefined;
  if (frame === undefined || typeof frame.update !== 'function') {
    throw new Error(
      'OrbitView: renderer node frame not found (renderer not initialized, or three internals changed)',
    );
  }
  return frame as DrivenNodeFrame;
}

/**
 * Creates the 3D view of a scene.
 *
 * @param renderer An initialized renderer (shared with the pixel pipeline).
 * @param scene The preview scene (the character on its direction stage).
 * @param options Output override (tests).
 * @returns The view.
 */
export function createOrbitView(
  renderer: WebGPURenderer,
  scene: Scene,
  options: OrbitViewOptions = {},
): OrbitView {
  const outputTarget = options.output ?? null;
  const camera = new PerspectiveCamera(ORBIT_FOV_DEG, 1, 0.01, 100);
  camera.name = 'orbit';
  const scenePass = pass(scene, camera, {samples: 0});
  scenePass.name = 'orbit-scene';
  // Part materials merge their own MRT outputs (part ID); with a single `output` key only the
  // colour attachment exists here and the other keys are dropped.
  scenePass.setMRT(mrt({output: materialOutput}));
  scenePass.updateBeforeType = NodeUpdateType.NONE;
  const pipeline = new RenderPipeline(
    renderer,
    scenePass.getTextureNode('output') as unknown as Node<'vec4'>,
  );
  pipeline.outputColorTransform = true;
  const passFrame = {renderer} as unknown as NodeFrame;
  let nodeFrame: DrivenNodeFrame | null = null;
  const size = new Vector2();
  const clearColor = new Color();
  let disposed = false;

  const eye: [number, number, number] = [0, 0, 0];
  /** Places the camera; allocates nothing (per-frame path). */
  const place = (state: OrbitState, aspect: number): void => {
    orbitEyeInto(state, eye);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(state.target[0], state.target[1], state.target[2]);
    camera.aspect = aspect;
    camera.near = orbitNear(state);
    camera.far = orbitFar(state);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };

  return {
    camera,
    render(state, width, height, frameTimeSec) {
      if (disposed) throw new Error('OrbitView is disposed');
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      if (renderer.getPixelRatio() !== 1) renderer.setPixelRatio(1);
      renderer.getDrawingBufferSize(size);
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      place(state, w / h);
      nodeFrame ??= nodeFrameOf(renderer);
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const previousAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      try {
        const previousTime = nodeFrame.time;
        nodeFrame.update();
        nodeFrame.time = frameTimeSec;
        nodeFrame.deltaTime = Math.max(0, frameTimeSec - previousTime);
        scenePass.updateBefore(passFrame);
        renderer.setRenderTarget(outputTarget);
        pipeline.render();
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, previousAlpha);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pipeline.dispose();
      scenePass.dispose();
    },
  };
}
