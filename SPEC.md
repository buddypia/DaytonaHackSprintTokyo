# SPEC — おまかせ手続き（Omakase Tetsuzuki）

- 版: 0.2（2026-11-13、実在の申請サイトを操作する設計に変更）
- 要求: [`PRD.md`](./PRD.md) / 概要: [`BRIEF.md`](./BRIEF.md)
- Daytona SDK の API 名は 2026-11-13 に公式ドキュメント（daytona.io/docs）で確認した。Daytona と Nosana は、キーが手元に無いため実機では未確認。

## 1. 全体構成

```
[ブラウザ（本人・家族）]
   │ 画像アップロード / 回答 / 「はい」
   │ ← SSE（進行イベント・スクリーンショット）・noVNC（隔離マシンの画面）
   ▼
[オーケストレーター（Node.js 23.6+ の TypeScript 直接実行, node:http）]  ← ローカル PC で動かす
   ├─ モデル（src/ai.ts）: Nosana 上の OSS モデル または Vertex AI の Gemini（OpenAI 互換）
   │     ・通知の読み取り（src/reader.ts）
   │     ・操作エージェントの次の一手（src/operator.ts）
   └─ Runner（src/sandbox.ts）
         DAYTONA_API_KEY あり → Daytona サンドボックス（@daytona/sdk）+ Computer Use の画面
         SANDBOX_PROVIDER=gcp → GCP の VM 上に依頼ごとのコンテナ（SSH で転送した docker.sock 越し）
         omakase-desktop イメージあり → Docker デスクトップ（Daytona の Computer Use と同じ Xvfb + xfce4 + noVNC 構成）
         どちらも無し → エラーで止める（隔離なしの local は SANDBOX_PROVIDER=local と明示したときだけ。開発用）
         ├─ agent/browser.mjs  常駐ブラウザ（Chromium、CDP を開ける。画面があればそこに表示）
         ├─ agent/act.mjs      1手の操作と、画面の一覧化（[eN] 付き）・スクリーンショット
         └─ verify/verify.mjs  検証（終了コードで合否）
                │ HTTPS
                ▼
         [実在の電子申請システム]（既定: 佐倉市「電子申請 体験」／ちば電子申請サービス e-tumo）
```

**統合箇所の一覧**

| スポンサー | ファイル | 役割 |
|---|---|---|
| Daytona | `src/sandbox.ts`（`DaytonaRunner`） | サンドボックスの作成、ファイル配置、申請先への疎通確認、画面とブラウザの起動、1手ごとの操作スクリプトと検証スクリプトの実行、破棄 |
| Nosana | `src/ai.ts`（`nosana()`）、`src/reader.ts`、`src/operator.ts` | 通知の読み取り、操作エージェントの判断（`AI_PROVIDER` で Vertex AI にも切り替え可） |

## 2. ディレクトリ構成

```
/
├─ BRIEF.md / PRD.md / SPEC.md / README.md
├─ package.json
├─ src/
│  ├─ server.ts        HTTP と SSE
│  ├─ flow.ts          処理の流れ（状態遷移）、質問・確認の受け付け、ログの伏せ字
│  ├─ operator.ts      操作エージェント（画面を読み、次の一手をモデルに決めさせる。決まりごとはコードで守る）
│  ├─ sandbox.ts       隔離実行（DaytonaRunner / DockerRunner / LocalRunner）
│  ├─ ai.ts            推論プロバイダー（nosana / vertex）。遅い応答への二重依頼
│  ├─ reader.ts        通知の読み取り（何の書類か・期限・ご本人の情報）
│  └─ types.ts
├─ public/
│  ├─ index.html       本人・家族向けの画面（音声は Web Speech API）
│  └─ ops.html         裏側の画面（フロー図・イベント・失敗）
├─ sandbox/            サンドボックスへアップロードする一式
│  ├─ agent/browser.mjs
│  ├─ agent/act.mjs
│  └─ verify/verify.mjs
├─ desktop/            Docker デスクトップ（Dockerfile / start.sh）
├─ fixtures/notice.html / notice.png  デモ用の通知（架空の人物。png は npm run make:notice で生成）
└─ tests/
   ├─ verify.test.mjs   検証スクリプトの単体テスト
   ├─ operator.test.ts  操作エージェントの決まりごとの単体テスト（偽のモデルと偽のブラウザ）
   └─ flow.test.ts      本物の申請サイトでの通し確認（E2E_REAL=1 のときだけ）
```

