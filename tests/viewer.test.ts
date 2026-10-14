import { test } from "node:test";
import assert from "node:assert/strict";
import { backendOrder, chooseBackend, type BackendEnv } from "../web/viewer.ts";

const ALL: BackendEnv = { webgpu: true, webgl2: true };
const GL_ONLY: BackendEnv = { webgpu: false, webgl2: true };
const NONE: BackendEnv = { webgpu: false, webgl2: false };

const WEBGPU_ONLY: BackendEnv = { webgpu: true, webgl2: false };

test("automatic choice prefers WebGL2, then WebGPU, then CPU", () => {
  assert.equal(chooseBackend(ALL), "webgl2");
  assert.equal(chooseBackend(GL_ONLY), "webgl2");
  assert.equal(chooseBackend(WEBGPU_ONLY), "webgpu");
  assert.equal(chooseBackend(NONE), "cpu");
});

test("backend order always ends in cpu, so a model can always be shown", () => {
  for (const env of [ALL, GL_ONLY, WEBGPU_ONLY, NONE]) {
    for (const force of [undefined, "webgpu", "webgl2", "cpu"] as const) {
      const order = backendOrder(env, force);
      assert.equal(order[order.length - 1], "cpu");
      assert.equal(new Set(order).size, order.length, "no backend is tried twice");
    }
  }
});

test("forced WebGPU lists WebGPU first and WebGL2 as the next fallback", () => {
  assert.deepEqual(backendOrder(ALL, "webgpu"), ["webgpu", "webgl2", "cpu"]);
  assert.deepEqual(backendOrder(GL_ONLY, "webgpu"), ["webgl2", "cpu"]);
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
