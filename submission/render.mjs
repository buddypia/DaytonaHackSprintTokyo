import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const here = import.meta.dirname;
const slidesPng = process.argv.includes("--png");
const out = `${here}/omakase-tetsuzuki-deck.pdf`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}/deck.html`).href, { waitUntil: "load" });
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(300);

if (slidesPng) {
  await mkdir(`${here}/preview`, { recursive: true });
  const slides = await page.$$(".slide");
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: `${here}/preview/s${String(i + 1).padStart(2, "0")}.png` });
  }
  console.log(`preview: ${slides.length} slides`);
}

await page.pdf({ path: out, width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(out);