## 3. 処理の流れ（状態遷移）

```
READING → SANDBOX_READY → FILLING ⇄ ASKING
        → CONFIRMING → （送信）→ VERIFYING → DONE
CONFIRMING で「いいえ」 → CANCELLED（送信しない）
どの状態でも例外 → error（サンドボックスを破棄）
```

| 状態 | 処理 | 担当 |
|---|---|---|
| READING | 画像を視覚モデルに渡し、`NoticeExtraction`（説明3行・期限・ご本人の情報）を得る | `reader.ts` |
| SANDBOX_READY | サンドボックス作成 → `sandbox/` を配置 → 申請先に届くか確認 → 画面とブラウザを起動して申請先を開く | `sandbox.ts` |
| FILLING | 操作エージェントが画面を読み、入力・選択・クリックを1手ずつ進める | `operator.ts` + `act.mjs` |
| ASKING | ご本人にしか分からない項目を質問する（最大3問） | `operator.ts` → `flow.ts` |
| CONFIRMING | 申請サイトの確認画面で、入力内容を出どころごとに読み上げて返事を待つ | `operator.ts` → `index.html` |
| VERIFYING | `verify.mjs` を実行し、`exitCode` を得る | `flow.ts` |
| DONE | 整理番号・検証結果・家族向け要約を送り、サンドボックスを破棄 | `flow.ts` |

## 4. 操作エージェント（`src/operator.ts`）

画面の読み方と ref 指定の操作は OpenMausBot（Apache-2.0）のブラウザ操作の考え方に倣った。

- **観察**: `act.mjs` が DOM を順にたどり、操作できる要素に `data-gb-ref="eN"` を振って `[eN] 種類 "名前" value=… hint=…` の行にし、それ以外は見えている文字を並べる。名前は、結び付いた `<label>` → `aria-label` → `title` → `placeholder` の順に取り、入力欄には所属する項目名（`<dt>`）を前に付ける（例: `生年月日… ＞ 年`）。`<label>` と別の `aria-label` は入力例として `hint` に出す。ref は DOM の属性なので、接続し直しても同じ画面の間は使える。
- **判断**: 毎手、目的・ご本人の情報・まだ入力も申告もしていない項目・直近の操作履歴・いまの画面をモデルに渡し、`{"thought","actions":[…]}` の JSON を受け取る。
- **操作**: `fill` / `select` / `check` / `uncheck` / `click` / `press` / `scroll`（ブラウザ）、`ask`（質問）、`not_applicable`（欄が無い項目の申告）、`submit`（最後の申込）、`done`（完了と整理番号）、`fail`。
- **コードで守る決まりごと**（モデルが守らなくても破られない）:
  1. 入力・選択には `from`（ご本人の情報の項目名）が必要。出どころの無い値は入力しない。
  2. ご本人の情報は、すべて入力するか `not_applicable` で理由付きに申告するまで、最後の申込に進ませない。
  3. 最後の申込ボタンは、`submit` でも、名前が申込らしい `click`（「申し込む方はこちら」などの案内は除く）でも、送信直前の確認画面を記録してから本人の承認を取り、「はい」のときだけ押す。
  4. 質問は最大3問。上限は30手。
- **ご本人の情報（`Source`）**: 書類から読んだ値（`origin: 書類`、確信度 0.8 以上）、ご家族の設定（`CONTACT_EMAIL` → `連絡先メールアドレス（ご家族）`）、ご本人の回答。

## 5. データ型

