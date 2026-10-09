import {describe, expect, it} from 'vitest';
import {vec2} from 'three/tsl';
import {bayerMatrix, bayerThreshold} from '../bayer';
import type {BayerSize} from '../bayer';
import {DITHER_SPREAD, bayerIndexBits, bayerThresholdNode} from './dither';

describe('Bayer dither (pure)', () => {
  for (const n of [2, 4, 8] as const satisfies readonly BayerSize[]) {
    it(`AC-PIX-022.2: bit formula equals the spec recursion for n=${n} and repeats every n px`, () => {
      const m = bayerMatrix(n);
      for (let y = 0; y < 3 * n; y++) {
        for (let x = 0; x < 3 * n; x++) {
          expect(bayerIndexBits(n, x, y)).toBe(m[y % n]?.[x % n]);
        }
      }
    });
  }

  it('REQ-PIX-022: DITHER_SPREAD is the spec value 0.25', () => {
    expect(DITHER_SPREAD).toBe(0.25);
  });
});

/**
 * Evaluates the constant TSL graph of {@link bayerThresholdNode} on the CPU in
 * float32 (the node subset it builds: constants, variables, `.x`/`.y`,
 * `+ − * /`, `floor`). Throws on any other node, so a change of the node shape fails
 * loudly instead of passing silently.
 */
function evalNode(node: unknown): number[] {
  const n = node as Record<string, unknown> & {
    nodeType?: string;
  };
  const f = Math.fround;
  if (n['isConstNode'] === true) {
    const v = n['value'] as number | {x: number; y: number};
    return typeof v === 'number' ? [f(v)] : [f(v.x), f(v.y)];
  }
  if (n['isVarNode'] === true || n['isConvertNode'] === true) {
    return evalNode(n['node']);
  }
  if (n['isSplitNode'] === true) {
    const src = evalNode(n['node']);
    const c = n['components'] as string;
    return [...c].map(ch => src['xyzw'.indexOf(ch)] as number);
  }
  if (n['isOperatorNode'] === true) {
    const a = evalNode(n['aNode']);
    const b = evalNode(n['bNode']);
    const len = Math.max(a.length, b.length);
    const at = (v: number[], i: number) =>
      (v.length === 1 ? v[0] : v[i]) as number;
    const op = n['op'] as string;
    return Array.from({length: len}, (_, i) => {
      const x = at(a, i);
      const y = at(b, i);
      switch (op) {
        case '+':
          return f(x + y);
        case '-':
          return f(x - y);
        case '*':
          return f(x * y);
        case '/':
          return f(x / y);
        default:
          throw new Error(`unsupported operator ${op}`);
      }
    });
  }
  if (n['isMathNode'] === true && n['method'] === 'floor') {
    return evalNode(n['aNode']).map(v => Math.floor(v));
  }
  throw new Error(`unsupported node ${String(n['type'] ?? n.nodeType)}`);
}

describe('Bayer threshold orientation (review L4)', () => {
  const cases: ReadonlyArray<readonly [BayerSize, number, number, number]> = [
    [4, 0, 0, -0.46875],
    [4, 1, 0, 0.03125],
    [4, 0, 1, 0.28125],
    [4, 5, 9, -0.21875],
    [2, 1, 0, 0.125],
    [2, 0, 1, 0.375],
  ];

  it('AC-PIX-022.4: bayer4 and bayer2 thresholds at (x, y) read M[y][x], exactly, on the CPU and from the GPU node', () => {
    for (const [n, x, y, expected] of cases) {
      expect(bayerThreshold(n, x, y), `CPU n=${n} (${x}, ${y})`).toBe(expected);
      const node = bayerThresholdNode(vec2(x, y), n);
      expect(evalNode(node), `GPU node n=${n} (${x}, ${y})`).toEqual([
        expected,
      ]);
    }
  });
});
