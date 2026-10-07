// generated from ts/index.ts by tools/ts-emit.mjs — do not edit
/**
 * hardsoftwebgpu — TypeScript source of the TRUNC port and its simulation.
 *
 * ts/trunc  the MATLAB reference implementation, ported file by file
 * ts/sim    the animated replay built on top of it
 *
 * Build the plain-JavaScript output with `node tools/ts-emit.mjs`, which uses
 * Node's own `module.stripTypeScriptTypes` so there is no TypeScript dependency
 * anywhere in the loop.
 */

export * as trunc from './trunc/index.js';
export * as sim from './sim/index.js';


//# sourceURL=/home/user/hardsoftwebgpu/ts/index.ts