```ts
type NoticeExtraction = {
  noticeType: string;
  deadline: string | null;            // YYYY-MM-DD
  summary: [string, string, string];  // 何の通知か / いつまでに / 何をするか
  fields: Record<string, { value: string; sourceText: string; confidence: number }>; // 書類に書かれたご本人の情報
};
type Source = { value: string; origin: string };            // origin: 書類 / ご本人の回答 / ご家族の設定
type Entered = { field: string; value: string; from: string }; // 入力した欄・値・出どころ
```

画面に流すイベント（`RunEvent`）は `src/types.ts` を正とする。

## 6. HTTP API（オーケストレーター）

| メソッド | パス | 内容 |
|---|---|---|
| `POST` | `/api/runs` | `{ image: dataURL }` または `{ fixture: true }`（デモ用の通知画像）を受け取り、`{ runId }` を返す |
| `GET` | `/api/runs` | 実行の一覧（`id`, `startedAt`, 最新の状態） |
| `GET` | `/api/runs/:id/events` | `RunEvent` の SSE（各イベントに emit 時刻 `at` が付く） |
| `POST` | `/api/runs/:id/answer` | `{ fieldName, value }` で質問に答える |
| `POST` | `/api/runs/:id/confirm` | `{ ok: boolean }` で送信の可否を返す |
| `GET` | `/ops` | 裏側の画面 |

状態は1プロセスのメモリ（`Map<runId, Run>`）に持つ。回答・確認は10分待って来なければ打ち切り、サンドボックスを破棄する。

## 7. Daytona 統合（`src/sandbox.ts` の `DaytonaRunner`）

| 工程 | 使う API |
|---|---|
| 作成 | `new Daytona().create({ snapshot, envVars })`。スナップショットが無ければ `{ language: "typescript", envVars }` |
| 配置 | `sandbox.fs.uploadFile(Buffer, "/home/daytona/app/...")` で `sandbox/` 一式を置く |
| ブラウザ導入 | スナップショットが無い場合だけ `npm i playwright` と `npx playwright install --with-deps chromium`（タイムアウト 600 秒） |
| 画面 | `sandbox.computerUse.start()` で Xvfb + xfce4 + x11vnc + noVNC を起動。`DISPLAY` は `/tmp/.X11-unix` から求める |
| 疎通確認 | サンドボックス内から申請先 URL を `fetch` し、届かなければ「Tier 3 以上か許可リストへの追加が必要」と表示して止める |
| 常駐 | `process.createSession(id)` + `executeSessionCommand(id, { command, runAsync: true })` で `agent/browser.mjs` を動かす |
| 1手 | `process.executeCommand("node agent/act.mjs <base64 JSON>", cwd, env, 120)`。標準出力の `@@OBS@@` 行に画面を返す |
| やり取り | `fs.uploadFile`（`expected.json`）、確認画面・完了画面は `act.mjs` が作業ディレクトリに保存する |
| ライブ表示 | `sandbox.getSignedPreviewUrl(6080, 3600)` の noVNC（`view_only=true`）を見守り画面に埋め込む |
| 破棄 | `sandbox.delete()` |

- Daytona の Tier 1/2 は外向き通信が許可リスト（essential services）に限られ、サンドボックス側の設定では広げられない。行政サイトに届かせるには Tier 3 以上か、Daytona への許可リスト追加の依頼が必要。
- Docker デスクトップ（`desktop/Dockerfile`、`SANDBOX_PROVIDER=docker`）は同じ構成をローカルで再現する。依頼ごとにコンテナを作り、noVNC を `127.0.0.1` の空きポートに出し、終わったら `docker rm -f` で破棄する。ホストのフォルダはマウントせず、`docker cp` / `docker exec` でファイルをやり取りする。
- GCP（`SANDBOX_PROVIDER=gcp`、`GcpRunner`）は、Compute Engine の VM（`npm run gcp:up` で作成）の Docker を、SSH で転送した `docker.sock` 越しに使って同じコンテナを作る。VM が止まっていれば起動し、noVNC は依頼ごとの SSH トンネルで手元の空きポートに出す。サーバー起動時に VM への接続を先に張る。VM の外向き通信に制限は無い。
- 落ちたプロセスが破棄できなかったコンテナ（30分より古いもの、ラベル `app=omakase-tetsuzuki`）は、次の準備のときに片づける。
- **未検証**: Daytona モードは実機で動かしていない。キーが手に入ったら、疎通確認とブラウザ導入済みのスナップショット（`OMAKASE_SNAPSHOT`）の作成を先に行う。

