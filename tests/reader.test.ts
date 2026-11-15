// reader.ts の正規化と flow.ts の手続き振り分けの単体テスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { toExtraction } from "../src/reader.ts";
import { resolveTargetName } from "../src/flow.ts";

test("toExtraction: 1要素だけの summary と sample でも3行の要約と空の fields を返す", () => {
  const out = toExtraction({
    noticeType: "新規適用届の記入例",
    documentKind: "sample",
    deadline: null,
    summary: ["新規適用届の記入例です。"],
    person: [],
  });
  assert.equal(out.noticeType, "新規適用届の記入例");
  assert.equal(out.deadline, null);
  assert.equal(out.summary.length, 3);
  assert.ok(out.summary.every((s) => s.length > 0));
  assert.equal(out.summary[0], "新規適用届の記入例です。");
  assert.equal(out.summary[1], "期限の記載はありません");
  assert.match(out.summary[2], /記入例/);
  assert.deepEqual(out.fields, {});
});

test("toExtraction: noticeType が null でも summary[0] が書類名なら補完する", () => {
  const out = toExtraction({
    noticeType: null,
    documentKind: "sample",
    deadline: "なし",
    summary: ["1行目: 健康保険・厚生年金保険 新規適用届の記入例"],
    person: [{ label: "氏名", value: "健保 一郎", sourceText: "健保 一郎", confidence: 0.9 }],
  });
  assert.equal(out.noticeType, "健康保険・厚生年金保険 新規適用届の記入例");
  assert.equal(out.deadline, null);
  assert.equal(out.summary.length, 3);
  assert.deepEqual(out.fields, {});
});

test("toExtraction: 書類でない画像（noticeType: null, summary: []）では noticeType を空にする", () => {
  const out = toExtraction({
    noticeType: null,
    documentKind: "other",
    deadline: null,
    summary: [],
    person: [],
  });
  assert.equal(out.noticeType, "");
});

test("resolveTargetName: 書類の種類に応じて検証用サイトの手続きを選ぶ", () => {
  assert.equal(
    resolveTargetName("水道料金・下水道使用料請求書"),
    "【ひばり野市】水道料金・下水道使用料の口座振替申込（検証用サイト）",
  );
  assert.equal(
    resolveTargetName("新規適用届の記入例"),
    "【ひばり野市】健康保険・厚生年金保険 新規適用届（検証用サイト）",
  );
  assert.equal(
    resolveTargetName("市民税のお知らせ"),
    "【ひばり野市】各種届出・申請のオンライン提出（検証用サイト）",
  );
});
