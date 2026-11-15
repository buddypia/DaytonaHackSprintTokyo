// 処理の流れ: 読む → 説明 → 隔離マシン準備（申請サイトを開く）→ エージェントが操作（質問を挟む）→ 本人の承認 → 送信 → 画面で照合 → 家族へ通知
import { randomUUID } from "node:crypto";
import { operate, operatorLabel, type Source } from "./operator.ts";
import { hasModel, MIN_CONFIDENCE, readNotice, readerLabel } from "./reader.ts";
import { createRunner, SANDBOX_SITE_URL, type Runner } from "./sandbox.ts";
import type { RunEvent } from "./types.ts";

export class Run {
  readonly id = randomUUID();
  readonly events: RunEvent[] = [];
  readonly listeners = new Set<(e: RunEvent) => void>();
  readonly answers: Record<string, string> = {};
  runner?: Runner;
  waitingFor: "answer" | "confirm" | null = null;
  pendingField: string | null = null;
  private resolveAnswer?: (value: string) => void;
  private resolveConfirm?: (ok: boolean) => void;

  readonly startedAt = Date.now();

  emit(event: RunEvent) {
    event = { ...event, at: Date.now() };
    this.events.push(event);
    for (const l of this.listeners) l(event);
    if (event.type !== "notice") console.log(`[${this.id.slice(0, 8)}] ${redact(JSON.stringify(event, (k, v) => (k === "screenshot" ? undefined : k === "viewer" && v ? "(画面の URL)" : v)))}`);
  }

  waitAnswer(fieldName: string) {
    this.pendingField = fieldName;
    this.waitingFor = "answer";
    return withTimeout(new Promise<string>((r) => (this.resolveAnswer = r)), "ご本人の回答");
  }

  waitConfirm() {
    this.waitingFor = "confirm";
    return withTimeout(new Promise<boolean>((r) => (this.resolveConfirm = r)), "ご本人の確認");
  }

  async answer(fieldName: string, value: string) {
    if (this.waitingFor !== "answer" || this.pendingField !== fieldName) throw new Error("いまはその質問を受け付けていません");
    this.waitingFor = null;
    this.answers[fieldName] = value;
    this.emit({ type: "answered", fieldName });
    this.resolveAnswer!(value);
  }

  async confirm(ok: boolean) {
    if (this.waitingFor !== "confirm") throw new Error("いまは確認を受け付けていません");
    this.waitingFor = null;
    this.resolveConfirm!(ok);
  }
}

