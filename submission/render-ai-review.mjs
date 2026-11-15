import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const here = import.meta.dirname;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}/ai-review.html`).href, { waitUntil: "load" });
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(400);

await mkdir(`${here}/preview-ai`, { recursive: true });
const pages = await page.$$(".page");
for (let i = 0; i < pages.length; i++) {
  await pages[i].screenshot({ path: `${here}/preview-ai/p${String(i + 1).padStart(2, "0")}.png` });
}
await page.pdf({ path: `${here}/ai-review.pdf`, width: "210mm", height: "297mm", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`${pages.length} pages → submission/ai-review.pdf`);
