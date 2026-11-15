// 操作エージェントの決まりごと（コードで守る部分）を、台本どおりに答える偽のモデルと偽のブラウザで確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { operate, type Source } from "../src/operator.ts";
import type { Runner } from "../src/sandbox.ts";

const FORM = `申込\n[e9] checkbox "利用規約に同意する"\n[e8] checkbox "メールマガジンを受け取る"\n氏名\n[e1] text "氏名" value=""\n住所\n[e2] text "住所" value=""\n[e3] submit "確認へ進む"`;
const CONFIRM = `申込確認\n氏名 山田 花子\n[e4] submit "申込む"`;
const DONE = `申込完了\n整理番号 123456`;

// act.mjs の代わり。クリックで画面を進め、実行した操作を記録する
function fakeRunner() {
  const pages = [FORM, CONFIRM, DONE];
  let page = 0;
  const performed: { action: string; ref?: string; value?: string }[] = [];
  const runner = {
    label: "テスト",
    viewerUrl: null,
    async exec(cmd: string) {
      const { actions } = JSON.parse(Buffer.from(cmd.split(" ").pop()!, "base64").toString("utf8"));
      performed.push(...actions);
      if (actions.some((a: { action: string }) => a.action === "click")) page = Math.min(page + 1, pages.length - 1);
      const obs = { url: `https://example.lg.jp/p${page}`, title: ["申込", "申込確認", "申込完了"][page], text: pages[page], screenshot: "", results: actions.map(() => ({ ok: true })) };
      return { exitCode: 0, output: "@@OBS@@" + JSON.stringify(obs) };
    },
  } as unknown as Runner;
  return { runner, performed };
}

// 決めた順に返すモデル
function script(decisions: unknown[]) {
  let i = 0;
  return { label: "台本", chat: async () => JSON.stringify(decisions[Math.min(i++, decisions.length - 1)]) };
}

const sources: Record<string, Source> = { 氏名: { value: "山田 花子", origin: "書類" }, 住所: { value: "佐倉市1-2", origin: "書類" } };
const hooks = (approve: boolean, calls: string[]) => ({
  log() {},
  ask: async () => "春",
  confirm: async () => (calls.push("confirm"), approve),
});

test("出どころ（from）の無い入力は行わない", async () => {
  const { runner, performed } = fakeRunner();
  const calls: string[] = [];
  const r = await operate(runner, "テスト手続き", sources, hooks(false, calls), script([
    { actions: [{ action: "fill", ref: "e1", value: "山田 花子" }, { action: "fill", ref: "e2", value: "作った住所", from: "推測" }] },
    { actions: [{ action: "fail", reason: "終わり" }] },
  ])).catch((e) => e);
  assert.ok(r instanceof Error);
  assert.equal(performed.filter((a) => a.action === "fill").length, 0);
});

test("ご本人の情報を入れ忘れたままでは送信できず、入力か申告をすると承認に進む", async () => {
  const { runner, performed } = fakeRunner();
  const calls: string[] = [];
  const r = await operate(runner, "テスト手続き", sources, hooks(true, calls), script([
    { actions: [{ action: "fill", ref: "e1", value: "山田 花子", from: "氏名" }, { action: "click", ref: "e3" }] },
    { actions: [{ action: "submit", ref: "e4" }] }, // 住所が未入力・未申告 → 止められる
    { actions: [{ action: "not_applicable", label: "住所", reason: "欄が無い" }, { action: "submit", ref: "e4" }] },
    { actions: [{ action: "done", receiptNo: "123456" }] },
  ]));
  assert.equal(r.status, "submitted");
  assert.equal(calls.length, 1, "承認は申告のあとの1回だけ");
  assert.deepEqual(r.status === "submitted" && r.notApplicable, { 住所: "欄が無い" });
  assert.equal(r.status === "submitted" && r.receiptNo, "123456");
  assert.equal(performed.filter((a) => a.ref === "e4").length, 1);
});

test("ご本人が「いいえ」なら最後のボタンを押さない（click と言っても止める）", async () => {
  const { runner, performed } = fakeRunner();
  const calls: string[] = [];
  const r = await operate(runner, "テスト手続き", { 氏名: sources.氏名 }, hooks(false, calls), script([
    { actions: [{ action: "fill", ref: "e1", value: "山田 花子", from: "氏名" }, { action: "click", ref: "e3" }] },
    { actions: [{ action: "click", ref: "e4" }] },
  ]));
  assert.equal(r.status, "cancelled");
  assert.equal(calls.length, 1);
  assert.equal(performed.some((a) => a.ref === "e4"), false);
});

test("同意のチェックは出どころなしで押せるが、それ以外のチェックは出どころが要る", async () => {
  const { runner, performed } = fakeRunner();
  const r = await operate(runner, "テスト手続き", sources, hooks(false, []), script([
    { actions: [{ action: "check", ref: "e9" }, { action: "check", ref: "e8" }] },
    { actions: [{ action: "fail", reason: "終わり" }] },
  ])).catch((e) => e);
  assert.ok(r instanceof Error);
  assert.deepEqual(performed.filter((a) => a.action === "check").map((a) => a.ref), ["e9"]);
});
