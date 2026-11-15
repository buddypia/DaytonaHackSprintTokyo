// GCP の隔離コンテナ用ホスト（Compute Engine の VM 1台）を用意・停止・削除する。SANDBOX_PROVIDER=gcp で使う。
//   node scripts/gcp.mjs up       API の有効化 → VM 作成（無ければ）→ 起動 → SSH 鍵の登録と docker の権限 → デスクトップのイメージを VM 上でビルド
//   node scripts/gcp.mjs down     VM を停止する（停止中はディスク代だけ）
//   node scripts/gcp.mjs destroy  VM を削除する
// 対象は GCP_PROJECT / GCP_ACCOUNT / GCP_VM（既定 omakase-sandbox-host）/ GCP_ZONE（既定 asia-northeast1-b）。
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const VM = process.env.GCP_VM ?? "omakase-sandbox-host";
const ZONE = process.env.GCP_ZONE ?? "asia-northeast1-b";
const scope = [...(process.env.GCP_PROJECT ? ["--project", process.env.GCP_PROJECT] : []), ...(process.env.GCP_ACCOUNT ? ["--account", process.env.GCP_ACCOUNT] : [])];
const gcloud = (args, opts = {}) => execFileSync("gcloud", [...args, ...scope], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts })?.trim() ?? ""; // stdio: inherit のときは出力を返さない
const describe = (format) => {
  try {
    return gcloud(["compute", "instances", "describe", VM, "--zone", ZONE, `--format=value(${format})`], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

// VM の起動時に Docker を入れる
const STARTUP = `#!/bin/sh
if ! command -v docker >/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io
  systemctl enable --now docker
fi
`;

async function up() {
  console.log("Compute Engine API を有効にします");
  gcloud(["services", "enable", "compute.googleapis.com"]);
  if (!describe("status")) {
    console.log(`VM ${VM}（${ZONE}）を作成します`);
    const dir = mkdtempSync(join(tmpdir(), "omakase-gcp-"));
    writeFileSync(join(dir, "startup.sh"), STARTUP);
    gcloud(["compute", "instances", "create", VM, "--zone", ZONE, "--machine-type", "e2-standard-4",
      "--image-family", "ubuntu-2404-lts-amd64", "--image-project", "ubuntu-os-cloud", "--boot-disk-size", "30GB",
      "--metadata-from-file", `startup-script=${join(dir, "startup.sh")}`, "--labels", "app=omakase-tetsuzuki"], { stdio: "inherit" });
    rmSync(dir, { recursive: true });
  } else if (describe("status") !== "RUNNING") {
    console.log(`VM ${VM} を起動します`);
    gcloud(["compute", "instances", "start", VM, "--zone", ZONE], { stdio: "inherit" });
  }

  console.log("SSH 鍵を登録し、Docker の準備を待ちます");
  gcloud(["compute", "ssh", VM, "--zone", ZONE, "--quiet", "--command",
    "for i in $(seq 1 60); do command -v docker >/dev/null && break; sleep 5; done; sudo usermod -aG docker $USER; docker --version || sudo docker --version"], { stdio: "inherit" });

  const ip = describe("networkInterfaces[0].accessConfigs[0].natIP");
  const socket = join(tmpdir(), `omakase-gcp-build-${process.pid}.sock`);
  rmSync(socket, { force: true });
  const tunnel = spawn("ssh", ["-i", join(homedir(), ".ssh", "google_compute_engine"), "-o", `UserKnownHostsFile=${join(homedir(), ".ssh", "google_compute_known_hosts")}`,
    "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `${socket}:/var/run/docker.sock`, `${userInfo().username}@${ip}`], { stdio: "inherit" });
  try {
    for (let i = 0; i < 60 && !existsSync(socket); i++) await new Promise((r) => setTimeout(r, 500));
    console.log("デスクトップのイメージを VM 上でビルドします（初回は数分）");
    execFileSync("docker", ["build", "-t", "omakase-desktop", join(import.meta.dirname, "..", "desktop")], { stdio: "inherit", env: { ...process.env, DOCKER_HOST: `unix://${socket}` } });
  } finally {
    tunnel.kill();
  }
  console.log(`準備できました。SANDBOX_PROVIDER=gcp で起動してください（VM: ${VM} / ${ip}）`);
}

// ---------------------------------------------------------------------------
// アプリ本体を同じ VM に載せ、https://<IP>.sslip.io で開けるようにする（Caddy + Let's Encrypt）。
// 443 は自分の IP からだけ通す。80 は証明書の取得と HTTPS への転送だけなので全体に開ける。隔離コンテナは VM の Docker で動かす
// ---------------------------------------------------------------------------
const REGION = ZONE.replace(/-[a-z]$/, "");
const TAG = "omakase-web";
const RULE_HTTPS = "omakase-https-allow";
const RULE_ACME = "omakase-acme";
const APP_DIR = "/opt/omakase-app";
// VM に渡す設定（キーは渡さない）。推論は VM のサービスアカウントで Vertex AI を呼ぶ
const PASS_ENV = ["AI_PROVIDER", "OPERATOR_AI_PROVIDER", "GCP_PROJECT", "VERTEX_MODEL", "NOSANA_BASE_URL", "NOSANA_MODEL", "TARGET_URL", "TARGET_NAME", "CONTACT_EMAIL"];

const tryGcloud = (args) => {
  try {
    return gcloud(args, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

async function myIp() {
  const ip = (await (await fetch("https://api.ipify.org")).text()).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error(`自分の IP を取得できませんでした: ${ip}`);
  return ip;
}

function sshVm(ip, command, input) {
  execFileSync("ssh", ["-i", join(homedir(), ".ssh", "google_compute_engine"), "-o", `UserKnownHostsFile=${join(homedir(), ".ssh", "google_compute_known_hosts")}`,
    "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", `${userInfo().username}@${ip}`, command], { input, stdio: [input == null ? "ignore" : "pipe", "inherit", "inherit"] });
}

// 443 の許可を、指定の IP（省略時は今の自分の IP）だけにする。会場など回線が変わったら npm run gcp:allow
async function allow(ipArg) {
  const ip = ipArg ?? (await myIp());
  const source = `${ip}/32`;
  if (tryGcloud(["compute", "firewall-rules", "describe", RULE_HTTPS, "--format=value(name)"])) {
    gcloud(["compute", "firewall-rules", "update", RULE_HTTPS, "--source-ranges", source], { stdio: "inherit" });
  } else {
    gcloud(["compute", "firewall-rules", "create", RULE_HTTPS, "--allow", "tcp:443", "--source-ranges", source, "--target-tags", TAG,
      "--description", "omakase: HTTPS は自分の IP だけ"], { stdio: "inherit" });
  }
  console.log(`443 を許可した IP: ${source}`);
}

async function deploy() {
  if (describe("status") == null) throw new Error("VM がありません。先に npm run gcp:up を実行してください");
  const ip = describe("networkInterfaces[0].accessConfigs[0].natIP");
  if (!ip) throw new Error("VM に外部 IP がありません。VM を起動してください（npm run gcp:up）");

  // 停止・起動しても URL（sslip.io）が変わらないよう、今の IP を静的 IP として確保する
  if (!tryGcloud(["compute", "addresses", "describe", "omakase-ip", "--region", REGION, "--format=value(address)"])) {
    console.log(`今の IP ${ip} を静的 IP（omakase-ip）として確保します`);
    gcloud(["compute", "addresses", "create", "omakase-ip", "--region", REGION, "--addresses", ip], { stdio: "inherit" });
  }

  // Vertex AI を VM のサービスアカウントで呼ぶ（スコープの変更は停止中しかできない）
  const sa = describe("serviceAccounts[0].email");
  if (!describe("serviceAccounts[0].scopes").includes("cloud-platform")) {
    console.log("Vertex AI を呼べるよう、VM のスコープを cloud-platform にします（一度停止します）");
    gcloud(["compute", "instances", "stop", VM, "--zone", ZONE], { stdio: "inherit" });
    gcloud(["compute", "instances", "set-service-account", VM, "--zone", ZONE, "--service-account", sa, "--scopes", "cloud-platform"], { stdio: "inherit" });
    gcloud(["compute", "instances", "start", VM, "--zone", ZONE], { stdio: "inherit" });
  }
  const project = process.env.GCP_PROJECT ?? gcloud(["config", "get-value", "project"]);
  gcloud(["projects", "add-iam-policy-binding", project, "--member", `serviceAccount:${sa}`, "--role", "roles/aiplatform.user", "--condition=None", "--format=none"], { stdio: "inherit" });

  // ファイアウォール: 443 は自分の IP だけ、80 は証明書の取得用
  gcloud(["compute", "instances", "add-tags", VM, "--zone", ZONE, "--tags", TAG], { stdio: "inherit" });
  await allow();
  if (!tryGcloud(["compute", "firewall-rules", "describe", RULE_ACME, "--format=value(name)"])) {
    gcloud(["compute", "firewall-rules", "create", RULE_ACME, "--allow", "tcp:80", "--source-ranges", "0.0.0.0/0", "--target-tags", TAG,
      "--description", "omakase: Let's Encrypt の取得と HTTPS への転送だけ"], { stdio: "inherit" });
  }

  const host = `${ip.replaceAll(".", "-")}.sslip.io`;
  const env = [
    ...PASS_ENV.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`),
    "SANDBOX_PROVIDER=docker", "VIEWER_PROXY=1", "HOST=127.0.0.1", "PORT=8787",
  ].join("\n") + "\n";
  // 検証用の申請サイトもデモ用に配信する（https://site.<IP>.sslip.io。443 の制限は同じ）。エージェントが操作するのは隔離マシン内の同じサイト
  const caddyfile = `${host} {\n  reverse_proxy 127.0.0.1:8787\n}\nsite.${host} {\n  reverse_proxy 127.0.0.1:8090\n}\n`;
  const siteUnit = `[Unit]
Description=omakase-demo-site
After=network-online.target

[Service]
User=omakase
WorkingDirectory=${APP_DIR}/sandbox
StateDirectory=omakase-site
Environment=WORK_DIR=/var/lib/omakase-site
ExecStart=/usr/bin/node site/server.mjs 8090 127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
`;
  const unit = `[Unit]
Description=omakase-tetsuzuki
After=network-online.target docker.service

[Service]
User=omakase
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/omakase.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/snap/bin
ExecStart=/usr/bin/node src/server.ts
Restart=always

[Install]
WantedBy=multi-user.target
`;

  console.log("コードを VM に送ります");
  const root = join(import.meta.dirname, "..");
  const tar = execFileSync("tar", ["-cz", "-C", root, "--exclude", "node_modules", "src", "public", "fixtures", "sandbox", "package.json", "package-lock.json"], { maxBuffer: 256 * 1024 * 1024 });
  sshVm(ip, `sudo mkdir -p ${APP_DIR} && sudo find ${APP_DIR} -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && sudo tar -xz -C ${APP_DIR}`, tar);

  console.log("Node.js・Caddy・サービスを用意します");
  const b64 = (s) => Buffer.from(s).toString("base64");
  sshVm(ip, `set -e
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - >/dev/null && sudo apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null
fi
id omakase >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin omakase
sudo usermod -aG docker omakase
echo ${b64(env)} | base64 -d | sudo tee /etc/omakase.env >/dev/null && sudo chmod 600 /etc/omakase.env
echo ${b64(unit)} | base64 -d | sudo tee /etc/systemd/system/omakase.service >/dev/null
echo ${b64(siteUnit)} | base64 -d | sudo tee /etc/systemd/system/omakase-site.service >/dev/null
echo ${b64(caddyfile)} | base64 -d | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo chown -R omakase ${APP_DIR}
cd ${APP_DIR} && sudo -u omakase npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo systemctl daemon-reload && sudo systemctl enable -q omakase omakase-site && sudo systemctl restart omakase omakase-site && sudo systemctl reload-or-restart caddy
sleep 2 && systemctl is-active omakase omakase-site caddy`);
  console.log(`デプロイしました: https://${host}/ （裏側の画面: https://${host}/ops ／ 検証用の申請サイト: https://site.${host}/）`);
}

const command = process.argv[2];
if (command === "up") await up();
else if (command === "deploy") await deploy();
else if (command === "allow") await allow(process.argv[3]);
else if (command === "down") gcloud(["compute", "instances", "stop", VM, "--zone", ZONE], { stdio: "inherit" });
else if (command === "destroy") gcloud(["compute", "instances", "delete", VM, "--zone", ZONE], { stdio: "inherit" });
else {
  console.error("使い方: node scripts/gcp.mjs up | deploy | allow [IP] | down | destroy");
  process.exit(1);
}
