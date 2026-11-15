// 操作の1手。常駐ブラウザ（browser.mjs）に CDP でつなぎ、指示された操作をして、操作後の画面を返す。
//   node agent/act.mjs <base64(JSON {actions:[...], save?: "ファイル名"})>
// 画面は「[eN] 種類 "名前"」の行を含む文字の一覧（OpenMausBot の aria スナップショット + ref の方式）とスクリーンショットで返す。
// ref は DOM の data-gb-ref 属性に振るので、接続し直しても同じ画面の間は使える。画面が変わると振り直す。
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const { actions = [], save } = JSON.parse(Buffer.from(process.argv[2] ?? "e30=", "base64").toString("utf8"));
const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const TYPE_DELAY = Number(process.env.TYPE_DELAY_MS ?? 25);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP_PORT ?? "9222"}`);
const context = browser.contexts()[0];
// 操作の途中でタブが開いたり閉じたりする（別窓・自動で閉じる窓）ので、操作のたびに開いている最新のタブを選び直す
const livePage = () => context.pages().filter((p) => !p.isClosed() && !p.url().startsWith("devtools:")).at(-1);
let page = livePage();
if (!page) throw new Error("ブラウザに開いているタブがありません");
context.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
for (const p of context.pages()) p.on("dialog", (d) => d.accept().catch(() => {}));

const el = (ref) => page.locator(`[data-gb-ref="${ref}"]`).first();

async function settle() {
  await new Promise((r) => setTimeout(r, 400));
  page = livePage() ?? page;
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
  page = livePage() ?? page;
}

async function perform(a) {
  switch (a.action) {
    case "click":
      await el(a.ref).click({ timeout: 5_000 });
      return settle();
    case "fill": {
      const t = el(a.ref);
      if (await t.evaluate((e) => e.tagName === "SELECT", undefined, { timeout: 5_000 })) {
        await t.selectOption({ label: String(a.value) }, { timeout: 5_000 });
        return settle();
      }
      await t.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await t.fill("", { timeout: 5_000 });
      await t.pressSequentially(String(a.value ?? ""), { delay: TYPE_DELAY });
      return;
    }
    case "select":
      await el(a.ref).selectOption({ label: String(a.value) }, { timeout: 5_000 });
      return settle();
    case "check":
      // 見た目だけのラジオ（label role=radio）は check が効かないことがあるので、押して選ぶ
      await el(a.ref).check({ timeout: 5_000, force: true }).catch(() => el(a.ref).click({ timeout: 5_000 }));
      return;
    case "uncheck":
      await el(a.ref).uncheck({ timeout: 5_000, force: true });
      return;
    case "press":
      await page.keyboard.press(String(a.value));
      return settle();
    case "goto":
      await page.goto(String(a.value));
      return settle();
    case "scroll":
      await page.mouse.wheel(0, a.value === "up" ? -600 : 600);
      return;
    default:
      throw new Error(`知らない操作です: ${a.action}`);
  }
}

// 画面を文字にする。操作できる要素には ref を振り、それ以外は見えている文字を順に並べる
function snapshot() {
  const INTERACTIVE = "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[onclick],label[tabindex='0']";
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  document.querySelectorAll("[data-gb-ref]").forEach((e) => e.removeAttribute("data-gb-ref"));
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const visible = (e) => {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || e.type === "radio" || e.type === "checkbox";
  };
  // 申請サイトの入力欄は <dt>項目名</dt><dd>入力欄</dd> の形が多いので、label が無ければ dt を項目名にする
  const termOf = (e) => {
    let dt = e.closest("dd")?.previousElementSibling;
    while (dt && dt.tagName !== "DT") dt = dt.previousElementSibling;
    return clean(dt?.innerText).replace(/\s*必須$/, "");
  };
  // 要素自身の名前: 結び付いた <label> → aria-label → title → placeholder → ボタンの文字
  const ownName = (e) =>
    clean([...(e.labels ?? [])].map((l) => l.innerText).join(" ")) || clean(e.getAttribute("aria-label")) ||
    clean(e.getAttribute("title")) || clean(e.getAttribute("placeholder")) ||
    (["button", "submit", "reset"].includes(e.type) ? clean(e.value) : "") || clean(e.innerText).slice(0, 80);
  // 入力欄は所属する項目名（<dt>）を前に付ける（「年」「春」だけでは何の欄か分からないため）
  const nameOf = (e, isField) => {
    const own = ownName(e);
    const term = isField ? termOf(e) : "";
    return term && own && !own.includes(term) ? `${term} ＞ ${own}` : own || term;
  };
  // label と別に aria-label があるときは、入力例（「012-345-6789は0123456789と入力」など）なので書式の手がかりとして添える
  const hintOf = (e) => {
    const aria = clean(e.getAttribute("aria-label"));
    return aria && e.labels?.length && !ownName(e).includes(aria) ? aria : clean(e.getAttribute("placeholder"));
  };
  const FIELD_KINDS = new Set(["text", "tel", "email", "number", "password", "date", "search", "url", "textarea", "select", "radio", "checkbox"]);
  let n = 0;
  const out = [];
  let text = "";
  const flush = () => {
    if (text.trim()) out.push(clean(text).slice(0, 300)); // 利用規約などの長文は頭だけ
    text = "";
  };
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent + " ";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName.toUpperCase())) return;
    if (!visible(node) && !["radio", "checkbox"].includes(node.type)) return;
    if (node.matches(INTERACTIVE)) {
      flush();
      const ref = `e${++n}`;
      node.setAttribute("data-gb-ref", ref);
      const tag = node.tagName.toLowerCase();
      // ラジオ・チェックを包んだ label（role=radio など）は中身の種類として扱う
      const inner = tag === "label" ? node.querySelector("input[type=radio],input[type=checkbox]") : null;
      const kind = tag === "input" ? node.type : inner ? inner.type : node.getAttribute("role") ?? (tag === "a" ? "link" : tag === "label" ? "button" : tag);
      const isField = FIELD_KINDS.has(kind);
      let line = `[${ref}] ${kind} "${nameOf(node, isField)}"`;
      const hint = isField && hintOf(node);
      if (hint && !line.includes(hint)) line += ` hint="${hint}"`;
      if (tag === "select") line += ` options=${JSON.stringify([...node.options].map((o) => o.text.trim()))} selected="${node.selectedOptions[0]?.text.trim() ?? ""}"`;
      else if (["radio", "checkbox"].includes(kind)) line += (inner ?? node).checked || node.getAttribute("aria-checked") === "true" ? " (checked)" : "";
      else if (tag === "textarea" || (tag === "input" && !["button", "submit"].includes(node.type))) line += ` value="${node.value}"`;
      if (node.disabled) line += " (disabled)";
      out.push(line);
      return; // 中の文字は名前に含めた
    }
    const block = getComputedStyle(node).display !== "inline";
    if (block) flush();
    for (const c of node.childNodes) walk(c);
    if (block) flush();
  };
  walk(document.body);
  flush();
  return out.join("\n");
}

const results = [];
try {
  for (const a of actions) {
    try {
      await perform(a);
      results.push({ ok: true });
    } catch (err) {
      const msg = String(err?.message ?? err).split("\n")[0];
      results.push({ ok: false, error: /data-gb-ref/.test(msg) ? `${a.ref} が今の画面に見つかりません（画面が変わった可能性。新しい一覧から選び直す）` : msg });
      break; // 失敗したら残りはやらず、今の画面を見て決め直す
    }
  }
  await settle();
  let text;
  for (let i = 0; ; i++) {
    try {
      text = await page.evaluate(snapshot);
      break;
    } catch (err) {
      if (i >= 3) throw err; // 読み取り中に画面が移った（リダイレクトなど）ときは、落ち着いてから読み直す
      await settle();
    }
  }
  if (save) writeFileSync(join(WORK_DIR, save), text);
  // スクリーンショットは見せるためだけのもの。Web フォントの読み込みが終わらないページでは撮れないことがあるので、撮れなければ省く
  const screenshot = await page.screenshot({ type: "jpeg", quality: 50, timeout: 8_000 }).then((b) => b.toString("base64"), () => "");
  console.log("@@OBS@@" + JSON.stringify({ url: page.url(), title: await page.title(), text: text.slice(0, 12_000), screenshot, results }));
} finally {
  await browser.close().catch(() => {}); // CDP の切断だけ（ブラウザ自体は残る）
}
