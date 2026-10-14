import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBackend, type BackendEnv } from "../web/viewer.ts";

const ALL: BackendEnv = { webgpu: true, webgl2: true };
const GL_ONLY: BackendEnv = { webgpu: false, webgl2: true };
const NONE: BackendEnv = { webgpu: false, webgl2: false };

test("automatic choice prefers WebGPU, then WebGL2, then CPU", () => {
  assert.equal(chooseBackend(ALL), "webgpu");
  assert.equal(chooseBackend(GL_ONLY), "webgl2");
  assert.equal(chooseBackend(NONE), "cpu");
});

test("force=cpu always selects the CPU path (CPU-only verification)", () => {
  assert.equal(chooseBackend(ALL, "cpu"), "cpu");
  assert.equal(chooseBackend(GL_ONLY, "cpu"), "cpu");
  assert.equal(chooseBackend(NONE, "cpu"), "cpu");
});

test("forced WebGPU degrades to WebGL2, then CPU, when unavailable", () => {
  assert.equal(chooseBackend(ALL, "webgpu"), "webgpu");
  assert.equal(chooseBackend(GL_ONLY, "webgpu"), "webgl2");
  assert.equal(chooseBackend(NONE, "webgpu"), "cpu");
});

test("forced WebGL2 degrades to CPU when WebGL2 is unavailable", () => {
  assert.equal(chooseBackend(ALL, "webgl2"), "webgl2");
  assert.equal(chooseBackend(GL_ONLY, "webgl2"), "webgl2");
  assert.equal(chooseBackend(NONE, "webgl2"), "cpu");
});
