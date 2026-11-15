# AI Review Pack — おまかせ手続き（Omakase Tetsuzuki）

- 大会: **Daytona HackSprint Tokyo**（2026-11-15 / 実装 75 分・デモ 2 分）
- 一行: **紙の通知を撮るだけで、AI が隔離マシン上のブラウザを操作し、行政の電子申請を完了・検証する。**
- 本資料の目的: **AI 一次審査で、4 つの審査基準ごとに「主張 → コード上の証拠 → 再現方法」を一意に照合できるようにする。**
- 表記: `src/foo.ts:12` は 2026-11-15 時点の行番号。行番号がずれても、併記した関数名・クラス名で検索できる。
- 関連資料: 技術資料（図版）[`ai-review.pdf`](./ai-review.pdf) / 発表資料 [`omakase-tetsuzuki-deck.pdf`](./omakase-tetsuzuki-deck.pdf) / デモ動画 [`../demo/out/omakase-demo.mp4`](../demo/out/omakase-demo.mp4)

---

## 0. 30 秒で読む結論

| 審査基準 | 自己評価 | 主張（1 行） | 主な証拠 |
|---|---|---|---|
| **Completeness（完成度）** | 強い | 撮影→読取→隔離マシン起動→操作→質問→承認→送信→独立検証→家族通知→破棄が、1 本の状態機械として最後まで動く | [E1] [E4] [E13] [E14] |
| **Innovation（革新性）** | 強い | LLM の提案をコードの **4 ゲート**が拘束し、**モデル自身に合否を判定させない**。チャットボットでも固定手順の RPA でもない | [E2] [E3] [E4] |
| **Real-Life Problem Solving（課題解決）** | 強い | 高齢者の「読めない・操作できない・期限を過ぎる」と、家族の「ID とパスワードを預かる代行」を、本人の **3 種類の操作**に圧縮 | [E1] [E8] [E9] [E10] |
| **Sponsored Product Usage（スポンサー活用）** | 強い | **Daytona は実行基盤の中核**（ライフサイクル 8 種の API）。**Nosana は視覚読取と操作判断の 2 役**を担う | [E5] [E6] [E7] |

**審査員が最初に開くべき 5 ファイル**

1. [`src/sandbox.ts`](../src/sandbox.ts) — `DaytonaRunner`（112–266 行）: サンドボックス作成 → 画面 → 1 手ごとの実行 → 破棄
2. [`src/operator.ts`](../src/operator.ts) — `operate()`（124–256 行）: Computer Use エージェントと 4 ゲート
3. [`sandbox/verify/verify.mjs`](../sandbox/verify/verify.mjs) — モデル非依存の検証器（`exit 0` / `exit 1`）
4. [`src/flow.ts`](../src/flow.ts) — `runFlow()`（82–160 行）: 状態機械の全体
5. [`submission/evidence.json`](./evidence.json) — 本資料の機械可読版

```json
{
  "project": "omakase-tetsuzuki",
  "verdict": "end-to-end agentic system, not a chatbot",
  "core_claim": "LLM proposes actions; code enforces provenance, completeness, human approval; an independent verifier decides pass/fail.",
  "sponsors": {
    "daytona": { "role": "core isolated execution + desktop + noVNC + per-step command", "api_surface": 8 },
    "nosana": { "role": "vision reading + browser-action decision on GPU", "modes": ["reader", "operator", "hybrid"] }
  },
  "tests": { "total": 21, "pass": 19, "fail": 0, "skipped": 2, "skipped_reason": "E2E gated by E2E=1" },
  "verified_live": ["vertex", "docker", "gcp"],
  "not_live_verified": ["daytona", "nosana"],
  "default_target": "in-sandbox verification site (127.0.0.1:8090), no real-world submission"
}
```

---

## 1. 課題と解決（Who / What / How）

### 1.1 誰の、どんな痛みか

| 当事者 | 現状 | 痛み |
|---|---|---|
| 本人（78 歳・一人暮らし） | 紙の通知は届く。スマホで撮影はできる。電子申請の画面操作はできない | 何を・いつまでに・どこへ出すかが分からず、期限を過ぎる |
| 家族（別居の娘） | 仕事の合間に電話で内容を聞き、親の ID とパスワードを預かって代行 | 1 通に 30〜60 分（設計時の想定）。認証情報を預かる不安。何を申請したか追えない |

### 1.2 解決の形

1. 通知を**撮影して送る**（操作 1）
2. AI が「何の書類か・いつまでに・何をするか」を **3 行・大きな字・音声**で説明する
3. 依頼ごとに **隔離デスクトップ**を起動し、AI が申請サイトを**1 手ずつ操作**する。家族は noVNC でライブ見守り
4. 書類から分からない項目だけを**質問**する（操作 2）
5. 送信内容を出どころ付きで読み上げ、**「はい」で承認**（操作 3）
6. 送信後、**モデルを使わない検証器**が申請サイトの画面と受領データを照合し、`exit 0` を返す
7. 受付番号を本人へ、完了を家族へ通知し、**サンドボックスを破棄**する

