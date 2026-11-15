// 通しの確認（モデルと隔離マシンを実際に使うので、E2E=1 のときだけ実行する）:
// 見本の請求書 → 隔離マシンの中の検証用申請サイト（ひばり野市の口座振替申込）を操作 → 質問に回答 → 「はい」で送信 → 照合 exit 0
// 外のサイトには何も送らない。
// 「いいえ」の場合は確認画面で止まり、何も送信しない。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Run, runFlow } from "../src/flow.ts";
import type { RunEvent } from "../src/types.ts";

process.env.DISPOSE_DELAY_MS = "0";
const skip = process.env.E2E !== "1" && "モデルと隔離マシンを使うため E2E=1 を指定したときだけ実行する";
const notice = `data:image/png;base64,${readFileSync(join(import.meta.dirname, "..", "fixtures", "bill.png")).toString("base64")}`;
// ご本人役の回答（通帳を見て答える想定。架空の口座）
const reply = (label: string, choices: string[] | null) => choices?.find((c) => /ゆうちょ|普通/.test(c)) ?? choices?.[0] ?? (/口座番号|番号/.test(label) ? "1234567" : /支店|店名/.test(label) ? "〇一八" : "はい");

async function drive(ok: boolean) {
  const run = new Run();
  run.listeners.add((e: RunEvent) => {
    if (e.type === "question") setTimeout(() => run.answer(e.fieldName, reply(e.label, e.choices)), 0);
    if (e.type === "confirm") setTimeout(() => run.confirm(ok), 0);
  });
  await runFlow(run, notice);
  return run.events;
}

test("はい: 検証用の申請サイトで送信し、照合が exit 0", { timeout: 600_000, skip }, async () => {
  const events = await drive(true);
  assert.equal(events.find((e) => e.type === "error"), undefined, JSON.stringify(events.find((e) => e.type === "error")));
  assert.ok(events.some((e) => e.type === "confirm"));
  const done = events.find((e) => e.type === "done");
  assert.ok(done && done.type === "done" && done.verifyExitCode === 0);
  assert.match(done.receiptNo, /^\d+$/, "完了画面の受付番号");
  assert.ok(events.some((e) => e.type === "disposed"));
});

test("いいえ: 確認画面で止まり、何も送信しない", { timeout: 600_000, skip }, async () => {
  const events = await drive(false);
  assert.ok(events.some((e) => e.type === "cancelled"));
  assert.equal(events.find((e) => e.type === "done"), undefined);
});
