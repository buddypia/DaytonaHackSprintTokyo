// 書類（通知・記入例・様式など何でも）を読み、何の書類か・期限・ご本人の情報を取り出す。モデルの呼び出し先は ai.ts のプロバイダーで切り替える。
// 読めなかったときは、別の通知の値で進めないよう止める。
import { createChatModel } from "./ai.ts";
import type { NoticeExtraction } from "./types.ts";

export const MIN_CONFIDENCE = 0.8;
const model = createChatModel();

export const readerLabel = model?.label ?? "モデル未設定";
export const hasModel = model != null;

function parseJson<T>(text: string): T {
  const body = text.match(/\{[\s\S]*\}/)?.[0];
  if (!body) throw new Error("モデルの出力に JSON がありません");
  return JSON.parse(body) as T;
}

const EXTRACT_PROMPT = `あなたは、役所・会社・学校などの書類を読み解き、お年寄りの代わりに手続きを進める係です。
画像は通知・案内・請求書・申請書・届出書の記入例・空欄の様式など、どんな書類でもかまいません。次の JSON だけを出力します。
{"noticeType":"書類の種類（例: 介護保険負担割合証の更新のお知らせ）","documentKind":"notice|sample|blank_form|other",
 "deadline":"YYYY-MM-DD または null","summary":["何の書類か(40字以内)","いつまでに(40字以内)","何をするか(40字以内)"],
 "person":[{"label":"項目名（氏名・フリガナ・生年月日・住所・郵便番号・電話番号・お客様番号・被保険者番号 など）","value":"書類に書かれた本人の値（敬称の「様」「殿」は除く）",
   "sourceText":"書類上の原文","confidence":0.0}]}
ルール:
- summary は必ず3要素の文字列配列（何の書類か・いつまでに・何をするか）にする。記入例（sample）や空欄の様式（blank_form）でも必ず3要素すべて埋める（期限が無ければ2要素目は「期限の記載はありません」にする）。1要素にまとめない。
- person には、書類に書かれている「ご本人（宛名の人）」の情報をすべて、書類の順に入れる。宛名にカタカナの読み（フリガナ）が添えられていれば、氏名とは1つにまとめず必ず別の項目 {"label":"フリガナ","value":"..."} として出す。お客様番号・被保険者番号などの番号も入れる。申請先の手続きで使うかどうかは考えない。
- 氏名の value から敬称（様・殿）は除く。
- 役所・担当窓口・問い合わせ先の住所や電話番号は person に入れない。
- value は書類に書かれている値だけ。推測で作らない。読めない項目は入れない。
- documentKind は、ご本人宛ての通知・請求書なら notice、架空の記入例・見本なら sample（このとき person は空にする）、未記入の空欄様式なら blank_form。
- 日付は YYYY-MM-DD。和暦は西暦に直す（令和N年 = 2018+N年、平成N年 = 1988+N年、昭和N年 = 1925+N年）。
- 期限が書かれていなければ deadline は null。画像が書類でない・読めない場合は noticeType を null にする。`;

type RawPerson = { label?: unknown; value?: unknown; sourceText?: unknown; confidence?: unknown };
type RawExtraction = Omit<NoticeExtraction, "fields" | "noticeType" | "summary"> & {
  noticeType?: unknown;
  summary?: unknown;
  documentKind?: string;
  person?: RawPerson[];
};

const str = (v: unknown) => (typeof v === "string" && v.trim() && v !== "null" ? v.trim() : null);

function normalizeSummaryList(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\r?\n|(?<=。)/)
      : raw && typeof raw === "object"
        ? Object.values(raw)
        : [];
  return items
    .map((s) =>
      String(s ?? "")
        .trim()
        .replace(/^(?:\d+行目\s*[:：]\s*|[\d]+[.．)）]\s*|[-・•]\s*)+/, "")
        .trim(),
    )
    .filter(Boolean);
}

// モデルの出力を整える。同じ項目名は最初のものだけ使う
export function toExtraction(raw: RawExtraction): NoticeExtraction {
  const fields: NoticeExtraction["fields"] = {};
  if (raw.documentKind !== "sample") {
    for (const p of raw.person ?? []) {
      const label = str(p.label);
      let value = str(p.value);
      if (label && value && /氏名|名前/.test(label)) value = value.replace(/\s*(様|殿)$/, "").trim() || null;
      if (!label || !value || label in fields) continue;
      fields[label] = { value, sourceText: str(p.sourceText) ?? value, confidence: Number(p.confidence ?? 0) };
    }
    if (!Object.keys(fields).some((k) => /フリガナ|カナ/.test(k))) {
      for (const [label, f] of Object.entries(fields)) {
        if (!/氏名|名前/.test(label)) continue;
        const kanaLine = f.sourceText.match(/^([ァ-ヶー]+(?:[ \t\u3000]+[ァ-ヶー]+)*)$/m)?.[1]?.trim();
        if (kanaLine) {
          fields["フリガナ"] = { value: kanaLine, sourceText: kanaLine, confidence: f.confidence };
          break;
        }
      }
    }
  }
  const cleaned = normalizeSummaryList(raw.summary);
  let noticeType = str(raw.noticeType);
  if ((!noticeType || noticeType === "不明") && cleaned[0] && /通知|請求|申請|届|証|案内|申込|記入例|様式/.test(cleaned[0])) {
    noticeType = cleaned[0].slice(0, 40);
  }
  const rawDeadline = str(raw.deadline);
  const deadline = rawDeadline && !/^(なし|記載なし|不明)$/.test(rawDeadline) ? rawDeadline : null;
  const s0 = cleaned[0] ?? `${noticeType ?? "書類"}です`;
  const s1 = cleaned[1] ?? (deadline ? `期限は ${deadline} です` : "期限の記載はありません");
  const s2 =
    cleaned.length >= 3
      ? cleaned.slice(2).join(" ").slice(0, 60)
      : raw.documentKind === "sample"
        ? "記入例（書き方の見本）を参考に、電子申請で届け出ます"
        : raw.documentKind === "blank_form"
          ? "必要事項を入力して届出・申請を行います"
          : "内容を確認して手続きを進めます";
  return { noticeType: noticeType ?? "", deadline, summary: [s0, s1, s2], fields };
}

export async function readNotice(imageDataUrl: string | null): Promise<NoticeExtraction> {
  if (!model) throw new Error("モデルが設定されていません");
  if (!imageDataUrl) throw new Error("書類の画像がありません");
  const out = parseJson<RawExtraction>(
    await model.chat([
      { type: "text", text: EXTRACT_PROMPT },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ]),
  );
  const extraction = toExtraction(out);
  if (!extraction.noticeType || extraction.noticeType === "不明") {
    throw new Error("写真から書類を読み取れませんでした。書類の全体が明るく写るように撮り直してください");
  }
  return extraction;
}
