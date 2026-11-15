// 推論プロバイダー。AI_PROVIDER で切り替える（どれも OpenAI 互換の /chat/completions を呼ぶ）。
//   nosana  : Nosana 上の OSS 視覚モデル（NOSANA_BASE_URL / NOSANA_MODEL / NOSANA_API_KEY）。Ollama なども可
//   vertex  : Google Cloud Vertex AI の Gemini（GCP_PROJECT / GCP_ACCOUNT / VERTEX_MODEL）。認証は gcloud のログインを使う
// 既定は NOSANA_BASE_URL があれば nosana、GCP_PROJECT があれば vertex。どちらも無ければモデル無し（処理は始めない）。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface ChatModel {
  label: string;
  chat(content: unknown): Promise<string>;
}

type Endpoint = { url: string; model: string; token: () => Promise<string | undefined>; extra?: Record<string, unknown>; hedgeMs?: number };

// 応答の遅い外れ値（数十秒）に備えて、hedgeMs 待っても返らなければ同じ依頼をもう1本出し、先に返った方を使う（もう一方は中止）。
// temperature 0 の1回きりの依頼なので、二重に出しても結果は変わらない
const HEDGE_MS = Number(process.env.AI_HEDGE_MS ?? 6_000);

function openAiCompatible(label: string, ep: Endpoint): ChatModel {
  async function once(content: unknown, signal: AbortSignal) {
    const token = await ep.token();
    const res = await fetch(`${ep.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ model: ep.model, temperature: 0, ...ep.extra, messages: [{ role: "user", content }] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 120_000))]),
    });
    if (!res.ok) throw new Error(`${label} が ${res.status} を返しました: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return json.choices[0].message.content;
  }
  const hedgeMs = ep.hedgeMs ?? 0;
  return {
    label,
    async chat(content) {
      if (hedgeMs <= 0) {
        const c = new AbortController();
        return await once(content, c.signal);
      }
      const controllers: AbortController[] = [];
      const start = () => {
        const c = new AbortController();
        controllers.push(c);
        return once(content, c.signal);
      };
      let timer: NodeJS.Timeout | undefined;
      const hedge = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => {
          if (process.env.OPERATOR_DEBUG) console.error(`[ai] ${hedgeMs}ms 返らないので同じ依頼をもう1本出します`);
          start().then(resolve, reject);
        }, hedgeMs);
      });
      try {
        return await Promise.any([start(), hedge]);
      } catch (err) {
        throw err instanceof AggregateError ? err.errors[0] : err;
      } finally {
        clearTimeout(timer);
        for (const c of controllers) c.abort();
      }
    },
  };
}

function nosana(): ChatModel {
  const raw = process.env.NOSANA_BASE_URL?.replace(/\/+$/, "");
  if (!raw) throw new Error("AI_PROVIDER=nosana には NOSANA_BASE_URL が必要です");
  const url = new URL(raw).pathname === "/" ? `${raw}/v1` : raw;
  const model = process.env.NOSANA_MODEL ?? "qwen3.5:9b";
  return openAiCompatible(`Nosana（${model}）`, {
    url,
    model,
    token: async () => process.env.NOSANA_API_KEY,
    extra: { reasoning_effort: process.env.NOSANA_REASONING ?? "none", response_format: { type: "json_object" } },
    hedgeMs: Number(process.env.NOSANA_HEDGE_MS ?? 0),
  });
}

// アクセストークンは gcloud から都度取得し（1時間有効）、50分だけ使い回す。ファイルやログには残さない
function vertex(): ChatModel {
  const project = process.env.GCP_PROJECT;
  if (!project) throw new Error("AI_PROVIDER=vertex には GCP_PROJECT が必要です");
  const location = process.env.GCP_LOCATION ?? "global";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const model = process.env.VERTEX_MODEL ?? "google/gemini-3.5-flash";
  const args = ["auth", "print-access-token", ...(process.env.GCP_ACCOUNT ? ["--account", process.env.GCP_ACCOUNT] : [])];
  let cached: { value: string; until: number } | undefined;
  return openAiCompatible(`Vertex AI（${model.replace(/^google\//, "")}）`, {
    url: `https://${host}/v1/projects/${project}/locations/${location}/endpoints/openapi`,
    model,
    extra: { reasoning_effort: process.env.VERTEX_REASONING ?? "minimal", response_format: { type: "json_object" } },
    hedgeMs: HEDGE_MS,
    async token() {
      if (!cached || Date.now() > cached.until) {
        const { stdout } = await promisify(execFile)("gcloud", args);
        cached = { value: stdout.trim(), until: Date.now() + 50 * 60_000 };
      }
      return cached.value;
    },
  });
}

export function createChatModel(providerOverride?: string): ChatModel | null {
  const provider = providerOverride || process.env.AI_PROVIDER || (process.env.NOSANA_BASE_URL ? "nosana" : process.env.GCP_PROJECT ? "vertex" : null);
  if (!provider) return null;
  if (provider === "nosana") return nosana();
  if (provider === "vertex") return vertex();
  throw new Error(`AI_PROVIDER=${provider} には対応していません（nosana / vertex）`);
}
