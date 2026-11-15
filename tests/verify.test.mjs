// 検証スクリプト単体: 申請サイトの確認画面に入力値がすべてあり、完了画面が出ていれば exit 0。欠落・不一致・未完了で exit 1
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERIFY = join(import.meta.dirname, "..", "sandbox", "verify", "verify.mjs");
const entered = [{ field: "氏", value: "山田", from: "氏名" }, { field: "電話番号", value: "0123456789", from: "電話番号" }, { field: "好きな季節 ＞ 春", value: "春", from: "好きな季節" }];
const sources = { 氏名: { value: "山田 花子", origin: "書類" }, 電話番号: { value: "0123-45-6789", origin: "書類" }, 好きな季節: { value: "春", origin: "ご本人の回答" }, 被保険者番号: { value: "0012345678", origin: "書類" } };
const notApplicable = { 被保険者番号: "欄が無い" };
const confirmPage = "申込確認\n氏：\n山田\n電話番号\n0123 456 789\n好きな季節\n春\n[e9] submit \"申込む\"";
const donePage = "申込完了\n【佐倉市】電子申請 体験の申請が完了しました。";

function run({ confirm = confirmPage, done = donePage, receiptNo = "", na = notApplicable, list = entered, received = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-test-"));
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ entered: list, sources, notApplicable: na, receiptNo }));
  if (confirm != null) writeFileSync(join(dir, "confirm-page.txt"), confirm);
  if (done != null) writeFileSync(join(dir, "done-page.txt"), done);
  if (received) writeFileSync(join(dir, "site-received.json"), JSON.stringify(received));
  return spawnSync(process.execPath, [VERIFY], { env: { ...process.env, WORK_DIR: dir }, encoding: "utf8" });
}

test("確認画面に全項目があり完了画面なら exit 0", () => assert.equal(run().status, 0, run().stdout));
test("確認画面が無ければ exit 1", () => assert.equal(run({ confirm: null }).status, 1));
test("入力値が確認画面に無ければ exit 1", () => assert.equal(run({ confirm: confirmPage.replace("春", "夏") }).status, 1));
test("完了画面でなければ exit 1", () => assert.equal(run({ done: "入力内容にエラーがあります" }).status, 1));
test("報告した番号が完了画面に無ければ exit 1", () => assert.equal(run({ receiptNo: "12345" }).status, 1));
test("報告した番号が完了画面にあれば exit 0", () => assert.equal(run({ done: donePage + "\n整理番号 12345", receiptNo: "12345" }).status, 0));
test("書類の情報を入力も申告もしていなければ exit 1", () => assert.equal(run({ na: {} }).status, 1));
test("出どころの無い値があれば exit 1", () => assert.equal(run({ list: [...entered, { field: "住所", value: "山田", from: "推測" }] }).status, 1));

// 検証用の申請サイトが受け取った内容との照合
const got = { receiptNo: "12345", values: { sei: "山田", tel: "0123456789", season: "春" } };
test("検証用サイトが全項目を受け取っていれば exit 0", () => assert.equal(run({ done: donePage + "\n受付番号 12345", receiptNo: "12345", received: got }).status, 0));
test("検証用サイトが受け取っていない値があれば exit 1", () => assert.equal(run({ received: { ...got, values: { sei: "山田", tel: "0123456789" } } }).status, 1));
test("受付番号が検証用サイトの発行したものと違えば exit 1", () => assert.equal(run({ done: donePage + "\n受付番号 99999", receiptNo: "99999", received: got }).status, 1));
