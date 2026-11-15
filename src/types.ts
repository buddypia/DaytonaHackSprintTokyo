export type ExtractedField = { value: string; sourceText: string; confidence: number };

// 通知の読み取り結果（視覚モデルの出力）。fields は書類に書かれたご本人の情報（キーは項目名。例: "氏名"）
export type NoticeExtraction = {
  noticeType: string;
  deadline: string | null; // YYYY-MM-DD。期限の記載が無ければ null
  summary: [string, string, string]; // 何の通知か / いつまでに / 何をするか
  fields: Record<string, ExtractedField>;
};

// at は emit 時に付く時刻（裏側の画面で再生に使う）
export type RunEvent = { at?: number } & (
  | { type: "meta"; sandbox: string; reader: string; operator?: string; viewer?: string | null }
  | { type: "disposed"; text: string }
  | { type: "state"; state: string; text: string }
  | { type: "notice"; image: string }
  | { type: "explain"; noticeType: string; summary: [string, string, string]; deadline: string | null; sources: { label: string; sourceText: string }[] }
  | { type: "action"; text: string; screenshot?: string; agent?: "reader" | "mapper" | "sandbox" | "operator" }
  | { type: "question"; fieldName: string; label: string; text: string; choices: string[] | null; inputType: "text" | "radio"; hint: string | null; screenshot?: string }
  | { type: "answered"; fieldName: string }
  | { type: "confirm"; readout: string; screenshot?: string }
  | { type: "verify"; exitCode: number; output: string }
  | { type: "done"; receiptNo: string; verifyExitCode: number }
  | { type: "family"; text: string }
  | { type: "cancelled"; text: string }
  | { type: "error"; message: string });
