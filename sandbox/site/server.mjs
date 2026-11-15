// 検証用の申請サイト（架空の「ひばり野市 電子申請サービス」）。外には何も送らない。
// 実在のサイトに申し込みや契約を送らずに、エージェントの操作を最後まで試すためのもの。隔離マシンの中で起動し、デモ用に GCP の VM でも配信する。
//   node site/server.mjs [port] [host]   （既定 8090 / 127.0.0.1）
// トップ・手続き一覧・検索・お知らせ・よくある質問・利用ガイド・申込状況の照会と、手続きごとの 説明 → 利用規約 → 入力 → 確認 → 完了（受付番号）。
// 最後に受け取った申込は WORK_DIR/site-received.json に残し、検証で照合する。
import http from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? 8090);
const HOST = process.argv[3] ?? "127.0.0.1";
const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const SITE = "ひばり野市 電子申請サービス";

const kana = (v) => /^[ァ-ヶー\s　]+$/.test(v) || "全角カタカナで入力してください";
const filled = (min, msg) => (v) => v.length >= min || msg;
const oneOf = (list, msg) => (v) => list.includes(v) || msg;
const BANKS = ["ゆうちょ銀行", "ひばり野信用金庫", "さくら中央銀行", "東都銀行", "みなと農業協同組合"];
const GOMI_ITEMS = ["自転車", "電子レンジ", "布団", "棚・本棚", "椅子", "テーブル", "掃除機"];
const GOMI_DAYS = (() => {
  const out = [], d = new Date();
  d.setDate(d.getDate() + 7);
  while (out.length < 4) {
    if (d.getDay() === 3) out.push(`${d.getMonth() + 1}月${d.getDate()}日（水）`);
    d.setDate(d.getDate() + 1);
  }
  return out;
})();
const SCHOOLS = ["ひばり野第一小学校", "緑が丘小学校", "本町小学校", "みなと小学校"];
const PURPOSES = ["年金の手続き", "相続の手続き", "自動車の登録", "勤務先への提出", "その他"];

const TEL = { n: "tel", label: "日中の連絡先電話番号", type: "tel", req: true, note: "ハイフンなしで入力 例: 0471234567", check: (v) => /^0\d{9,10}$/.test(v) || "ハイフンなしの10〜11桁で入力してください" };
const ADDRESS = (label) => ({ n: "address", label, type: "text", req: true, note: "例: ひばり野市本町一丁目1番1号", check: filled(5, "住所を入力してください") });
const NAME = (label) => ({ n: "name", label, type: "text", req: true, note: "例: 日野 太郎", check: filled(2, "氏名を入力してください") });
const KANA = (label) => ({ n: "kana", label, type: "text", req: true, note: "全角カタカナ 例: ヒノ タロウ", check: kana });