// 返事が無いまま隔離マシンを使い続けないように、10分で打ち切る
function withTimeout<T>(p: Promise<T>, what: string) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}を10分待ちましたが返事がありませんでした`)), 10 * 60_000).unref())]);
}

// ログに残す前に、氏名以外の個人情報（数字の並び）を伏せる
export function redact(text: string) {
  return text.replace(/\d{4,}/g, (m) => m.slice(0, 2) + "＊".repeat(m.length - 2));
}

// 申請先: 既定は隔離マシンの中で起動する検証用の申請サイト（架空の「ひばり野市」の電子申請サイト。sandbox/site/server.mjs）。
// 実在のサイトに申し込みや契約を送らない。TARGET_URL を指定したときだけ外のサイトを開く
const TARGET_URL = process.env.TARGET_URL ?? SANDBOX_SITE_URL;
const IS_SANDBOX_SITE = TARGET_URL === SANDBOX_SITE_URL;
// ご家族の連絡先。申請先が連絡先メールアドレスを求めたときに使う（未設定ならエージェントがご本人に質問する）
const CONTACT_EMAIL = process.env.CONTACT_EMAIL;

export function resolveTargetName(noticeType: string): string {
  if (process.env.TARGET_NAME) return process.env.TARGET_NAME;
  if (!IS_SANDBOX_SITE) return "電子申請";
  if (/水道|下水|口座振替/.test(noticeType)) return "【ひばり野市】水道料金・下水道使用料の口座振替申込（検証用サイト）";
  if (/新規適用|健康保険|厚生年金|社会保険/.test(noticeType)) return "【ひばり野市】健康保険・厚生年金保険 新規適用届（検証用サイト）";
  if (/粗大ごみ|ごみ/.test(noticeType)) return "【ひばり野市】粗大ごみ収集の申込（検証用サイト）";
  if (/住民票/.test(noticeType)) return "【ひばり野市】住民票の写しの交付請求（郵送）（検証用サイト）";
  if (/学童|放課後児童/.test(noticeType)) return "【ひばり野市】放課後児童クラブ（学童保育）の利用申込（検証用サイト）";
  return "【ひばり野市】各種届出・申請のオンライン提出（検証用サイト）";
}

export async function runFlow(run: Run, imageDataUrl: string | null) {
  const state = (s: string, text: string) => run.emit({ type: "state", state: s, text });
  let runner: Runner | undefined;
  try {
    if (!hasModel) throw new Error("モデルが設定されていません（AI_PROVIDER=vertex か nosana を設定してください）");
    runner = createRunner();
    run.runner = runner;
    run.emit({ type: "meta", sandbox: runner.label, reader: readerLabel, operator: operatorLabel });

    state("READING", "通知を読んでいます");
    const extraction = await readNotice(imageDataUrl);
    const targetName = resolveTargetName(extraction.noticeType);
    run.emit({
      type: "explain",
      noticeType: extraction.noticeType,
      summary: extraction.summary,
      deadline: extraction.deadline,
      sources: Object.entries(extraction.fields).map(([label, f]) => ({ label, sourceText: f.sourceText })),
    });

    state("SANDBOX_READY", "隔離マシンを準備しています");
    const t0 = Date.now();
    await runner.setup(TARGET_URL);
    run.emit({ type: "meta", sandbox: runner.label, reader: readerLabel, operator: operatorLabel, viewer: runner.viewerUrl });
    run.emit({ type: "action", text: `${runner.label} のブラウザで、${IS_SANDBOX_SITE ? "マシン内に立ち上げた検証用の申請サイト" : "電子申請システム"}「${targetName}」を開きました（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`, agent: "sandbox" });

    state("FILLING", "電子申請サイトを操作しています");
    const sources: Record<string, Source> = Object.fromEntries(
      Object.entries(extraction.fields).filter(([, f]) => f.confidence >= MIN_CONFIDENCE).map(([k, f]) => [k, { value: f.value, origin: "書類" }]),
    );
    if (CONTACT_EMAIL) sources["連絡先メールアドレス（ご家族）"] = { value: CONTACT_EMAIL, origin: "ご家族の設定" };
    const result = await operate(runner, targetName, sources, {
      log: (text, screenshot) => run.emit({ type: "action", text, screenshot, agent: "operator" }),
      async ask(q, screenshot) {
        state("ASKING", "ご本人に質問しています");
        run.emit({ type: "question", fieldName: q.label, label: q.label, text: q.text, choices: q.choices, inputType: q.choices ? "radio" : "text", hint: q.hint ?? null, screenshot });
        const value = await run.waitAnswer(q.label);
        state("FILLING", "電子申請サイトを操作しています");
        return value;
      },
      async confirm(summary, screenshot) {
        state("CONFIRMING", "送信前の確認");
        run.emit({ type: "confirm", readout: readout(targetName, summary), screenshot });
        return run.waitConfirm();
      },
    });
    if (result.status === "cancelled") {
      run.emit({ type: "cancelled", text: "ご本人が「いいえ」を選んだため、何も送信せずに終了しました" });
      return;
    }

    state("VERIFYING", "送信内容を申請サイトの画面と照合しています");
    const { status: _, ...expected } = result;
    await runner.writeFile("expected.json", JSON.stringify(expected));
    const v = await runner.exec("node verify/verify.mjs", 60);
    const receiptNo = result.receiptNo || "申込完了（番号の発行が無い手続き）";
    run.emit({ type: "verify", exitCode: v.exitCode, output: v.output.trim() });
    run.emit({ type: "done", receiptNo, verifyExitCode: v.exitCode });

    const nameValue = Object.entries(result.sources).find(([k]) => /氏名|名前/.test(k))?.[1].value;
    const who = nameValue ? `${nameValue}さん` : "ご本人";
    run.emit({
      type: "family",
      text: v.exitCode === 0
        ? `${who}の「${targetName}」を電子申請しました。番号 ${receiptNo}。入力した値はすべて書類かご本人の回答から取ったもので、申請サイトの確認画面で受け付けられたことを確かめました。`
        : `${who}の「${targetName}」を送信しましたが、照合で不一致がありました。内容をご確認ください（番号 ${receiptNo}）。`,
    });
    state("DONE", "完了");
  } catch (err) {
    run.emit({ type: "error", message: (err as Error).message });
  } finally {
    run.waitingFor = null;
    if (runner) {
      if (runner.viewerUrl) await new Promise((r) => setTimeout(r, Number(process.env.DISPOSE_DELAY_MS ?? 8000))); // 結果の画面を見せてから破棄する
      await runner.dispose();
      run.emit({ type: "disposed", text: `${runner.label} を破棄しました` });
    }
  }
}

function readout(procedure: string, summary: { label: string; value: string }[]) {
  const items = summary.map((e) => `${e.label}は「${e.value}」`).join("、");
  return `「${procedure}」を、この内容で申し込みます。${items ? items + "。" : ""}よろしいですか？`;
}
