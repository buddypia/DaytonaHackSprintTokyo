// 操作エージェント。サンドボックス内の本物のブラウザの画面（[eN] 付きの文字）を読み、次の操作をモデルに決めさせて1手ずつ進める。
// 画面の読み方と ref 指定の操作は OpenMausBot（Apache-2.0）のブラウザ操作の考え方に倣った。
// コードで守ること:
//   - 入力する値には出どころ（from: ご本人の情報の項目名）が必要。出どころの無い値は入力しない（推測で埋めさせない）
//   - ご本人の情報は、すべて入力するか「該当する欄が無い」と理由付きで申告するまで送信させない（入れ忘れを防ぐ）
//   - 利用規約への同意のチェックだけは、ご本人の情報ではないので出どころなしで押せる
//   - 最後の申込ボタンは、モデルが submit と言っても click と言っても、本人の承認を取ってから押す
import { createChatModel, type ChatModel } from "./ai.ts";
import type { Runner } from "./sandbox.ts";

const defaultModel = createChatModel(process.env.OPERATOR_AI_PROVIDER);
export const operatorLabel = defaultModel?.label ?? "モデル未設定";

export type Observation = { url: string; title: string; text: string; screenshot: string; results: { ok: boolean; error?: string }[] };
type BrowserAction = { action: "fill" | "select" | "check" | "uncheck" | "click" | "press" | "scroll"; ref?: string; value?: string; from?: string };
type Action =
  | BrowserAction
  | { action: "ask"; label: string; question: string; choices?: string[] | null }
  | { action: "not_applicable"; label: string; reason: string }
  | { action: "submit"; ref: string }
  | { action: "done"; receiptNo?: string }
  | { action: "fail"; reason: string };
type Decision = { thought?: string; actions?: Action[] };

export type Source = { value: string; origin: string }; // origin: 書類 / ご本人の回答 / ご家族の設定
export type Entered = { field: string; value: string; from: string };
export type OperateResult =
  | { status: "submitted"; receiptNo: string; entered: Entered[]; sources: Record<string, Source>; notApplicable: Record<string, string> }
  | { status: "cancelled" };

export interface OperatorHooks {
  log(text: string, screenshot?: string): void;
  ask(q: { label: string; text: string; choices: string[] | null; hint?: string | null }, screenshot: string): Promise<string>;
  confirm(summary: { label: string; value: string }[], screenshot: string): Promise<boolean>;
}

const MAX_TURNS = Number(process.env.OPERATOR_MAX_TURNS ?? 30);
const MAX_QUESTIONS = 3;
const INPUT_ACTIONS = new Set(["fill", "select", "check", "uncheck"]);
const BROWSER_ACTIONS = new Set(["fill", "select", "check", "uncheck", "click", "press", "scroll"]);
// 最後の申込ボタンらしい名前。「申し込む方はこちら」のような案内リンクは除く
const FINAL_BUTTON = /申込む|申し込む|申請する|送信する|^送信$|提出する|この内容で/;
const NOT_FINAL = /こちら|方は|一覧|戻る|保存/;
// 利用規約などへの同意のチェック。ご本人の情報ではないので、出どころ（from）が無くても押してよい（入力記録には入れない）
const CONSENT = /同意/;

export async function act(runner: Runner, actions: BrowserAction[], save?: string): Promise<Observation> {
  const arg = Buffer.from(JSON.stringify({ actions, save })).toString("base64");
  const t = Date.now();
  const r = await runner.exec(`node agent/act.mjs ${arg}`, 120);
  if (process.env.OPERATOR_DEBUG) console.error(`[operator] ブラウザ ${Date.now() - t}ms: ${actions.map((a) => a.action).join(",") || "観察"}`);
  const line = r.output.split("\n").find((l) => l.startsWith("@@OBS@@"));
  if (!line) throw new Error(`ブラウザを操作できませんでした: ${r.output.match(/^(\w*Error.*)$/m)?.[1] ?? r.output.slice(-300)}`);
  return JSON.parse(line.slice("@@OBS@@".length));
}

// 画面の一覧から ref の行を引く（例: [e12] submit "申込む"）
function element(obs: Observation, ref?: string) {
  const m = ref && obs.text.match(new RegExp(`^\\[${ref}\\] (\\S+) "([^"]*)"`, "m"));
  return m ? { kind: m[1], name: m[2] } : null;
}

