// Headless-Chromium check of the live web app (optional; not a project dependency).
//   mkdir -p /tmp/browser && cd /tmp/browser && npm i @sparticuz/chromium puppeteer-core
//   # the chromium bundle ships its shared libraries as .tar.br; unpack them once:
//   node -e 'const z=require("zlib"),f=require("fs");f.writeFileSync("al2023.tar",z.brotliDecompressSync(f.readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br")))' && mkdir -p libs && tar -xf al2023.tar -C libs
//   LD_LIBRARY_PATH=/tmp/browser/libs/lib node <repo>/scripts/browser_check.mjs http://127.0.0.1:5173/
// Opens the page, waits for the default model to finish, and reports status, renderer backend and
// console/page errors. Writes artifacts/browser/page.png.
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: "shell", timeout: 60000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(url, { waitUntil: "load", timeout: 60000 });
const t0 = Date.now();
let status = "";
while (Date.now() - t0 < 240000) {
  status = await page.$eval("#status", (e) => e.textContent).catch(() => "");
  if (/Done in|Error/.test(status)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
await new Promise((r) => setTimeout(r, 1500));
const info = await page.evaluate(() => ({
  status: document.getElementById("status").textContent,
  backend: document.getElementById("backend").textContent,
  previewDisplay: getComputedStyle(document.getElementById("preview")).display,
  previewSrcLen: document.getElementById("preview").src.length,
  canvasDisplay: getComputedStyle(document.getElementById("view")).display,
  metricsRows: document.querySelectorAll("#metrics tr").length,
  code: document.getElementById("code").textContent.length,
}));
console.log(JSON.stringify(info, null, 2));
console.log(logs.slice(0, 40).join("\n") || "(no console/page errors)");
await page.screenshot({ path: "artifacts/browser/page.png", fullPage: false });
await browser.close();
