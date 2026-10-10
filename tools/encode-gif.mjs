import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GifWriter, medianCut, paletteLookup } from './gif.js';

const [,, argW, argH, argInDir, argOutFile, argDelay] = process.argv;
const W = argW ? parseInt(argW, 10) : 640;
const H = argH ? parseInt(argH, 10) : 480;
const inDir = argInDir || '/tmp/fea_frames';
const outFile = argOutFile || 'docs/fea/trunc_torque_transmission_mbd_fem.gif';
const delayMs = argDelay ? parseInt(argDelay, 10) : 100;

const rawFiles = readdirSync(inDir).filter(f => f.endsWith('.raw')).sort();
if (rawFiles.length === 0) {
  console.error(`No frames found in ${inDir}`);
  process.exit(1);
}

console.log(`Encoding ${rawFiles.length} frames from ${inDir} into ${outFile}...`);
const frames = rawFiles.map(f => new Uint8Array(readFileSync(join(inDir, f))));
const samples = frames.map(data => ({ data }));
const palette = medianCut(samples, 256);
const writer = new GifWriter(W, H, palette);
const lookup = paletteLookup(palette);

frames.forEach((f) => {
  const quant = writer.quantise(f, lookup, { dither: false });
  writer.addFrame(quant, delayMs);
});

const gifBytes = writer.finish();
writeFileSync(outFile, gifBytes);
console.log(`Wrote ${outFile} (${(gifBytes.length / 1024).toFixed(0)} kB)`);
