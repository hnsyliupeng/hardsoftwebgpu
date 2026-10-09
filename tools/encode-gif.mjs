import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GifWriter, medianCut, paletteLookup } from './gif.js';

const rawFiles = readdirSync('/tmp/fea_frames').filter(f => f.endsWith('.raw')).sort();
if (rawFiles.length === 0) {
  console.error("No frames found in /tmp/fea_frames");
  process.exit(1);
}

const W = 720, H = 540;
const frames = rawFiles.map(f => new Uint8Array(readFileSync(join('/tmp/fea_frames', f))));

console.log(`Encoding ${frames.length} frames into docs/fea/trunc_torque_transmission_mbd_fem.gif...`);
const samples = frames.map(data => ({ data }));
const palette = medianCut(samples, 256);
const writer = new GifWriter(W, H, palette);
const lookup = paletteLookup(palette);

frames.forEach((f) => {
  const quant = writer.quantise(f, lookup, { dither: false });
  writer.addFrame(quant, 100);
});

const gifBytes = writer.finish();
writeFileSync('docs/fea/trunc_torque_transmission_mbd_fem.gif', gifBytes);
console.log(`Wrote docs/fea/trunc_torque_transmission_mbd_fem.gif (${(gifBytes.length / 1024).toFixed(0)} kB)`);
