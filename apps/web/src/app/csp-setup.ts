import {z} from 'zod';

/**
 * Turns off Zod's JIT compilation. Zod probes `new Function('')` to decide whether it may
 * compile validators; under the strict CSP of REQ-GEN-010 (Trusted Types, no `unsafe-eval`)
 * the swallowed probe is still reported as a violation (AC-GEN-010.2). Interpreted validation
 * is plenty fast for the document sizes this editor parses.
 *
 * Must run before the first schema parse: the shell imports this module first.
 */
z.config({jitless: true});
