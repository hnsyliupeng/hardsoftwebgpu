#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GifWriter, medianCut, paletteLookup } from './gif.js';

const rawFiles = readdirSync('/tmp/fea_frames').filter(f => f.endsWith('.raw')).sort();
if (rawFiles.length === 0) {
  console.error("No frames found in /tmp/fea_frames");
  process.exit(1);
}

const W = 720, H = 540;
const frames = rawFiles.map(f => readFileSync(join('/tmp/fea_frames', f)));

console.log(`Encoding ${frames.length} frames into docs/fea/trunc_torque_transmission_mbd_fem.gif...`);
const samples = [{ data: frames[0], stride: 4 }, { data: frames[Math.floor(frames.length / 2)], stride: 4 }];
const palette = medianCut(samples, 256);
const map = paletteLookup(palette);
const writer = new GifWriter(W, H, palette, 0);

for (const frame of frames) {
  const indexed = new Uint8Array(W * H);
  map(frame, indexed);
  writer.addFrame(indexed, 100);
}

const gifBytes = writer.finish();
writeFileSync('docs/fea/trunc_torque_transmission_mbd_fem.gif', gifBytes);
console.log(`Wrote docs/fea/trunc_torque_transmission_mbd_fem.gif (${(gifBytes.length / 1024).toFixed(0)} kB)`);