// 手続き。open: false は受付終了（申し込めない）
const PROCEDURES = [
  {
    id: "water-debit", title: "水道料金・下水道使用料の口座振替申込", dept: "上下水道局 料金課", cat: "上下水道", open: true, popular: true,
    overview: [
      ["手続きの概要", "水道料金・下水道使用料のお支払いを、納付書（コンビニ・窓口払い）から金融機関の口座からの自動引き落としに変更します。"],
      ["対象となる方", "ひばり野市上下水道局と給水契約のある使用者の方"],
      ["受付期間", "随時（振替は申込の翌々月の検針分から開始します）"],
      ["必要なもの", "水道料金等の請求書（お客様番号の確認）、引き落としを希望する口座の通帳"],
      ["問い合わせ先", "上下水道局 料金課 電話 0000-11-2233（検証用・架空）"],
    ],
    sections: [
      ["ご使用者の情報（請求書をご覧ください）", [
        { n: "customerNo", label: "お客様番号", type: "text", req: true, note: "請求書の右上に記載の10桁の数字（ハイフンなし）", check: (v) => /^\d{10}$/.test(v) || "10桁の数字で入力してください" },
        { ...ADDRESS("給水場所（ご使用場所）"), note: "請求書に記載の住所" },
        NAME("使用者氏名"), KANA("使用者氏名（フリガナ）"), TEL,
      ]],
      ["引き落とし口座", [
        { n: "bank", label: "金融機関名", type: "select", req: true, options: BANKS, check: oneOf(BANKS, "金融機関を選択してください") },
        { n: "branch", label: "支店名", type: "text", req: true, note: "例: 本店、駅前支店（ゆうちょ銀行は「〇一八」などの店名）", check: filled(1, "支店名を入力してください") },
        { n: "accountType", label: "預金種目", type: "radio", req: true, options: ["普通", "当座"], def: "普通", check: oneOf(["普通", "当座"], "預金種目を選択してください") },
        { n: "accountNo", label: "口座番号", type: "text", req: true, note: "7桁の数字（7桁に満たない場合は先頭に0を付ける）", check: (v) => /^\d{7}$/.test(v) || "7桁の数字で入力してください" },
        { n: "holder", label: "口座名義（フリガナ）", type: "text", req: true, note: "通帳に記載の名義を全角カタカナで", check: kana },
      ]],
    ],
    done: "口座振替の申込を受け付けました。審査ののち、振替開始の時期を郵送でお知らせします。",
  },
  {
    id: "sodai-gomi", title: "粗大ごみ収集の申込", dept: "環境部 クリーン推進課", cat: "ごみ・環境", open: true, popular: true,
    overview: [
      ["手続きの概要", "一辺が30cmを超える家具・家電などの粗大ごみの戸別収集を申し込みます。"],
      ["対象となる方", "ひばり野市内にお住まいの方（事業所のごみは対象外）"],
      ["手数料", "1点につき400円〜1,200円。収集日までにコンビニで粗大ごみ処理券を購入し、品物に貼ってください。"],
      ["収集日", "毎週水曜日（申込から7日後以降の収集日を選べます）"],
      ["問い合わせ先", "クリーン推進課 電話 0000-11-4455（検証用・架空）"],
    ],
    sections: [
      ["お申込者", [NAME("氏名"), KANA("氏名（フリガナ）"), ADDRESS("収集場所の住所"), TEL]],
      ["出す品物と収集日", [
        { n: "item", label: "品目", type: "select", req: true, options: GOMI_ITEMS, check: oneOf(GOMI_ITEMS, "品目を選択してください") },
        { n: "count", label: "点数", type: "select", req: true, options: ["1", "2", "3"], check: oneOf(["1", "2", "3"], "点数を選択してください") },
        { n: "day", label: "収集希望日", type: "select", req: true, options: GOMI_DAYS, check: oneOf(GOMI_DAYS, "収集希望日を選択してください") },
        { n: "place", label: "出す場所", type: "radio", req: true, options: ["玄関前", "集合住宅のごみ集積所"], def: "玄関前", check: oneOf(["玄関前", "集合住宅のごみ集積所"], "出す場所を選択してください") },
      ]],
    ],
    done: "粗大ごみ収集の申込を受け付けました。収集日の朝8時までに、処理券を貼って出してください。",
  },
  {
    id: "juminhyo", title: "住民票の写しの交付請求（郵送）", dept: "市民部 市民課", cat: "証明書", open: true, popular: true,
    overview: [
      ["手続きの概要", "住民票の写しを請求し、住民登録の住所へ郵送で受け取ります。"],
      ["対象となる方", "ひばり野市に住民登録のあるご本人または同一世帯の方"],
      ["手数料", "1通300円（届いた払込票でお支払いください）"],
      ["お届けまで", "申込から1週間程度"],
      ["問い合わせ先", "市民課 電話 0000-11-3344（検証用・架空）"],
    ],
    sections: [
      ["請求者", [NAME("氏名"), KANA("氏名（フリガナ）"), ADDRESS("住民登録の住所"),
        { n: "birth", label: "生年月日", type: "text", req: true, note: "例: 昭和20年4月1日", check: filled(6, "生年月日を入力してください") }, TEL]],
      ["請求の内容", [
        { n: "copies", label: "必要な通数", type: "select", req: true, options: ["1", "2", "3"], check: oneOf(["1", "2", "3"], "通数を選択してください") },
        { n: "purpose", label: "使いみち", type: "select", req: true, options: PURPOSES, check: oneOf(PURPOSES, "使いみちを選択してください") },
        { n: "mynumber", label: "個人番号（マイナンバー）の記載", type: "radio", req: true, options: ["記載しない", "記載する"], def: "記載しない", check: oneOf(["記載しない", "記載する"], "選択してください") },
      ]],
    ],
    done: "住民票の写しの交付請求を受け付けました。1週間程度で郵送します。",
  },
  {
    id: "gakudo", title: "放課後児童クラブ（学童保育）の利用申込", dept: "こども部 こども育成課", cat: "子育て・教育", open: true,
    overview: [
      ["手続きの概要", "保護者が仕事などで放課後に家にいない小学生を、放課後児童クラブでお預かりします。"],
      ["対象となる方", "市内の小学校に通う1〜6年生のお子さんの保護者"],
      ["利用料", "月額5,000円（おやつ代別）"],
      ["受付期間", "随時（定員に達したクラブは待機となります）"],
      ["問い合わせ先", "こども育成課 電話 0000-11-6677（検証用・架空）"],
    ],
    sections: [
      ["保護者", [NAME("保護者氏名"), KANA("保護者氏名（フリガナ）"), ADDRESS("住所"), TEL]],
      ["お子さん", [
        { n: "child", label: "お子さんの氏名", type: "text", req: true, note: "例: 日野 花子", check: filled(2, "お子さんの氏名を入力してください") },
        { n: "grade", label: "学年", type: "select", req: true, options: ["1年生", "2年生", "3年生", "4年生", "5年生", "6年生"], check: oneOf(["1年生", "2年生", "3年生", "4年生", "5年生", "6年生"], "学年を選択してください") },
        { n: "school", label: "通っている小学校", type: "select", req: true, options: SCHOOLS, check: oneOf(SCHOOLS, "小学校を選択してください") },
      ]],
    ],
    done: "放課後児童クラブの利用申込を受け付けました。利用の可否は、2週間程度で郵送でお知らせします。",
  },
  {
    id: "shinki-tekiyo", title: "健康保険・厚生年金保険 新規適用届", dept: "保険年金課・社会保険窓口", cat: "事業者・保険", open: true, popular: true,
    overview: [
      ["手続きの概要", "健康保険・厚生年金保険の新規適用事業所となるための届出をオンラインで提出します。"],
      ["対象となる方", "新たに社会保険の適用対象となった事業所（法人・個人事業所）の事業主"],
      ["提出期限", "事実発生から5日以内"],
      ["問い合わせ先", "保険年金課 電話 0000-11-7788（検証用・架空）"],
    ],
    sections: [
      ["事業所の情報", [
        { n: "corpKind", label: "事業主の区分", type: "radio", req: true, options: ["法人", "個人"], def: "法人", check: oneOf(["法人", "個人"], "区分を選択してください") },
        { n: "officeName", label: "事業所名称", type: "text", req: true, note: "例: 株式会社 健保産業", check: filled(2, "事業所名称を入力してください") },
        { n: "officeAddress", label: "事業所所在地", type: "text", req: true, note: "例: 東京都杉並区高井戸3-5-24", check: filled(4, "事業所所在地を入力してください") },
        { n: "ownerName", label: "事業主（代表者）氏名", type: "text", req: true, note: "例: 健保 一郎", check: filled(2, "事業主氏名を入力してください") },
      ]],
    ],
    done: "健康保険・厚生年金保険 新規適用届を受け付けました。審査ののち、適用通知書を事業所所在地へ郵送します。",
  },
  {
    id: "general-apply", title: "各種届出・申請のオンライン提出", dept: "総合窓口課", cat: "くらし・住まい", open: true, popular: false,
    overview: [
      ["手続きの概要", "通知書や様式に沿った各種届出・申請をオンラインで受け付けます。"],
      ["対象となる方", "各種届出・申請を行うご本人または代理の方"],
      ["受付期間", "随時"],
      ["問い合わせ先", "総合窓口課 電話 0000-11-9900（検証用・架空）"],
    ],
    sections: [
      ["届出・申請の内容", [
        NAME("氏名"), ADDRESS("住所"), TEL,
        { n: "detail", label: "届出・申請の内容", type: "text", req: true, note: "例: 各種届出の提出", check: filled(2, "内容を入力してください") },
      ]],
    ],
    done: "届出・申請を受け付けました。担当課で内容を確認のうえ、必要に応じてご連絡します。",
  },
  {
    id: "shohinken", title: "プレミアム付商品券の購入申込", dept: "経済部 商工振興課", cat: "くらし・住まい", open: false,
    overview: [
      ["手続きの概要", "市内の加盟店で使えるプレミアム付商品券（1セット5,000円で6,500円分）の購入を申し込みます。"],
      ["受付期間", "令和8年9月1日〜10月15日（受付は終了しました）"],
      ["問い合わせ先", "商工振興課 電話 0000-11-5566（検証用・架空）"],
    ],
    sections: [],
  },
];
const CATEGORIES = ["くらし・住まい", "上下水道", "ごみ・環境", "証明書", "子育て・教育", "事業者・保険"];
const NEWS = [
  ["令和8年11月10日", "年末年始の粗大ごみ収集の受付について", "12月30日〜1月3日は粗大ごみの収集を行いません。年内の収集は12月23日（水）が最終です。お早めにお申し込みください。"],
  ["令和8年11月1日", "水道料金の口座振替がオンラインで申し込めるようになりました", "これまで金融機関の窓口で受け付けていた口座振替の申込が、電子申請サービスからできるようになりました。請求書と通帳をご用意ください。"],
  ["令和8年10月20日", "システムメンテナンスのお知らせ（11月22日 1:00〜5:00）", "上記の時間帯は、電子申請サービスをご利用いただけません。ご不便をおかけしますが、ご理解をお願いします。"],
];
const FAQ = [
  ["利用者登録をしなくても申し込めますか", "多くの手続きは、利用者登録をせずに申し込めます。手続きの説明画面で「利用者登録せずに申し込む方はこちら」を選んでください。"],
  ["申込が届いたか確かめるには", "申込完了の画面に表示される受付番号を控え、「申込状況の照会」で確かめられます。"],
  ["入力の途中で画面を閉じてしまいました", "入力内容は保存されません。お手数ですが、最初からお申し込みください。"],
  ["スマートフォンでも使えますか", "はい。最新のブラウザでご利用ください。"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fieldsOf = (p) => p.sections.flatMap(([, f]) => f);
const hidden = (p, v) => fieldsOf(p).map(({ n }) => `<input type="hidden" name="${n}" value="${esc(v[n])}">`).join("");
const procLink = (p) => `<a href="/p/${p.id}">${esc(p.title)}</a>`;
const status = (p) => (p.open ? `<span class="tag on">受付中</span>` : `<span class="tag off">受付終了</span>`);

function page(title, { crumb = [], step = 0, body }) {
  const steps = ["手続き説明", "利用規約", "申込内容の入力", "入力内容の確認", "申込完了"];
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}｜${SITE}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans CJK JP","Hiragino Sans",sans-serif;color:#1f2933;background:#f2f4f7;font-size:15px;line-height:1.6}
a{color:#1557a0}.demo{background:#7a1f1f;color:#fff;text-align:center;font-size:12px;padding:3px}
header{background:#fff;border-bottom:4px solid #1d5fa8}header .in{max-width:980px;margin:auto;padding:12px 20px;display:flex;align-items:center;gap:12px}
header a.home{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}
.logo{width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#7fc8f8,#1d5fa8);color:#fff;font-weight:700;display:grid;place-items:center}
header b{font-size:19px;letter-spacing:.04em}header small{display:block;color:#5b6876;font-size:12px}
header nav{margin-left:auto;display:flex;gap:16px;font-size:13px}header nav a{text-decoration:none;color:#1f2933}header nav a:hover{color:#1557a0;text-decoration:underline}
nav.crumb{max-width:980px;margin:10px auto 0;padding:0 20px;font-size:12px;color:#5b6876}nav.crumb a{color:#5b6876}
main{max-width:980px;margin:10px auto 40px;background:#fff;border:1px solid #d8dee6;border-radius:4px;padding:24px 32px}
ol.steps{display:flex;list-style:none;padding:0;margin:0 0 22px;counter-reset:s}ol.steps li{flex:1;text-align:center;font-size:12px;padding:8px 2px;background:#e9eef4;color:#5b6876;margin-right:3px;counter-increment:s}
ol.steps li::before{content:counter(s) ". "}ol.steps li.on{background:#1d5fa8;color:#fff;font-weight:700}
h1{font-size:21px;border-left:6px solid #1d5fa8;padding-left:10px;margin:0 0 16px}h2{font-size:16px;background:#eef3f9;padding:6px 10px;margin:22px 0 10px}
dl.form{display:grid;grid-template-columns:240px 1fr;border-top:1px solid #d8dee6;margin:0}dl.form dt,dl.form dd{margin:0;padding:12px;border-bottom:1px solid #d8dee6}
dl.form dt{background:#f6f8fb;font-weight:700}.req{display:inline-block;background:#c62828;color:#fff;font-size:11px;padding:1px 6px;border-radius:2px;margin-left:6px;font-weight:400}
input[type=text],input[type=tel],input[type=search],select{width:100%;max-width:420px;padding:8px;font-size:15px;border:1px solid #9aa5b1;border-radius:3px}
.note{font-size:12px;color:#5b6876;margin-top:4px}.err{color:#c62828;font-size:13px;margin-top:4px}
.errors{border:2px solid #c62828;background:#fdecea;padding:10px 14px;margin-bottom:16px;color:#8e1b1b}
.alert{border:1px solid #e0a800;background:#fff8e1;padding:10px 14px;margin-bottom:16px}
.btns{display:flex;gap:12px;justify-content:center;margin-top:26px}
button,.btn{font-size:16px;padding:11px 28px;border-radius:4px;border:1px solid #1d5fa8;background:#1d5fa8;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
.btn.sub,button.sub{background:#fff;color:#1d5fa8}.btn.dis{background:#c9d1da;border-color:#c9d1da;color:#fff;cursor:not-allowed}
table.info{border-collapse:collapse;width:100%}table.info th,table.info td{border:1px solid #d8dee6;padding:9px 12px;text-align:left}table.info th{background:#f6f8fb;width:240px}
table.list{border-collapse:collapse;width:100%}table.list th,table.list td{border-bottom:1px solid #d8dee6;padding:10px;text-align:left}table.list th{background:#f6f8fb;font-size:13px}
.tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px}.tag.on{background:#e3f2e6;color:#1e6b34}.tag.off{background:#eceff1;color:#6b7680}
.terms{border:1px solid #d8dee6;height:200px;overflow:auto;padding:12px 16px;font-size:13px;line-height:1.8;background:#fbfcfd}
.receipt{font-size:30px;font-weight:700;letter-spacing:.08em;color:#1d5fa8}
.search{display:flex;gap:8px;margin:0 0 20px}.search input{max-width:none;flex:1}
.cols{display:grid;grid-template-columns:2fr 1fr;gap:24px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{border:1px solid #d8dee6;border-radius:4px;padding:14px;text-decoration:none;color:inherit;display:block}.card:hover{border-color:#1d5fa8;background:#f7faff}
.card b{display:block;color:#1557a0;margin-bottom:4px}.card small{color:#5b6876}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{border-bottom:1px dotted #c9d1da;padding:8px 0}ul.plain time{color:#5b6876;font-size:13px;margin-right:10px}
.side a{display:block;border:1px solid #d8dee6;border-radius:4px;padding:12px;margin-bottom:10px;text-decoration:none;font-weight:700}.side a:hover{background:#f7faff}
details{border:1px solid #d8dee6;border-radius:4px;margin-bottom:10px;padding:10px 14px}summary{cursor:pointer;font-weight:700}
footer{text-align:center;font-size:12px;color:#5b6876;padding-bottom:30px}footer a{color:#5b6876;margin:0 8px}
</style></head><body>
<div class="demo">検証用サイト：架空の自治体の手続きです。申し込んでも、どこにも送られません。</div>
<header><div class="in"><a class="home" href="/"><div class="logo">ひ</div><div><b>${SITE}</b><small>Hibarino City e-Application（検証用）</small></div></a>
<nav><a href="/procedures">手続き一覧</a><a href="/status">申込状況の照会</a><a href="/faq">よくある質問</a><a href="/guide">利用ガイド</a></nav></div></header>
${crumb.length ? `<nav class="crumb"><a href="/">トップ</a>${crumb.map((c) => ` ＞ ${c}`).join("")}</nav>` : ""}
<main>${step ? `<ol class="steps">${steps.map((s, i) => `<li class="${i + 1 === step ? "on" : ""}">${s}</li>`).join("")}</ol>` : ""}${body}</main>
<footer><a href="/guide">利用ガイド</a><a href="/faq">よくある質問</a><a href="/procedures">手続き一覧</a><br>ひばり野市（検証用・架空の自治体）</footer></body></html>`;
}

const searchBox = (q = "") => `<form class="search" method="get" action="/search"><input type="search" name="q" value="${esc(q)}" aria-label="手続きを探す" placeholder="手続きの名前やことばで探す（例: 水道、ごみ、住民票）"><button type="submit">検索</button></form>`;

const top = () => page("トップ", { body: `${searchBox()}
<div class="alert"><b>重要なお知らせ</b>　<a href="/news/1">${NEWS[0][1]}</a></div>
<div class="cols"><div>
<h2>よく利用される手続き</h2><div class="cards">${PROCEDURES.filter((p) => p.popular).map((p) => `<a class="card" href="/p/${p.id}"><b>${esc(p.title)}</b><small>${esc(p.dept)}</small></a>`).join("")}</div>
<h2>分類から探す</h2><div class="cards">${CATEGORIES.map((c) => `<a class="card" href="/procedures?cat=${encodeURIComponent(c)}"><b>${c}</b><small>${PROCEDURES.filter((p) => p.cat === c).length} 件の手続き</small></a>`).join("")}</div>
<h2>お知らせ</h2><ul class="plain">${NEWS.map(([d, t], i) => `<li><time>${d}</time><a href="/news/${i + 1}">${t}</a></li>`).join("")}</ul>
</div><div class="side"><h2>メニュー</h2><a href="/procedures">手続き一覧</a><a href="/status">申込状況の照会</a><a href="/faq">よくある質問</a><a href="/guide">はじめての方へ（利用ガイド）</a><a href="/login">ログイン</a></div></div>` });

const listTable = (list) => list.length
  ? `<table class="list"><tr><th>手続き名</th><th>担当</th><th>分類</th><th>受付</th></tr>${list.map((p) => `<tr><td>${procLink(p)}</td><td>${esc(p.dept)}</td><td>${p.cat}</td><td>${status(p)}</td></tr>`).join("")}</table>`
  : `<p>該当する手続きはありません。</p>`;

const procedures = (cat) => page("手続き一覧", { crumb: [cat ? `<a href="/procedures">手続き一覧</a> ＞ ${esc(cat)}` : "手続き一覧"], body: `<h1>手続き一覧${cat ? `（${esc(cat)}）` : ""}</h1>${searchBox()}
<p>${CATEGORIES.map((c) => (c === cat ? `<b>${c}</b>` : `<a href="/procedures?cat=${encodeURIComponent(c)}">${c}</a>`)).join("　|　")}${cat ? `　|　<a href="/procedures">すべて</a>` : ""}</p>
${listTable(PROCEDURES.filter((p) => !cat || p.cat === cat))}` });

const search = (q) => {
  const hits = PROCEDURES.filter((p) => q && [p.title, p.dept, p.cat, ...p.overview.map(([, t]) => t)].some((t) => t.includes(q)));
  return page("検索結果", { crumb: ["検索結果"], body: `<h1>「${esc(q)}」の検索結果（${hits.length} 件）</h1>${searchBox(q)}${listTable(hits)}` });
};

const news = (i) => page(NEWS[i][1], { crumb: ["お知らせ"], body: `<h1>${NEWS[i][1]}</h1><p class="note">${NEWS[i][0]}</p><p>${NEWS[i][2]}</p><div class="btns"><a class="btn sub" href="/">トップへ戻る</a></div>` });

const faq = () => page("よくある質問", { crumb: ["よくある質問"], body: `<h1>よくある質問</h1>${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}` });

const guide = () => page("利用ガイド", { crumb: ["利用ガイド"], body: `<h1>はじめての方へ（利用ガイド）</h1>
<h2>申込の流れ</h2><ol><li>手続き一覧や検索から、申し込む手続きを選びます。</li><li>手続きの説明を読み、利用規約に同意します。</li><li>申込内容を入力し、確認画面で内容を確かめて申し込みます。</li><li>完了画面の受付番号を控えます。</li></ol>
<h2>推奨環境</h2><p>Google Chrome、Microsoft Edge、Safari の最新版</p><h2>このサイトについて</h2><p>架空の自治体の手続きを再現した検証用のサイトです。申し込んだ内容は、どこにも送られません。</p>` });

const login = () => page("ログイン", { crumb: ["ログイン"], body: `<h1>ログイン</h1><p>この検証用サイトでは利用者登録・ログインはできません。各手続きは利用者登録せずに申し込めます。</p><div class="btns"><a class="btn" href="/procedures">手続き一覧へ</a></div>` });

const received = []; // 申込状況の照会用（起動中だけ）
const statusPage = (no) => {
  const r = no && received.find((x) => x.receiptNo === no);
  return page("申込状況の照会", { crumb: ["申込状況の照会"], body: `<h1>申込状況の照会</h1>
<form method="get" action="/status"><dl class="form"><dt><label for="no">受付番号</label></dt><dd><input type="text" id="no" name="no" value="${esc(no)}" placeholder="申込完了の画面に表示された番号"></dd></dl><div class="btns"><button type="submit">照会する</button></div></form>
${no ? (r ? `<h2>照会結果</h2><table class="info"><tr><th>受付番号</th><td>${r.receiptNo}</td></tr><tr><th>手続き名</th><td>${esc(r.procedure)}</td></tr><tr><th>受付日時</th><td>${r.at}</td></tr><tr><th>状況</th><td><span class="tag on">受付済み（担当課で確認中）</span></td></tr></table>`
    : `<div class="errors">受付番号「${esc(no)}」の申込は見つかりません。番号を確かめてください。</div>`) : ""}` });
};

// ---- 手続き（説明 → 利用規約 → 入力 → 確認 → 完了）----
const crumbOf = (p, last) => [`<a href="/procedures">手続き一覧</a>`, `<a href="/procedures?cat=${encodeURIComponent(p.cat)}">${p.cat}</a>`, last ? `<a href="/p/${p.id}">${esc(p.title)}</a> ＞ ${last}` : esc(p.title)];

const detail = (p) => page(p.title, { crumb: crumbOf(p), step: p.open ? 1 : 0, body: `<h1>${esc(p.title)}</h1><p>${status(p)}　担当: ${esc(p.dept)}</p>
<table class="info">${p.overview.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
${p.open ? `<div class="btns"><a class="btn sub" href="/login">ログインして申し込む</a><a class="btn" href="/p/${p.id}/terms">利用者登録せずに申し込む方はこちら</a></div>`
    : `<div class="btns"><span class="btn dis" aria-disabled="true">受付は終了しました</span></div>`}` });

const terms = (p, err) => page("利用規約", { crumb: crumbOf(p, "利用規約"), step: 2, body: `<h1>利用規約</h1>${err ? `<div class="errors">${esc(err)}</div>` : ""}
<div class="terms">第1条（目的）この規約は、${SITE}を利用して「${esc(p.title)}」を行う際の条件を定めるものです。<br>
第2条（申込内容）申込者は、正確な情報を入力するものとします。<br>
第3条（個人情報）入力された個人情報は、この手続きにのみ利用します。<br>第4条（免責）通信障害等により申込が届かなかった場合、市は責任を負いません。<br>
（検証用の架空の規約です）</div>
<form method="post" action="/p/${p.id}/terms"><p><label><input type="checkbox" name="agree" value="1"> 利用規約に同意する</label></p>
<div class="btns"><a class="btn sub" href="/p/${p.id}">戻る</a><button type="submit">同意して進む</button></div></form>` });

function form(p, v = {}, errs = {}) {
  const row = ({ n, label, type, req, note, options, def }) => {
    let input;
    if (type === "select") input = `<select id="${n}" name="${n}"><option value="">選択してください</option>${options.map((o) => `<option${v[n] === o ? " selected" : ""}>${o}</option>`).join("")}</select>`;
    else if (type === "radio") input = options.map((o) => `<label><input type="radio" name="${n}" value="${o}"${(v[n] ?? def) === o ? " checked" : ""}> ${o}</label>`).join("　"); // 実際の申込画面と同じく既定の選択肢が選ばれた状態で始まる
    else input = `<input type="${type}" id="${n}" name="${n}" value="${esc(v[n])}"${note ? ` placeholder="${esc(note)}"` : ""}>`;
    return `<dt>${type === "radio" ? label : `<label for="${n}">${label}</label>`}${req ? `<span class="req">必須</span>` : ""}</dt>
<dd>${input}${note && type !== "text" && type !== "tel" ? `<div class="note">${esc(note)}</div>` : ""}${errs[n] ? `<div class="err">${esc(errs[n])}</div>` : ""}</dd>`;
  };
  const k = Object.keys(errs).length;
  return page("申込内容の入力", { crumb: crumbOf(p, "申込内容の入力"), step: 3, body: `<h1>申込内容の入力</h1>${k ? `<div class="errors">入力内容に誤りが ${k} 件あります。赤字の項目を確認してください。</div>` : ""}
<form method="post" action="/p/${p.id}/confirm">${p.sections.map(([h, f]) => `<h2>${h}</h2><dl class="form">${f.map(row).join("")}</dl>`).join("")}
<div class="btns"><a class="btn sub" href="/p/${p.id}/terms">戻る</a><button type="submit">確認へ進む</button></div></form>` });
}

const confirm = (p, v) => page("入力内容の確認", { crumb: crumbOf(p, "入力内容の確認"), step: 4, body: `<h1>入力内容の確認</h1><p>以下の内容で申し込みます。よろしければ「この内容で申し込む」を押してください。</p>
<table class="info">${fieldsOf(p).map(({ n, label }) => `<tr><th>${label}</th><td>${esc(v[n])}</td></tr>`).join("")}</table>
<div class="btns"><form method="post" action="/p/${p.id}/form">${hidden(p, v)}<button class="sub" type="submit">入力画面に戻る</button></form>
<form method="post" action="/p/${p.id}/complete">${hidden(p, v)}<button type="submit">この内容で申し込む</button></form></div>` });

const complete = (p, no) => page("申込完了", { crumb: crumbOf(p, "申込完了"), step: 5, body: `<h1>申込完了</h1><p>${p.done}</p>
<table class="info"><tr><th>受付番号</th><td class="receipt">${no}</td></tr><tr><th>手続き名</th><td>${esc(p.title)}</td></tr></table>
<p class="note">受付番号は、お問い合わせや<a href="/status?no=${no}">申込状況の照会</a>の際に必要です。控えておいてください。</p>` });

function validate(p, v) {
  const errs = {};
  for (const { n, check } of fieldsOf(p)) {
    const r = check(v[n] ?? "");
    if (r !== true) errs[n] = r;
  }
  return errs;
}

async function body(req) {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 100_000) break;
  }
  return Object.fromEntries([...new URLSearchParams(s)].map(([k, x]) => [k, x.trim()]));
}

let seq = 0;
http.createServer(async (req, res) => {
  const send = (html, code = 200) => res.writeHead(code, { "content-type": "text/html; charset=utf-8" }).end(html);
  const notFound = () => send(page("ページが見つかりません", { body: `<h1>ページが見つかりません</h1><p><a href="/">トップへ戻る</a></p>` }), 404);
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  if (path === "/favicon.ico") return res.writeHead(204).end();
  if (req.method === "GET") {
    if (path === "/") return send(top());
    if (path === "/procedures") return send(procedures(url.searchParams.get("cat")));
    if (path === "/search") return send(search((url.searchParams.get("q") ?? "").trim()));
    if (path === "/faq") return send(faq());
    if (path === "/guide") return send(guide());
    if (path === "/login") return send(login());
    if (path === "/status") return send(statusPage((url.searchParams.get("no") ?? "").trim()));
    const nm = path.match(/^\/news\/(\d+)$/);
    if (nm && NEWS[nm[1] - 1]) return send(news(nm[1] - 1));
  }
  const m = path.match(/^\/p\/([\w-]+)(?:\/(terms|form|confirm|complete))?$/);
  const p = m && PROCEDURES.find((x) => x.id === m[1]);
  if (!p) return notFound();
  const stepName = m[2];
  if (req.method === "GET" && !stepName) return send(detail(p));
  if (!p.open) return send(detail(p));
  if (req.method === "GET" && stepName === "terms") return send(terms(p));
  if (req.method !== "POST") return notFound();
  const v = await body(req);
  if (stepName === "terms") return v.agree ? send(form(p)) : send(terms(p, "利用規約に同意してください"));
  if (stepName === "form") return send(form(p, v));
  const errs = validate(p, v);
  if (Object.keys(errs).length) return send(form(p, v, errs));
  if (stepName === "confirm") return send(confirm(p, v));
  // complete
  const d = new Date();
  const no = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(++seq + 4100).padStart(5, "0")}`;
  const values = Object.fromEntries(fieldsOf(p).map(({ n }) => [n, v[n]]));
  received.push({ receiptNo: no, procedure: p.title, at: d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) });
  if (received.length > 200) received.shift();
  writeFileSync(join(WORK_DIR, "site-received.json"), JSON.stringify({ procedure: p.title, receiptNo: no, values }, null, 2));
  send(complete(p, no));
}).listen(PORT, HOST, () => console.log(`検証用の申請サイト: http://${HOST}:${PORT}/`));