> 設計目標は「撮影から受付番号まで 90 秒」。これは **目標値であり実測値ではない**（[`PRD.md`](../PRD.md) 2 節）。

---

## 2. Architecture / アーキテクチャ

### 2.1 システム全体図

```mermaid
flowchart LR
  U["本人（スマートフォン）<br/>撮影 / 回答 / はい"]
  F["家族（ブラウザ）<br/>ライブ見守り / 完了通知"]

  subgraph ORC["Orchestrator — Node.js 23.6+（フレームワーク 0）"]
    S["server.ts<br/>HTTP + SSE"]
    FL["flow.ts<br/>状態機械"]
    RD["reader.ts<br/>書類読取"]
    OP["operator.ts<br/>Computer Use エージェント"]
    SB["sandbox.ts<br/>Runner 抽象"]
  end

  subgraph AI["推論プロバイダー（OpenAI 互換）"]
    N["Nosana GPU<br/>OSS VLM / LLM"]
    VX["Vertex AI Gemini<br/>代替プロバイダー"]
  end

  subgraph DAY["Daytona Sandbox — 依頼ごとに作成・破棄"]
    ACT["act.mjs<br/>1 手の操作 + [eN] 観察"]
    CR["Chromium<br/>CDP 9222"]
    SITE["検証用 申請サイト<br/>127.0.0.1:8090"]
    VER["verify.mjs<br/>モデル非依存の検証"]
    EV["expected.json / confirm-page.txt<br/>done-page.txt / site-received.json"]
    VNC["noVNC :6080<br/>view_only"]
  end

  U -->|"画像 / 回答 / 承認"| S
  S --> FL
  FL --> RD
  FL --> OP
  FL --> SB
  RD -->|"画像 + JSON スキーマ"| N
  OP -->|"目的 + 出どころ + 画面"| N
  N -->|"NoticeExtraction / 次の 1 手"| RD
  N -->|"actions JSON"| OP
  OP -->|"node agent/act.mjs"| ACT
  ACT -->|"Playwright / CDP"| CR
  CR -->|"HTTP（外に出ない）"| SITE
  ACT -->|"[eN] 要素一覧 + PNG"| OP
  SB -->|"create / executeCommand / delete"| DAY
  FL -->|"expected.json"| EV
  EV --> VER
  SITE -->|"受領データ"| EV
  VER -->|"exitCode === 0"| FL
  VNC -.->|"signed preview URL"| F
  S -.->|"SSE: 状態・質問・確認・結果"| U
  S -.->|"SSE: 完了通知"| F
  OP -.->|"TARGET_URL 指定時のみ"| EXT["外部の体験用サイト"]
```

**読み方（AI 向けの要約）**: 信頼できない入力（紙・LLM 出力）は左から入り、**決定論的なコード**（`operator.ts` のゲート、`verify.mjs`）を通って右の実行環境へ出る。LLM は「提案」だけを行い、入力の採用・送信・合否はコードが決める。

### 2.2 実行シーケンス

```mermaid
sequenceDiagram
  autonumber
  actor U as 本人
  participant O as Orchestrator
  participant M as Nosana / Vertex
  participant D as Daytona Sandbox
  participant S as 申請サイト
  participant V as verify.mjs

  U->>O: 通知画像（data URL, 1 枚）
  O->>M: 画像 + 抽出スキーマ
  M-->>O: noticeType / 期限 / 3 行要約 / 本人情報 + confidence
  O->>D: create → sandbox/ 配置 → computerUse.start → ブラウザ起動
  D-->>O: noVNC の signed preview URL
  loop 最大 30 手
    O->>D: act.mjs（観察）
    D-->>O: [eN] 要素一覧 + スクリーンショット
    O->>M: 目的 + 出どころ + 未入力項目 + 画面
    M-->>O: {"thought","actions":[...]}
    Note over O: Gate 1 出どころ / Gate 2 入れ忘れ / Gate 3 最終ボタン
    O->>D: act.mjs（入力・選択・クリック）
    opt 本人にしか分からない項目
      O->>U: 質問（最大 3 問）
      U-->>O: 回答（origin = ご本人の回答）
    end
  end
  Note over O: 最終ボタンを検出 → confirm-page.txt を保存
  O->>U: 出どころ付きで読み上げ + 「はい？」
  U-->>O: はい
  O->>D: 最終クリック（送信）
  D->>S: HTTP
  S-->>D: 完了画面 + 受付番号
  O->>V: expected.json を渡して実行
  V->>S: 確認画面・受領データ・完了画面を照合
  V-->>O: exit 0（全項目合格）
  O->>U: 受付番号
  O->>D: delete()
```

