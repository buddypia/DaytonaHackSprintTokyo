// fixtures/*.html を撮影してデモ用の書類画像を作る
//   notice.html → notice.png（介護保険の通知）
//   bill.html   → bill.png（水道料金の請求書。机の上で撮った写真風。検証用の申請サイトの手続きに対応）
import { chromium } from "playwright";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(import.meta.dirname, "..", "fixtures");
const browser = await chromium.launch();
for (const [name, selector, width] of [["notice", ".paper", 760], ["bill", ".scene", 1000]]) {
  const page = await browser.newPage({ viewport: { width, height: 1400 }, deviceScaleFactor: 1.5 });
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href);
  await page.locator(selector).screenshot({ path: join(dir, `${name}.png`) });
  await page.close();
  console.log(`fixtures/${name}.png を作成しました`);
}
await browser.close();
