// Headless-Chromium click-through of the structure-graph panel (D1, B2): slider commit, undo, redo, rejected
// input and starter reset, and the section and measurement panel (D3). Optional; not a project dependency. Same setup as scripts/browser_check.mjs:
//   mkdir -p /tmp/browser && cd /tmp/browser && npm i @sparticuz/chromium puppeteer-core
//   node -e 'const z=require("zlib"),f=require("fs");f.writeFileSync("al2023.tar",z.brotliDecompressSync(f.readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br")))' && mkdir -p libs && tar -xf al2023.tar -C libs
//   cp <repo>/scripts/browser_graph_check.mjs /tmp/browser/ && cd /tmp/browser && LD_LIBRARY_PATH=/tmp/browser/libs/lib node browser_graph_check.mjs http://127.0.0.1:5173/
// Exits 1 if any step fails. Prints one line per step.
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: "shell", timeout: 60000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => /Done in|Error/.test(document.getElementById("status")?.textContent ?? ""), { timeout: 240000 });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const statusText = () => page.$eval("#graphStatus", (e) => e.textContent);
const statusOk = () => page.$eval("#graphStatus", (e) => e.dataset.ok);
const sliderValue = () => page.$eval("#graphParams input[type=range]", (e) => e.value).catch(() => null);

// 1. Starter graph is loaded and its parameter sliders are shown.
check("starter graph loaded", (await statusText()) === "loaded starter graph", await statusText());
const nSliders = await page.$$eval("#graphParams input[type=range]", (xs) => xs.length);
check("parameter sliders shown", nSliders > 0, `${nSliders} sliders`);

// 2. Apply the unchanged text: accepted, and no history step.
await page.click("#graphApply");
check("apply unchanged text accepted", (await statusText()).startsWith("applied"), await statusText());

// 3. Move one slider (one change event = one undo step).
const before = await sliderValue();
const range = await page.evaluate(() => {
  const el = document.querySelector("#graphParams input[type=range]");
  const min = Number(el.min), max = Number(el.max), v = Number(el.value);
  const target = v + (max - min) * 0.2 <= max ? v + (max - min) * 0.2 : v - (max - min) * 0.2;
  el.value = String(target);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { target: el.value };
});
await new Promise((r) => setTimeout(r, 300));
const afterMove = await statusText();
check("slider change commits", afterMove.startsWith("set ") && (await statusOk()) === "1", afterMove);
check("undo enabled after an edit", !(await page.$eval("#graphUndo", (b) => b.disabled)));

// 4. Undo restores the previous value.
await page.click("#graphUndo");
await new Promise((r) => setTimeout(r, 200));
const afterUndo = await sliderValue();
check("undo restores slider", (await statusText()) === "undo" && afterUndo === before, `before ${before}, after undo ${afterUndo}`);

// 5. Redo re-applies the move.
await page.click("#graphRedo");
await new Promise((r) => setTimeout(r, 200));
check("redo re-applies the move", (await statusText()) === "redo" && (await sliderValue()) === range.target, `slider ${await sliderValue()}, target ${range.target}`);

// 6. Invalid JSON is rejected and the status says so.
await page.evaluate(() => { document.getElementById("graphJson").value = "{ not json"; });
await page.click("#graphApply");
await new Promise((r) => setTimeout(r, 200));
const rejected = await statusText();
check("invalid JSON rejected", rejected.startsWith("rejected") && (await statusOk()) === "0", rejected.slice(0, 80));

// 7. Starter reset is an ordinary edit (undoable).
await page.click("#graphReset");
await new Promise((r) => setTimeout(r, 200));
check("starter reset applied", (await statusText()).startsWith("starter graph applied"), await statusText());

// 8. Section panel (D3): axis change resets the offset range, the offset slider moves the cut, the canvas
//    draws an outline and the measurement table is filled.
const sec = await page.evaluate(() => {
  const axis = document.getElementById("secAxis");
  axis.value = "0";
  axis.dispatchEvent(new Event("change", { bubbles: true }));
  const off = document.getElementById("secOffset");
  const lo = Number(off.min), hi = Number(off.max), mid = (lo + hi) / 2;
  const v1 = off.value;
  off.value = String(lo + (hi - lo) * 0.3);
  off.dispatchEvent(new Event("input", { bubbles: true }));
  return { lo, hi, v1, label: document.getElementById("secOffsetVal").textContent, mid };
});
await new Promise((r) => setTimeout(r, 400));
const label = await page.$eval("#secOffsetVal", (e) => e.textContent);
check("section: x axis sets offset range", sec.hi > sec.lo && sec.lo > -0.01 && sec.hi - sec.lo > 19.9 && sec.hi - sec.lo < 20.1, `range ${sec.lo.toFixed(2)}..${sec.hi.toFixed(2)} mm`);
check("section: offset label follows the slider", label.startsWith("x = ") && label.endsWith(" mm"), label);
const ink = await page.evaluate(() => {
  const c = document.getElementById("secCanvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
  return n;
});
check("section: outline drawn on the canvas", ink > 50, `${ink} non-white pixels`);
const rows = await page.$$eval("#measureTable tr", (trs) => trs.map((tr) => tr.textContent));
check("section: measurement table filled", rows.length === 6 && rows.some((t) => t.includes("mm³")), `${rows.length} rows`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} steps passed`);
process.exit(failed ? 1 : 0);