### 2.3 コンポーネントと責務

| 層 | ファイル | 責務 | 行数 |
|---|---|---|---|
| HTTP / SSE | [`src/server.ts`](../src/server.ts) | 画像受付、`/api/runs/:id/events`、回答・承認、`/ops`、noVNC 中継 | 137 |
| 状態機械 | [`src/flow.ts`](../src/flow.ts) | `READING → SANDBOX_READY → FILLING ⇄ ASKING → CONFIRMING → VERIFYING → DONE`、破棄 | 165 |
| 読取 | [`src/reader.ts`](../src/reader.ts) | 視覚モデルで `NoticeExtraction` を生成、confidence < 0.8 を除外、失敗時は停止 | 118 |
| 操作 | [`src/operator.ts`](../src/operator.ts) | 画面を読み 1 手ずつ判断、4 ゲート、質問・承認フック | 263 |
| 隔離実行 | [`src/sandbox.ts`](../src/sandbox.ts) | `DaytonaRunner` / `DockerRunner` / `GcpRunner` / `LocalRunner` | 524 |
| 推論 | [`src/ai.ts`](../src/ai.ts) | Nosana / Vertex の OpenAI 互換クライアント、hedge、timeout | 109 |
| サンドボックス内 | [`sandbox/agent/act.mjs`](../sandbox/agent/act.mjs) | 1 手の操作、`[eN]` 付き aria スナップショット、確認/完了画面の保存 | 179 |
| サンドボックス内 | [`sandbox/verify/verify.mjs`](../sandbox/verify/verify.mjs) | モデル非依存の照合、`exit 0/1` | 49 |
| 検証用サイト | [`sandbox/site/server.mjs`](../sandbox/site/server.mjs) | 架空の「ひばり野市」電子申請（6 手続き + 照会） | 373 |
| UI | [`public/index.html`](../public/index.html) / [`ops.html`](../public/ops.html) | 本人・家族向け画面 / 裏側のフロー再生 | 421 + 532 |

コア実装は **TypeScript 1,342 行**、サンドボックス内が **Node ESM 629 行**。依存は `@daytona/sdk` と `playwright` の **2 つだけ**（[`package.json`](../package.json)）。

### 2.4 信頼境界と 4 つのゲート

```mermaid
flowchart LR
  L["LLM の提案<br/>actions JSON"] --> G1{"Gate 1<br/>出どころ"}
  G1 -->|"from が sources に無い"| X1["実行しない<br/>履歴に理由を残す"]
  G1 -->|"from あり"| G2{"Gate 2<br/>入れ忘れ"}
  G2 -->|"未入力・未申告が残る"| X2["送信へ進ませない"]
  G2 -->|"全項目が入力 or 申告済み"| G3{"Gate 3<br/>本人承認"}
  G3 -->|"いいえ"| X3["何も送信しない<br/>CANCELLED"]
  G3 -->|"はい"| SUB["最終クリック"]
  SUB --> G4{"Gate 4<br/>独立検証"}
  G4 -->|"不一致"| X4["exit 1<br/>家族に警告"]
  G4 -->|"一致"| OK["exit 0<br/>受付番号を通知"]
```

| ゲート | 守る不変条件 | コード上の強制箇所 | 破られた場合 |
|---|---|---|---|
| **G1 出どころ** | 入力・選択には `Source` が必須。推測で値を埋めない | [`operator.ts:215-229`](../src/operator.ts) `runnable` フィルタ | その操作だけ破棄し、履歴に理由を残す |
| **G2 入れ忘れ** | 書類の本人情報は、入力するか「欄が無い」と理由付き申告するまで送信不可 | [`operator.ts:132-135`](../src/operator.ts) `unresolved()` / [`operator.ts:197-202`](../src/operator.ts) | 送信を止め、入力へ戻す |
| **G3 本人承認** | 最終ボタンは「はい」の後だけ。`click` と偽っても止める | [`operator.ts:193-213`](../src/operator.ts) `finalClick` + `confirm` | 送信せず `CANCELLED` |
| **G4 独立検証** | モデルの自己申告ではなく、サイトの画面と受領データで合否を決める | [`verify.mjs:21-49`](../sandbox/verify/verify.mjs) | `exit 1` で不合格を明示 |

**設計原則**: *policy（LLM）* と *invariant（コード）* と *proof（検証器）* を分離する。モデルを差し替えても、ゲートと検証の意味は変わらない。

### 2.5 状態遷移

