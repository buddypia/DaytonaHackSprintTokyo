// おまかせ手続き — オーケストレーター（HTTP + SSE）。node src/server.ts で起動する。
import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Run, runFlow } from "./flow.ts";
import { operatorLabel } from "./operator.ts";
import { readerLabel } from "./reader.ts";
import { sandboxProvider, viewerPorts, warmUpSandbox } from "./sandbox.ts";

const ROOT = join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 15 * 1024 * 1024;
const runs = new Map<string, Run>();

const STATIC: Record<string, [string, string]> = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/ops": ["public/ops.html", "text/html; charset=utf-8"],
  "/fixtures/notice.png": ["fixtures/notice.png", "image/png"],
  "/fixtures/bill.png": ["fixtures/bill.png", "image/png"],
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("画像が大きすぎます（15MB まで）");
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = http.createServer(async (req, res) => {
  const vnc = vncTarget(req.url);
  if (vnc) return proxyVnc(req, res, vnc);
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { "content-type": type });
      return res.end(await readFile(join(ROOT, file)));
    }

    // 通知の画像を受け取って処理を始める。{ image: dataURL } または { fixture: true }
    if (req.method === "POST" && url.pathname === "/api/runs") {
      const body = await readBody(req);
      const image: string | null = body.fixture
        ? `data:image/png;base64,${(await readFile(join(ROOT, `fixtures/${process.env.TARGET_URL ? "notice" : "bill"}.png`))).toString("base64")}`
        : typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
      if (!image) return json(res, 400, { error: "画像がありません" });
      const run = new Run();
      runs.set(run.id, run);
      run.emit({ type: "notice", image });
      void runFlow(run, image);
      return json(res, 201, { runId: run.id });
    }

    // 裏側の画面（/ops）が最新の実行を見つけるための一覧
    if (req.method === "GET" && url.pathname === "/api/runs") {
      return json(res, 200, [...runs.values()].map((r) => ({ id: r.id, startedAt: r.startedAt, state: (r.events.findLast((e) => e.type === "state") as { text: string } | undefined)?.text ?? null })));
    }

    const m = url.pathname.match(/^\/api\/runs\/([\w-]+)\/(events|answer|confirm)$/);
    const run = m && runs.get(m[1]);
    if (m && !run) return json(res, 404, { error: "見つかりません" });

    if (run && req.method === "GET" && m![2] === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      run.events.forEach(send);
      run.listeners.add(send);
      req.on("close", () => run.listeners.delete(send));
      return;
    }
    if (run && req.method === "POST" && m![2] === "answer") {
      const { fieldName, value } = await readBody(req);
      await run.answer(String(fieldName), String(value));
      return json(res, 200, { ok: true });
    }
    if (run && req.method === "POST" && m![2] === "confirm") {
      const { ok } = await readBody(req);
      await run.confirm(ok === true);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "見つかりません" });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

// 隔離コンテナの noVNC（127.0.0.1:<port>）の中継。VIEWER_PROXY=1 のときだけ viewerPorts に登録される
function vncTarget(rawUrl = "") {
  const m = rawUrl.match(/^\/vnc\/(\d+)(\/.*)$/);
  return m && viewerPorts.has(m[1]) ? { port: Number(m[1]), path: m[2] } : null;
}

function proxyVnc(req: http.IncomingMessage, res: http.ServerResponse, t: { port: number; path: string }) {
  const up = http.request({ host: "127.0.0.1", port: t.port, path: t.path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => res.writeHead(502).end());
  req.pipe(up);
}

server.on("upgrade", (req, socket, head) => {
  const t = vncTarget(req.url);
  if (!t) return socket.destroy();
  const up = net.connect(t.port, "127.0.0.1", () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    up.write(`${req.method} ${t.path} HTTP/1.1\r\n${headers}\r\n\r\n`);
    up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

warmUpSandbox();

server.listen(PORT, process.env.HOST, () => {
  console.log(`おまかせ手続き: http://localhost:${PORT}`);
  console.log(`  裏側の画面: http://localhost:${PORT}/ops`);
  try {
    console.log(`  隔離実行: ${sandboxProvider()}`);
  } catch (err) {
    console.log(`  隔離実行: ${(err as Error).message}`);
  }
  console.log(`  読み取り: ${readerLabel}`);
  if (operatorLabel !== readerLabel) console.log(`  操作判断: ${operatorLabel}`);
});
