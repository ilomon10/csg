/**
 * Compile contracts of the TSL subpath (spec 007 Data and contracts,
 * REQ-PIX-035). Type-only: the engine implements `CompileContext`, the
 * compiler and the pipeline stages consume it.
 */
import type {Node} from 'three/webgpu';
import type {SocketType} from '../sockets/types';

/** A TSL expression node. */
export type TslNode = Node;

/** What the compiler may ask of its host; implemented by the engine. */
export interface CompileContext {
  /** Which pipeline part is being compiled. */
  readonly target: 'material' | 'post';
  /** Preview, deterministic export, or the small node-editor preview. */
  readonly mode: 'preview' | 'export' | 'node-preview';
  /** Active rendering backend. */
  readonly backend: 'webgpu' | 'webgl2';
  /** Unknown name throws (becomes SGF_EMIT_FAILED in M4). */
  builtin(name: string): TslNode;
  /**
   * Same key returns the same uniform node (reserved IDs, user params,
   * `node:<id>.<socket>`).
   */
  uniform(
    key: string,
    type: Exclude<SocketType, 'texture'>,
    initial: unknown,
  ): TslNode;
}

/**
 * M2 pipeline stage: `NodeEmitter.compile` with typed fields instead of the
 * `GraphNode`. Pure; creates no material or render target.
 *
 * @typeParam I Input socket IDs.
 * @typeParam O Output socket IDs.
 * @typeParam F Node fields (for example `mode`, `matrix`).
 */
export type StageEmitter<
  I extends string,
  O extends string,
  F extends object = Record<string, never>,
> = (
  ctx: CompileContext,
  inputs: Readonly<Record<I, TslNode>>,
  fields: Readonly<F>,
) => Record<O, TslNode>;