## 8. 検証（`sandbox/verify/verify.mjs`）

モデルの判断は使わない。`expected.json`（エージェントの入力記録）と、申請サイト自身が表示した画面を照合する。

| 確かめること | 根拠 |
|---|---|
| 送信直前の確認画面を記録した | `confirm-page.txt` |
| 入力した値がすべて確認画面に出ている | `confirm-page.txt` |
| 入力した値すべてに出どころがある | `entered[].from` と `sources` |
| 書類の情報は、入力したか「欄が無い」と申告したかのどちらか | `sources` と `notApplicable` |
| 送信後の画面が完了を示している | `done-page.txt` |
| エージェントが報告した整理番号が完了画面にある | `done-page.txt` |

すべて合格なら `exit 0`。不合格の項目を標準出力に出して `exit 1`。

## 9. 推論（`src/ai.ts`）

- Nosana 上の OpenAI 互換の推論サーバー（`NOSANA_BASE_URL`）か、Vertex AI の Gemini（`AI_PROVIDER=vertex`、gcloud の認証）を `POST /chat/completions` で呼ぶ。`temperature: 0`。
- Vertex AI の応答には数十秒の外れ値があるため、`AI_HEDGE_MS`（既定 6 秒）待っても返らなければ同じ依頼をもう1本出し、先に返った方を使ってもう一方を中止する。
- 読み取りの失敗・タイムアウト（既定 60 秒、`AI_TIMEOUT_MS`）・JSON 不正のときはエラーで止める（別の通知の値で申請しないため）。モデルが設定されていなければ処理を始めない。

## 10. 環境変数

| 名前 | 用途 |
|---|---|
| `DAYTONA_API_KEY` | Daytona SDK の認証 |
| `NOSANA_BASE_URL` / `NOSANA_MODEL` / `NOSANA_API_KEY` | Nosana 上の推論サーバー |
| `AI_PROVIDER` / `GCP_PROJECT` / `GCP_ACCOUNT` / `VERTEX_MODEL` | 推論の切り替えと Vertex AI |
| `SANDBOX_PROVIDER` | `daytona` / `gcp` / `docker` / `local`（未指定なら daytona → docker） |
| `GCP_VM` / `GCP_ZONE` | gcp のときの VM 名（既定 `omakase-sandbox-host`）とゾーン（既定 `asia-northeast1-b`） |
| `TARGET_URL` / `TARGET_NAME` | 申請先の手続き（既定は佐倉市「電子申請 体験」 `tempSeq=36791`） |
| `CONTACT_EMAIL` | ご家族の連絡先。申請先が連絡先を求めたときに使い、整理番号のメールが届く |
| `OMAKASE_SNAPSHOT` | 事前作成したスナップショット名（任意） |

キーはコードや `.env` に書かず、`secret run DAYTONA_API_KEY -- npm start` で渡す。

## 11. テスト

- `npm test`: `verify.mjs` の単体テスト（合格・確認画面なし・値の不一致・未完了・番号なし・入れ忘れ・出どころなし）と、操作エージェントの決まりごと（出どころの無い入力をしない・入れ忘れたまま送信しない・承認なしに最後のボタンを押さない）。
- `E2E_REAL=1 CONTACT_EMAIL=… SANDBOX_PROVIDER=docker npm test`: 本物の申請サイトでの通し確認。「はい」で `verifyExitCode === 0` と数字の整理番号、「いいえ」で何も送信しない。