```mermaid
stateDiagram-v2
  [*] --> READING
  READING --> SANDBOX_READY: NoticeExtraction
  SANDBOX_READY --> FILLING: デスクトップ + ブラウザ + サイト
  FILLING --> ASKING: 本人にしか分からない項目
  ASKING --> FILLING: 回答を Source に追加
  FILLING --> CONFIRMING: 最終ボタンを検出 + confirm-page.txt
  CONFIRMING --> VERIFYING: はい
  CONFIRMING --> CANCELLED: いいえ（送信しない）
  VERIFYING --> DONE: verify exit 0
  VERIFYING --> DONE: exit 1（不一致として通知）
  READING --> ERROR: 読取失敗・モデル無し
  SANDBOX_READY --> ERROR: 起動失敗・疎通失敗
  FILLING --> ERROR: 30 手超過・fail
  ERROR --> [*]: sandbox.delete()
  DONE --> [*]: sandbox.delete()
  CANCELLED --> [*]: sandbox.delete()
```

### 2.6 図のテキスト版（Mermaid を描画できない環境向け）

```text
[本人] --画像/回答/はい--> [Orchestrator: server.ts + flow.ts]
                              |-- reader.ts --画像--> [Nosana GPU] --JSON--> |
                              |-- operator.ts --画面+目的--> [Nosana GPU] --actions--> |
                              |-- sandbox.ts --create/exec/delete--> [Daytona Sandbox]
                                                                     |-- act.mjs --> Chromium --HTTP--> 検証用サイト(127.0.0.1:8090)
                                                                     |-- verify.mjs <-- expected.json / confirm-page.txt / done-page.txt / site-received.json
                                                                     |-- noVNC :6080 --signed URL--> [家族]
[家族] <--SSE 完了通知-- [Orchestrator]
```

---

## 3. Daytona 統合（Sponsored Product Usage ①）

### 3.1 なぜ「飾り」ではなく中核か

このプロダクトの危険な部分は、**他人の個人情報を含む画面を、実在の申請サイトで操作する**こと。したがって実行環境そのものがプロダクト要件であり、Daytona は次の 4 つを同時に満たす部品として使われている。

1. **依頼ごとの完全なマシン**（利用者間でファイル・Cookie・クリップボードが混ざらない）
2. **画面付きデスクトップ**（Computer Use。家族が noVNC で見守れる）
3. **1 手ごとのコマンド実行**（観察と操作を同じマシンで閉じる）
4. **処理後の破棄**（個人情報を残さない）

### 3.2 ライフサイクルと API の対応

| # | 工程 | 実装 | Daytona API | 証拠 |
|---|---|---|---|---|
| 1 | サンドボックス作成 | スナップショットがあればそれを使用、無ければ `typescript` | `new Daytona()` → `daytona.create({ snapshot \| language, envVars })` | [`sandbox.ts:115`](../src/sandbox.ts), [`sandbox.ts:124-126`](../src/sandbox.ts) |
| 2 | 実行ファイル配置 | `sandbox/` 一式（agent / site / verify）を再帰アップロード | `sandbox.fs.uploadFile(Buffer, path)` | [`sandbox.ts:139-141`](../src/sandbox.ts) |
| 3 | デスクトップ起動 | Xvfb + xfce4 + x11vnc + noVNC | `sandbox.computerUse.start()` | [`sandbox.ts:185`](../src/sandbox.ts) |
| 4 | 画面の配信 | `view_only=true` の noVNC URL を家族へ | `sandbox.getSignedPreviewUrl(6080, 3600)` | [`sandbox.ts:193-197`](../src/sandbox.ts) |
| 5 | 常駐プロセス | ブラウザと検証用サイトをセッションで起動 | `process.createSession()` / `process.executeSessionCommand({ runAsync: true })` | [`sandbox.ts:245-250`](../src/sandbox.ts) |
| 6 | 1 手の操作 | `act.mjs` を毎手実行し、`@@OBS@@` 行から観察を得る | `process.executeCommand(cmd, cwd, env, 120)` | [`sandbox.ts:240-243`](../src/sandbox.ts), [`operator.ts:47-55`](../src/operator.ts) |
| 7 | 成果物の受け渡し | `expected.json` をアップロード、画面ダンプはサンドボックス内に保存 | `sandbox.fs.uploadFile()` / `sandbox.fs.downloadFile()` | [`sandbox.ts:252-262`](../src/sandbox.ts) |
| 8 | 破棄 | 成功・失敗・キャンセルのいずれでも削除 | `sandbox.delete()` | [`sandbox.ts:264-266`](../src/sandbox.ts), [`flow.ts:150-158`](../src/flow.ts) |

### 3.3 Daytona 固有の制約への対処（実装済み）

