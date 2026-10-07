/**
 * setup.ts — the numbers and helpers from `setup.m` and `robotArm.m`.
 *
 * `setup.m` was the hardware bring-up script. It defined the servo home vector,
 * the compression offsets, and the safety pattern used to preload the tendons
 * before any task runs. Those constants are the arm's rest state, so they are
 * also what the animation starts from.
 */

/** `home = [80,94,91, 55,92,81, 63,83,83]` — nine servo counts, module by module. */
export const HOME: number[] = [80, 94, 91, 55, 92, 81, 63, 83, 83];

/** Per-cable compression split within a module: `[1, 5/7, 3/7]`. */
export const COMPRESSION_PATTERN = [1, 5 / 7, 3 / 7];

/** `delta_l` in setup.m, and the hard compression limit `comp_max`. */
export const COMPRESSION_DELTA = -80;
export const COMPRESSION_LIMIT = 70;

/** The window `set_pos` checks before it will command anything. */
export const SERVO_LIMITS = { min: -250, max: 150 };

/** `compressionVector(delta)` — `home + delta * repmat([1,5/7,3/7],[1,3])`. */
export function compressionVector(delta: number, home: number[] = HOME): number[] {
  const d = clampCompression(delta);
  return home.map((h, i) => h + d * COMPRESSION_PATTERN[i % 3]);
}

/** Clamp a compression command to the fixture's `comp_max` travel. */
export function clampCompression(delta: number): number {
  return Math.max(-COMPRESSION_LIMIT, Math.min(0, delta));
}

/** The preload state used before a task: `comp` from setup.m. */
export const COMPRESSED: number[] = compressionVector(COMPRESSION_DELTA);
/** The fully compressed state used by `reset_arm()`. */
export const FULLY_COMPRESSED: number[] = compressionVector(-COMPRESSION_LIMIT);

/** Conversion between the servo counts and the cable-length space. */
export const COUNTS_PER_MM = 1;
/** Tendon length change commanded by a compression delta, in mm per count. */
export function compressionToLength(delta: number): number {
  return -clampCompression(delta) / COUNTS_PER_MM;
}
