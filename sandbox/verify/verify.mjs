// 検証スクリプト。モデルの判断は使わず、申請サイト自身が表示した画面と、エージェントの入力記録を突き合わせる。
//   expected.json     { entered: [{field, value, from}], sources: {項目名: {value, origin}}, notApplicable: {項目名: 理由}, receiptNo }
//   confirm-page.txt  送信直前の確認画面（サイトが受け取った内容）
//   done-page.txt     送信後の画面
//   site-received.json 検証用の申請サイトが実際に受け取った内容（検証用サイトのときだけある）
// すべて合格なら exit 0、1つでも不合格なら exit 1。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const read = (name) => (existsSync(join(WORK_DIR, name)) ? readFileSync(join(WORK_DIR, name), "utf8") : null);
const flat = (s) => String(s).normalize("NFKC").replace(/[\s-]/g, "");

const results = [];
const check = (ok, text) => results.push({ ok, text });

const { entered = [], sources = {}, notApplicable = {}, receiptNo = "" } = JSON.parse(read("expected.json") ?? "{}");
const confirmPage = read("confirm-page.txt");
const donePage = read("done-page.txt");

check(confirmPage != null, "送信前の確認画面を記録した");
check(entered.length > 0, `入力した欄がある（${entered.length} 件）`);
for (const { field, value, from } of entered) {
  const name = field.split(" ＞ ").pop();
  check(from in sources, `「${name}」の値「${value}」の出どころ: ${from in sources ? `${from}（${sources[from].origin}）` : `不明（${from}）`}`);
  check(confirmPage != null && flat(confirmPage).includes(flat(value)), `確認画面に「${name}」=「${value}」がある`);
}
// ご本人の情報は、入力したか「欄が無い」と申告したかのどちらか（入れ忘れが無い）
const used = new Set(entered.map((e) => e.from));
for (const [label, { origin }] of Object.entries(sources)) {
  if (used.has(label)) continue;
  check(label in notApplicable, label in notApplicable ? `「${label}」（${origin}）は欄が無いため未入力: ${notApplicable[label]}` : `「${label}」（${origin}）を入力していない`);
}
check(donePage != null && /完了|受け付け|受付|到達|ありがとう/.test(donePage), "送信後の画面が完了を示している");
if (receiptNo) check(donePage != null && flat(donePage).includes(flat(receiptNo)), `完了画面に番号「${receiptNo}」がある`);

// 検証用の申請サイトなら、サイトが実際に受け取った値にも、入力した値がすべて入っている
const received = read("site-received.json");
if (received) {
  const { receiptNo: no, values } = JSON.parse(received);
  const got = Object.values(values).map(flat);
  for (const { field, value } of entered) check(got.some((g) => g.includes(flat(value))), `申請サイトが受け取った内容に「${field.split(" ＞ ").pop()}」=「${value}」がある`);
  if (receiptNo) check(flat(no) === flat(receiptNo), `申請サイトが発行した受付番号と一致する（${no}）`);
}

for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.text}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `合格: ${results.length} 項目` : `不合格: ${failed} / ${results.length} 項目`);
process.exit(failed === 0 ? 0 : 1);