// 質問対象の項目に対応するフォーム上の入力例（hint="例: ..."）を抽出する
function hintFor(obs: Observation, label: string): string | null {
  let fallback: string | null = null;
  for (const line of obs.text.split("\n")) {
    const m = line.match(/^\[e\d+\]\s+\S+\s+"([^"]*)"(?:.*?\bhint="([^"]*)")?/);
    if (!m?.[2]) continue;
    const [, name, rawHint] = m;
    const ex = rawHint.match(/例\s*[:：）]\s*([^、。（()）]+)/)?.[1]?.trim() || null;
    if (!ex) continue;
    if (name === label) return ex;
    if (!fallback && (name.includes(label) || label.includes(name))) fallback = ex;
  }
  return fallback;
}

function parseJson<T>(text: string): T {
  const body = text.match(/\{[\s\S]*\}/)?.[0];
  if (!body) throw new Error("モデルの出力に JSON がありません");
  return JSON.parse(body) as T;
}

function prompt(procedure: string, sources: Record<string, Source>, unresolved: string[], history: string[], obs: Observation, questionsLeft: number) {
  return `あなたは、お年寄りの代わりに行政の電子申請サイトをブラウザで操作する係です。いま隔離されたマシンの中の本物のブラウザを操作しています。
目的: 「${procedure}」を最後まで申し込み、完了画面の番号（整理番号・受付番号・到達番号など）を得る。

ご本人の情報（項目名: 値。個人情報はこれ以外を使わない）:
${Object.entries(sources).map(([k, s]) => `- ${k}: ${s.value}`).join("\n")}
まだ入力も申告もしていない項目: ${unresolved.join("、") || "なし"}

これまでの操作:
${history.slice(-20).join("\n") || "（まだ無し）"}

いまの画面: ${obs.title}（${obs.url}）
${obs.text}

画面の [eN] は操作できる要素です（hint は入力例）。次に行う操作を JSON だけで出力してください。
{"thought":"今の状況と次にすること（1文）","actions":[操作, ...]}
操作:
- {"action":"fill","ref":"eN","value":"文字","from":"使ったご本人の情報の項目名"} 文字欄に入力
- {"action":"select","ref":"eN","value":"選択肢の文字","from":"項目名"} 選択欄
- {"action":"check","ref":"eN","from":"項目名"} / {"action":"uncheck","ref":"eN","from":"項目名"} ラジオボタン・チェックボックス
- {"action":"click","ref":"eN"} ボタン・リンク（画面が変わるので actions の最後に1つだけ）
- {"action":"ask","label":"項目名","question":"やさしい言葉の質問","choices":["選択肢", ...] または null} ご本人に聞く（これだけを単独で出す）
- {"action":"not_applicable","label":"ご本人の情報の項目名","reason":"この手続きに該当する欄が無い理由"} 入力する欄が本当に無い項目を申告する
- {"action":"submit","ref":"eN"} 最後の申込・送信ボタン（押す前にご本人の承認を取る。単独で出す）
- {"action":"done","receiptNo":"完了画面に出ている番号（無ければ空文字）"} 申込の完了画面が出たとき
- {"action":"fail","reason":"理由"} どうしても続けられないとき
ルール:
- 入力・選択の操作には必ず from（値の出どころになったご本人の情報の項目名）を付ける。from に無い値は入力できない。推測で値を作らない。
- 形式は画面の指示・hint に合わせて直してよい（電話番号・お客様番号・口座番号などのハイフンを除く、西暦を和暦に直す（昭和N年=1925+N年、平成N年=1988+N年）、氏名を氏と名に分ける など）。
- ご本人の情報は、対応する欄があればすべて入力する（必須でなくても）。欄が無いものだけ not_applicable で申告する。「まだ入力も申告もしていない項目」が残っていると送信できない。
- 同じ画面の入力欄は1回でまとめて埋め、最後に「確認へ進む」などの click を1つ置く。
- ご本人の情報に無く、ご本人にしか分からない項目（好み・意向・どれを選ぶか・口座など）は、任意の欄でも ask で聞いてから埋める。質問は1回に1項目で、複数の欄をまとめて聞かない（label は画面の欄の名前）。選択欄・ラジオなら choices に画面の選択肢をそのまま入れる。最初から選ばれている欄は、そのままでよければ聞かない。残りの質問回数: ${questionsLeft}。0 なら聞かずに、必須でなければ空のままにする。
- 「ご本人の情報」にすでにある項目は絶対に ask で聞き直さず、そのまま fill や select で入力する（口座名義のフリガナ欄も、ご本人の情報にフリガナがあれば from:"フリガナ" で入力してよい）。
- 感想・ご意見などの自由記述欄、郵便番号が分からない欄は空のままにする。必須の欄は必ず埋める。
- トップページや手続き一覧なら、目的の手続きのリンク（または検索）を開く。お知らせ・よくある質問など関係ないページには寄り道しない。
- ログインや利用者登録はしない（「利用者登録せずに申し込む」を選ぶ）。手続きの説明・利用規約への同意は進めてよい。
- 確認画面で内容を確かめたら、最後の申込・送信ボタンは必ず submit で押す。
- 入力エラーが表示されたら、その指示に従って直す。前の操作が失敗していたら、いまの画面の ref で選び直す。`;
}