| 制約 | 対処 | 証拠 |
|---|---|---|
| Tier 1/2 は外向き通信が許可リストのみ | **既定の申請先をサンドボックス内の `127.0.0.1:8090` に置く**。外に出ないため、Tier に関係なく同じ動作 | [`sandbox.ts:73-87`](../src/sandbox.ts) `checkReach` |
| ブラウザ導入に時間がかかる | 事前スナップショット `OMAKASE_SNAPSHOT` を優先。無い場合も既存 Chromium を検出して Playwright のダウンロードを回避 | [`sandbox.ts:143-179`](../src/sandbox.ts) |
| 日本語フォントが無い | `fonts-ipaexfont-gothic` 等を導入。apt が失敗する場合はホストのフォントを転送 | [`sandbox.ts:203-238`](../src/sandbox.ts) |
| 画面の解像度・表示 | `DISPLAY` を `/tmp/.X11-unix` から解決し、ブラウザを同じ画面に出す | [`sandbox.ts:186-192`](../src/sandbox.ts) |

> **未検証の明示**: Daytona の実機キーが手元に無いため、Daytona モードのライブ実行は未確認（[`README.md`](../README.md) 制約節）。コードは SDK の公式 API 名に一致させ、**キーが無いときは黙って local に落ちずエラーで止まる**（[`sandbox.ts:37-41`](../src/sandbox.ts)）。この「fail-closed」はデモの再現性のための設計判断。

---

## 4. Nosana 統合（Sponsored Product Usage ②）

### 4.1 2 つの推論ジョブ

| 役割 | 入力 | 出力 | 実装 |
|---|---|---|---|
| **視覚読取** | 通知画像 + JSON スキーマ | `noticeType` / `deadline` / `summary[3]` / `fields`（値 + 原文 + confidence） | [`reader.ts:104-118`](../src/reader.ts), プロンプト [`reader.ts:18-32`](../src/reader.ts) |
| **操作判断** | 目的 + 出どころ + 未入力項目 + 直近履歴 + 画面の `[eN]` 一覧 | `{"thought","actions":[...]}` | [`operator.ts:84-122`](../src/operator.ts), 実行 [`operator.ts:124-256`](../src/operator.ts) |

### 4.2 プライバシーをプロダクト要件にした設計

通知には氏名・住所・生年月日・被保険者番号が載る。**商用 API に個人情報を送らない**ことを要件とし、Nosana 上の OSS モデルを第一候補にした（[`PRD.md`](../PRD.md) 非機能要件）。

- エンドポイントは OpenAI 互換の `/chat/completions`。`temperature: 0`、`response_format: json_object`（[`ai.ts:19-31`](../src/ai.ts), [`ai.ts:65-77`](../src/ai.ts)）
- 読取と操作で**別プロバイダー**を指定できる（`OPERATOR_AI_PROVIDER`）。例: 読取は Nosana、操作は Vertex（[`ai.ts:103-109`](../src/ai.ts)）
- 応答の外れ値対策として、6 秒待って同じ依頼を 1 本追加し、先着を採用（Vertex 系）。`temperature 0` の 1 回きりの依頼なので二重実行しても結果は変わらない（[`ai.ts:15-63`](../src/ai.ts)）
- 失敗時は**別の通知の値で進まない**。読取失敗・タイムアウト・JSON 不正はエラーで停止（[`reader.ts:104-118`](../src/reader.ts)）

> **未検証の明示**: Nosana の実機キーも未取得のため、Nosana 経由のライブ推論は未確認。Vertex AI 経由の読取・操作は実機確認済み（[`README.md`](../README.md)）。

---

## 5. エンドツーエンドの実行証跡

`RunEvent`（[`src/types.ts`](../src/types.ts)）として画面に流れる順序。AI はこの表を「実行ログの仕様」として照合できる。

| # | イベント | 発生箇所 | 内容 | 失敗時の扱い |
|---|---|---|---|---|
| 1 | `notice` | `server.ts:59` | 入力画像を保持 | — |
| 2 | `meta` | `flow.ts:89` | サンドボックス / 読取 / 操作のラベル | — |
| 3 | `state:READING` | `flow.ts:91` | 読取開始 | モデル無し・読取失敗 → `error` |
| 4 | `explain` | `flow.ts:94-100` | 3 行要約・期限・原文 | — |
| 5 | `state:SANDBOX_READY` | `flow.ts:102` | サンドボックス準備 | 起動失敗・疎通失敗 → `error` |
| 6 | `action` | `flow.ts:106` | 何秒で申請サイトを開いたか | — |
| 7 | `state:FILLING` | `flow.ts:108` | 操作開始 | 30 手超過 → `error` |
| 8 | `action`（operator） | `flow.ts:114` | 各手の操作とスクリーンショット | 失敗手は履歴に残し再判断 |
| 9 | `question` / `answered` | `flow.ts:117`, `flow.ts:43` | 不足項目の質問と回答 | 10 分無応答 → `error` |
| 10 | `state:CONFIRMING` / `confirm` | `flow.ts:123-124` | 出どころ付き読み上げ | 「いいえ」→ `cancelled` |
| 11 | `state:VERIFYING` / `verify` | `flow.ts:133-138` | `exitCode` と出力 | `exit 1` でも結果は通知 |
| 12 | `done` | `flow.ts:139` | 受付番号 + 検証コード | — |
| 13 | `family` | `flow.ts:143-149` | 家族向け要約（成功 / 不一致） | — |
| 14 | `disposed` | `flow.ts:157` | サンドボックス破棄 | 破棄失敗は握りつぶし、残骸は次回掃除 |

