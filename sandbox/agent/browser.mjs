// サンドボックス内で常駐するブラウザ。CDP（CDP_PORT）を開けておき、act.mjs が毎回つないで1手ずつ操作する。
// DISPLAY がある（Daytona の Computer Use / Docker デスクトップ）ときは画面に出して、操作をライブで見せる。
//   node agent/browser.mjs <最初に開く URL>
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.env.CDP_PORT ?? "9222";
const headed = Boolean(process.env.DISPLAY);
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "omakase-browser-")), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: !headed,
  locale: "ja-JP",
  viewport: headed ? null : { width: 1280, height: 800 },
  args: [`--remote-debugging-port=${port}`, "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800", "--start-maximized", "--lang=ja-JP", "--no-first-run", "--no-default-browser-check"],
});
// Web フォント（申請サイトは Noto Sans JP の分割ファイルを100本近く読む）は取りに行かず、マシンに入れた日本語フォントで表示する。
// 読み込みが数十秒速くなり、スクリーンショットがフォント待ちで止まらなくなる
await context.route(/\.(woff2?|ttf|otf)(\?|$)|fonts\.gstatic\.com/, (route) => route.abort());
const page = context.pages()[0] ?? (await context.newPage());
// 申請サイトの確認ダイアログ（「よろしいですか？」）は承認済みの操作の続きなので受ける
context.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
page.on("dialog", (d) => d.accept().catch(() => {}));
// 読み込みの遅いサイトでも常駐は続ける（goto の失敗で落ちるとブラウザごと閉じてしまう）。読み込みの完了は act.mjs が待つ
await page.goto(process.argv[2] ?? "about:blank", { waitUntil: "commit", timeout: 60_000 }).catch((err) => console.error(`最初のページを開けませんでした: ${err.message}`));
console.log("ready");
await new Promise(() => {});