export async function operate(runner: Runner, procedure: string, initial: Record<string, Source>, hooks: OperatorHooks, model: ChatModel | null = defaultModel): Promise<OperateResult> {
  if (!model) throw new Error("実際のサイトを操作するにはモデルが必要です（AI_PROVIDER=vertex か nosana を設定してください）");
  const sources: Record<string, Source> = { ...initial };
  const entered = new Map<string, Entered>(); // 画面と欄の名前ごと（同じ欄を入れ直したら上書き）
  const notApplicable: Record<string, string> = {};
  const history: string[] = [];
  let questions = 0;
  const maxQuestions = Object.keys(initial).length === 0 ? 6 : MAX_QUESTIONS;
  const unresolved = () => {
    const used = new Set([...entered.values()].map((e) => e.from));
    return Object.keys(sources).filter((k) => !used.has(k) && !(k in notApplicable));
  };

  let obs = await act(runner, []);
  hooks.log(`「${obs.title}」を開きました`, obs.screenshot);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const t = Date.now();
    const raw = await model.chat(prompt(procedure, sources, unresolved(), history, obs, maxQuestions - questions));
    let decision: Decision;
    try {
      decision = parseJson<Decision>(raw);
    } catch {
      if (process.env.OPERATOR_DEBUG) console.error(`[operator] モデル ${Date.now() - t}ms JSONパース失敗: ${raw.slice(0, 200)}`);
      history.push("（前の応答が JSON ではなかった。必ず {\"thought\":\"...\",\"actions\":[...]} の JSON だけを出力する）");
      continue;
    }
    if (process.env.OPERATOR_DEBUG) console.error(`[operator] モデル ${Date.now() - t}ms: ${decision.thought ?? ""}`);
    const rawActions = decision.actions ?? [];
    const redundantAsks = rawActions.filter((a): a is Extract<Action, { action: "ask" }> => a.action === "ask" && a.label in sources);
    const actions = rawActions.filter((a) => !(a.action === "ask" && a.label in sources));
    if (redundantAsks.length && actions.length === 0) {
      for (const a of redundantAsks) {
        history.push(`項目「${a.label}」はすでに「${sources[a.label].value}」と分かっているので再質問しない。from:"${a.label}" を付けて入力・選択する`);
      }
      continue;
    }
    const first = actions[0];
    if (!first) {
      history.push("（操作が出力されなかった）");
      continue;
    }

    if (first.action === "fail") throw new Error(`手続きを続けられませんでした: ${first.reason}`);
    if (first.action === "done") {
      return { status: "submitted", receiptNo: first.receiptNo ?? "", entered: [...entered.values()], sources, notApplicable };
    }

    if (first.action === "ask") {
      if (questions >= maxQuestions) {
        history.push(`質問「${first.question}」は回数切れで聞かなかった。必須でなければ空のままにする`);
        continue;
      }
      questions++;
      const choices = first.choices?.length ? first.choices : null;
      const hint = choices ? null : hintFor(obs, first.label);
      const value = await hooks.ask({ label: first.label, text: first.question, choices, hint }, obs.screenshot);
      sources[first.label] = { value, origin: "ご本人の回答" };
      history.push(`ご本人に「${first.question}」と聞き、「${value}」と答えてもらった（項目名「${first.label}」）`);
      continue;
    }

    for (const a of actions) {
      if (a.action === "not_applicable" && a.label in sources) {
        notApplicable[a.label] = a.reason;
        history.push(`「${a.label}」は入力する欄が無いと申告した（${a.reason}）`);
      }
    }

    const finalClick = actions.find(
      (a): a is { action: "submit" | "click"; ref: string } =>
        a.action === "submit" || (a.action === "click" && FINAL_BUTTON.test(element(obs, a.ref)?.name ?? "") && !NOT_FINAL.test(element(obs, a.ref)?.name ?? "")),
    );
    if (finalClick) {
      const missing = unresolved();
      if (missing.length) {
        history.push(`送信しようとしたが、ご本人の情報「${missing.join("、")}」が未入力で申告も無い。戻って入力するか、欄が無ければ not_applicable で申告する`);
        continue;
      }
      await act(runner, [], "confirm-page.txt"); // 照合用に、送る直前の確認画面を残す
      if (!(await hooks.confirm(summarize(entered), obs.screenshot))) {
        history.push("ご本人が送信を断った");
        return { status: "cancelled" };
      }
      const name = element(obs, finalClick.ref)?.name ?? "申込";
      obs = await act(runner, [{ action: "click", ref: finalClick.ref }], "done-page.txt");
      hooks.log(`ご本人の承認を受けて「${name}」を押しました`, obs.screenshot);
      history.push(`ご本人の承認を受けて「${name}」を押した → ${obs.title}`);
      continue;
    }

    // 出どころの無い入力は行わない
    const lines: string[] = [];
    const runnable = actions.filter((a): a is BrowserAction => {
      if (!BROWSER_ACTIONS.has(a.action)) return false;
      const b = a as BrowserAction;
      const el = element(obs, b.ref);
      const isInput = INPUT_ACTIONS.has(b.action) || (b.action === "click" && /^(radio|checkbox)$/.test(el?.kind ?? ""));
      const consent = el?.kind === "checkbox" && CONSENT.test(el.name) && b.action !== "fill" && b.action !== "select";
      if (consent) delete b.from;
      if (isInput && !consent && !(b.from && b.from in sources)) {
        lines.push(`「${element(obs, b.ref)?.name ?? b.ref}」への入力は出どころ（from）がご本人の情報に無いので行わなかった`);
        return false;
      }
      return true;
    });
    const before = obs;
    obs = await act(runner, runnable);
    runnable.forEach((a, i) => {
      const r = obs.results[i];
      if (!r) return;
      const el = element(before, a.ref);
      const field = el?.name || a.ref || "";
      const isChoice = /^(radio|checkbox)$/.test(el?.kind ?? "");
      const what = a.action === "fill" ? `「${field}」に「${a.value}」を入力`
        : a.action === "select" ? `「${field}」で「${a.value}」を選択`
        : a.action === "check" ? `「${field}」を選択`
        : a.action === "uncheck" ? `「${field}」の選択を外した`
        : a.action === "click" ? `「${field}」を押した`
        : `${a.action} ${a.value ?? ""}`;
      lines.push(r.ok ? what : `${what} → 失敗: ${r.error}`);
      if (!r.ok || !a.from) return; // 同意のチェックなど、ご本人の情報でない操作は入力記録に入れない
      const key = `${new URL(before.url).pathname}|${field}`;
      const choice = field.split(" ＞ ").pop()!;
      if (a.action === "fill" || a.action === "select") entered.set(key, { field, value: String(a.value), from: a.from! });
      else if (a.action === "check" || (a.action === "click" && isChoice)) entered.set(key, { field, value: choice, from: a.from! });
      else if (a.action === "uncheck") entered.delete(key);
    });
    history.push(...lines, `→ 画面: ${obs.title}`);
    hooks.log(lines.join(" / ") || (decision.thought ?? "画面を確認しました"), obs.screenshot);
  }
  throw new Error(`${MAX_TURNS} 手で手続きが終わりませんでした`);
}

// 確認の読み上げ用に、出どころ（ご本人の情報の項目名）ごとに入力値をまとめる（例: 生年月日「昭和 23 4 12」）
function summarize(entered: Map<string, Entered>) {
  const byFrom = new Map<string, string[]>();
  for (const e of entered.values()) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e.value]);
  return [...byFrom].map(([label, values]) => ({ label, value: values.join(" ") }));
}