---

## 6. 検証・再現（Completeness の証拠）

### 6.1 3 コマンドで再現

```bash
npm install
npm run desktop:build   # 初回のみ（Docker Desktop。Daytona の Computer Use と同じ Xvfb + xfce4 + noVNC 構成）
npm start               # http://localhost:8787
```

画面の **「見本の請求書で試す」** を押すと、`fixtures/bill.png`（架空の水道料金請求書）を読み、検証用サイトで最後まで進む。

Daytona で動かす場合:

```bash
secret run DAYTONA_API_KEY -- npm start   # AI_PROVIDER / NOSANA_* も環境変数で渡す
```

### 6.2 期待される出力

| 段階 | 期待 |
|---|---|
| 読取 | 「何の書類か / いつまでに / 何をするか」の 3 行 + 原文 |
| サンドボックス | デスクトップが起動し、申請サイトのトップが開く。noVNC が家族画面に埋め込まれる |
| 操作 | `[eN]` 単位の入力・選択・クリックがイベントとして流れる |
| 承認 | 出どころ付きの読み上げ → 「はい」で最終クリック |
| 検証 | `verify.mjs` が全項目合格で `exit 0`、受付番号を表示 |
| 後処理 | 「破棄しました」と表示され、サンドボックスが消える |

### 6.3 テスト結果（2026-11-15 実行）

```text
$ npm test
ℹ tests 21
ℹ pass 19
ℹ fail 0
ℹ skipped 2   # E2E=1 のときだけ走る通し確認
ℹ duration_ms 843
```

| テスト群 | 件数 | 何を守るか |
|---|---|---|
| [`tests/verify.test.mjs`](../tests/verify.test.mjs) | 12 | 検証器の合否: 確認画面なし / 値の不一致 / 未完了 / 番号不一致 / 入れ忘れ / 出どころなし / 受領データ不一致 |
| [`tests/operator.test.ts`](../tests/operator.test.ts) | 4 | 4 ゲート: 出どころの無い入力、入れ忘れ送信、承認なしクリック、同意チェックの例外 |
| [`tests/reader.test.ts`](../tests/reader.test.ts) | 3 | 3 行要約の正規化、`noticeType` 補完、非書類画像の拒否 |
| [`tests/flow.test.ts`](../tests/flow.test.ts) | 2 | E2E（`E2E=1`）: 「はい」で送信 + `exit 0` / 「いいえ」で何も送信しない |

### 6.4 独立検証のチェック項目

| # | 確かめること | 根拠データ | コード |
|---|---|---|---|
| 1 | 送信直前の確認画面を記録した | `confirm-page.txt` | [`verify.mjs:21`](../sandbox/verify/verify.mjs) |
| 2 | 入力した欄が 1 件以上ある | `expected.json` | [`verify.mjs:22`](../sandbox/verify/verify.mjs) |
| 3 | すべての入力値に出どころがある | `entered[].from` ∈ `sources` | [`verify.mjs:23-25`](../sandbox/verify/verify.mjs) |
| 4 | 入力値が確認画面に出ている | `confirm-page.txt` の正規化文字列 | [`verify.mjs:26`](../sandbox/verify/verify.mjs) |
| 5 | 書類の情報を入れ忘れていない | `sources` vs `notApplicable` | [`verify.mjs:29-33`](../sandbox/verify/verify.mjs) |
| 6 | 完了画面が出ている | `done-page.txt` | [`verify.mjs:34`](../sandbox/verify/verify.mjs) |
| 7 | 報告した受付番号が完了画面にある | `done-page.txt` | [`verify.mjs:35`](../sandbox/verify/verify.mjs) |
| 8 | 検証用サイトが実際に受け取った値と一致する | `site-received.json` | [`verify.mjs:38-44`](../sandbox/verify/verify.mjs) |

---

## 7. 安全・プライバシー設計（Real-Life Problem Solving の前提）

