import {z} from 'zod';

/**
 * Turns off Zod's JIT compilation for every consumer of this package. Zod probes
 * `new Function('')` on the first object parse; under the strict CSP of REQ-GEN-010 (Trusted
 * Types, no `unsafe-eval`) that swallowed probe is still reported as a violation
 * (AC-GEN-010.2). This package parses its bundled data at module load, and a bundler may
 * evaluate it before any app code, so the switch lives here and is imported first by every
 * module that parses at load. Harmless in Node: interpreted validation is fast enough for
 * the document sizes involved.
 */
z.config({jitless: true});