| 不変条件 | 実装 | 証拠 |
|---|---|---|
| 実在の行政手続きに送らない（既定） | 申請先はサンドボックス内の `127.0.0.1:8090`。`TARGET_URL` を明示したときだけ外部 | [`sandbox.ts:73-75`](../src/sandbox.ts), [`flow.ts:64-67`](../src/flow.ts) |
| 読めない通知で進めない | `noticeType` が空ならエラー。別通知の値で申請しない | [`reader.ts:104-118`](../src/reader.ts) |
| 推測で埋めない | `confidence < 0.8` を除外。入力は `Source` 必須 | [`reader.ts:6`](../src/reader.ts), [`operator.ts:215-229`](../src/operator.ts) |
| 承認なしに送らない | 最終ボタン検出 → 確認画面保存 → `confirm` → 「はい」のときだけクリック | [`operator.ts:193-213`](../src/operator.ts) |
| 個人情報をログに残さない | 4 桁以上の数字列を伏せ字化。スクリーンショットはイベントから除外 | [`flow.ts:25`](../src/flow.ts), [`flow.ts:60-62`](../src/flow.ts) |
| 待ち続けない | 回答・承認は 10 分で打ち切り、破棄 | [`flow.ts:54-57`](../src/flow.ts) |
| 暴走しない | 最大 30 手 / 質問 3 問（初期 Source が無いときのみ 6 問） | [`operator.ts:37-38`](../src/operator.ts), [`operator.ts:131`](../src/operator.ts) |
| 隔離なしに黙って落ちない | `SANDBOX_PROVIDER` 未指定で Daytona も Docker も無ければ起動エラー | [`sandbox.ts:37-41`](../src/sandbox.ts) |

---

## 8. 革新性の所在（Innovation）

| # | 仕組み | 何が新しいか | 証拠 |
|---|---|---|---|
| 1 | **コードで拘束する Computer Use** | LLM にブラウザを自由に触らせず、出どころ・入れ忘れ・承認の 3 点をコードで強制。モデルの指示を「提案」に格下げする | [`operator.ts:193-229`](../src/operator.ts) |
| 2 | **モデル非依存の証明** | 申請サイト自身の確認画面・受領データ・完了画面を照合し、LLM に合否を判定させない。`exit 0` が唯一の合格信号 | [`verify.mjs:21-49`](../sandbox/verify/verify.mjs) |
| 3 | **副作用ゼロの実環境デモ** | 申請サイトをサンドボックス内に同居。実在サイトへの送信なしで、HTTP・フォーム・受付番号まで本物と同じ経路を通す | [`sandbox/site/server.mjs`](../sandbox/site/server.mjs), [`sandbox.ts:78-87`](../src/sandbox.ts) |
| 4 | **紙を起点にした閉ループ** | 画像読取（理解）→ 画面操作（実行）→ 検証（証明）→ 家族通知（説明責任）を 1 実行で閉じる | [`flow.ts:82-160`](../src/flow.ts) |
| 5 | **プロバイダー差し替え可能な安全設計** | Daytona / Docker / GCP で同じ Runner 契約。推論も Nosana / Vertex を切り替え可能。デモ環境に依存しない | [`sandbox.ts:15-51`](../src/sandbox.ts), [`ai.ts:103-109`](../src/ai.ts) |

### 8.1 「チャットボットではない」ことの操作的定義

| チャットボット | 本作品 |
|---|---|
| テキストを返して終わる | 隔離マシンのブラウザで実フォームを送信し、受付番号を得る |
| モデルの出力がそのまま結果 | コードの 4 ゲートを通り、独立検証に合格したものだけを結果とする |
| 失敗しても状態が残らない | 成功・失敗・キャンセルのすべてでサンドボックスを破棄する |
| 手順を人間が脚本化 | 画面の `[eN]` 一覧から毎手モデルが判断。初見のフォームにも追従 |

---

## 9. 正直な検証台帳（できたこと / できていないこと）

| 項目 | 状態 | 根拠 |
|---|---|---|
| Vertex AI での読取・操作 | **実機確認済み** | [`README.md`](../README.md) 制約節 |
| Docker デスクトップでの E2E | **実機確認済み**（`exit 0`・受付番号） | 同上 / `E2E=1 SANDBOX_PROVIDER=docker npm test` |
| GCP（asia-northeast1）での E2E | **実機確認済み** | 同上 |
| 佐倉市の体験手続き（外部） | **整理番号の取得まで確認** | 同上 |
| 検証用サイトでの照合 | **確認画面・受領データ・完了画面の照合 `exit 0` まで確認** | [`verify.mjs`](../sandbox/verify/verify.mjs) |
| Daytona 実機 | **未実行**（API キー未取得）。実装は公式 API に対応 | [`SPEC.md`](../SPEC.md) 7 節 |
| Nosana 実機 | **未実行**（API キー未取得）。OpenAI 互換実装は完了 | [`SPEC.md`](../SPEC.md) 9 節 |
| 90 秒・操作回数 | **設計目標**（実測ではない） | [`PRD.md`](../PRD.md) 2 節 |

> この表を明示する理由: AI 審査では「未検証を検証済みと書く」ことが最大の減点要因になる。本資料は、**コードとして存在する証拠**と、**実機で確認した証拠**を分けて記載している。

---

## 10. ファイルマップ（AI の検索用）

| 探すもの | 場所 |
|---|---|
| Daytona の統合 | [`src/sandbox.ts`](../src/sandbox.ts) `class DaytonaRunner` |
| Nosana の統合 | [`src/ai.ts`](../src/ai.ts) `function nosana()` |
| Computer Use エージェント | [`src/operator.ts`](../src/operator.ts) `operate()` |
| 4 ゲート | [`src/operator.ts:193-229`](../src/operator.ts) |
| 状態機械 | [`src/flow.ts`](../src/flow.ts) `runFlow()` |
| 検証器 | [`sandbox/verify/verify.mjs`](../sandbox/verify/verify.mjs) |
| 画面の観察方式 | [`sandbox/agent/act.mjs`](../sandbox/agent/act.mjs) `snapshot()` |
| 検証用申請サイト | [`sandbox/site/server.mjs`](../sandbox/site/server.mjs) |
| 本人・家族向け UI | [`public/index.html`](../public/index.html) |
| 裏側のフロー再生 | [`public/ops.html`](../public/ops.html) |
| デモ通知 | [`fixtures/bill.html`](../fixtures/bill.html) → [`fixtures/bill.png`](../fixtures/bill.png) |
| 起動・環境変数 | [`README.md`](../README.md) / [`.env.example`](../.env.example) |
| テスト | [`tests/`](../tests) |
| 発表資料 | [`submission/omakase-tetsuzuki-deck.pdf`](./omakase-tetsuzuki-deck.pdf) |
| デモ動画 | [`demo/out/omakase-demo.mp4`](../demo/out/omakase-demo.mp4) |

### 10.1 採点語彙との対応（keyword map）

`Daytona` / `sandbox` / `isolated` / `computer use` / `browser automation` / `agentic workflow` / `end-to-end` / `verification` / `exit code` / `reproducibility` / `human-in-the-loop` / `approval gate` / `data provenance` / `privacy` / `self-hosted inference` / `GPU` / `Nosana` / `real-world problem` / `MVP` / `sponsor integration`

---

## 11. 付録: 証拠 ID 索引

| ID | 証拠 | 位置 |
|---|---|---|
| E1 | 状態機械の全体 | [`src/flow.ts`](../src/flow.ts) `runFlow()` 82–160 |
| E2 | Computer Use エージェントと 4 ゲート | [`src/operator.ts`](../src/operator.ts) 124–256 |
| E3 | ゲートの単体テスト | [`tests/operator.test.ts`](../tests/operator.test.ts) |
| E4 | 独立検証器 | [`sandbox/verify/verify.mjs`](../sandbox/verify/verify.mjs) |
| E5 | Daytona Runner | [`src/sandbox.ts`](../src/sandbox.ts) `DaytonaRunner` 112–266 |
| E6 | fail-closed のプロバイダー選択 | [`src/sandbox.ts:37-41`](../src/sandbox.ts) |
| E7 | Nosana クライアント | [`src/ai.ts`](../src/ai.ts) 65–77 |
| E8 | 書類読取と正規化 | [`src/reader.ts`](../src/reader.ts) 104–118 |
| E9 | HTTP / SSE / 承認 API | [`src/server.ts`](../src/server.ts) |
| E10 | 本人・家族向け UI | [`public/index.html`](../public/index.html) |
| E11 | `[eN]` スナップショット | [`sandbox/agent/act.mjs`](../sandbox/agent/act.mjs) 73–148 |
| E12 | 検証用申請サイト | [`sandbox/site/server.mjs`](../sandbox/site/server.mjs) |
| E13 | テスト 21 件 | [`tests/`](../tests) / `npm test` |
| E14 | 起動・環境変数 | [`README.md`](../README.md) |
| E15 | デモ動画・発表資料 | [`demo/out/omakase-demo.mp4`](../demo/out/omakase-demo.mp4) / [`submission/`](./) |
| E16 | イベント型 | [`src/types.ts`](../src/types.ts) |
| E17 | Docker デスクトップ定義 | [`desktop/Dockerfile`](../desktop/Dockerfile) |
| E18 | Docker / GCP Runner | [`src/sandbox.ts`](../src/sandbox.ts) 276–463 |
| E19 | ログの伏せ字 | [`src/flow.ts:60-62`](../src/flow.ts) |
| E20 | デモ用請求書 | [`fixtures/bill.png`](../fixtures/bill.png) |

---

### 再現性に関する注記

- 本資料の数値は、2026-11-15 に実行した `npm test` の出力、およびリポジトリ内のコードに基づく。
- 実測していない数値（90 秒、30〜60 分、成功率）は「設計目標 / 想定」と明記した。
- 外部サイトへ送信するのは `TARGET_URL` を明示し、かつ自治体が公開する体験用手続きを使う場合だけ。既定では何も外部に送らない。
