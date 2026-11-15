"""
3分プレゼン用の PPTX を作る。

  python3 demo/build_deck.py demo/out/omakase-demo.mp4 demo/out/poster.png "demo/out/おまかせ手続き_3分資料.pptx"

動画は PowerPoint に埋め込み（poster 画像つき）、スライドには発表者メモで 3 分の台本を入れる。
"""
import sys, os, shutil, zipfile, tempfile
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree
from PIL import Image

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "demo/out/omakase-demo.mp4"
POSTER = sys.argv[2] if len(sys.argv) > 2 else "demo/out/poster.png"
OUT = sys.argv[3] if len(sys.argv) > 3 else "demo/out/おまかせ手続き_3分資料.pptx"

PAPER = RGBColor(0xF7, 0xF3, 0xEA)
CARD = RGBColor(0xFF, 0xFD, 0xF8)
INK = RGBColor(0x23, 0x20, 0x1B)
MUTED = RGBColor(0x6D, 0x66, 0x5B)
LINE = RGBColor(0xDE, 0xD5, 0xC3)
ACCENT = RGBColor(0xC4, 0x53, 0x2D)
ACCENT_SOFT = RGBColor(0xFB, 0xE9, 0xE1)
NAVY = RGBColor(0x1F, 0x3B, 0x57)
NAVY_SOFT = RGBColor(0xE6, 0xED, 0xF3)
OK = RGBColor(0x2F, 0x7D, 0x4F)
OK_SOFT = RGBColor(0xE3, 0xF2, 0xE8)
FONT = "Hiragino Sans"

W, H = 13.333, 7.5

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]


def slide(notes: str):
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = PAPER
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    return s


def text(s, x, y, w, h, runs, size=18, bold=False, color=INK, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, spacing=1.35, font=FONT):
    """runs: str か [(text, {size,bold,color})...]"""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    items = runs if isinstance(runs, list) else [(runs, {})]
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = spacing
    for i, (t, opt) in enumerate(items):
        if i > 0:
            p = tf.add_paragraph()
            p.alignment = align
            p.line_spacing = spacing
        r = p.add_run()
        r.text = t
        r.font.size = Pt(opt.get("size", size))
        r.font.bold = opt.get("bold", bold)
        r.font.color.rgb = opt.get("color", color)
        r.font.name = font
    return tb


def rect(s, x, y, w, h, fill=CARD, line=LINE, radius=0.08, line_w=0.75):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = radius
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(line_w)
    sh.shadow.inherit = False
    sh.text_frame.text = ""
    return sh


def circle(s, x, y, d, fill, label, size=20, color=RGBColor(0xFF, 0xFF, 0xFF)):
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
    c.fill.solid()
    c.fill.fore_color.rgb = fill
    c.line.fill.background()
    c.shadow.inherit = False
    tf = c.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size = Pt(size)
    r.font.bold = True
    r.font.color.rgb = color
    r.font.name = FONT
    return c


def pill(s, x, y, w, h, label, fill, color, size=12):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = 0.5
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.fill.background()
    sh.shadow.inherit = False
    tf = sh.text_frame
    tf.margin_left = tf.margin_right = Inches(0.12)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.size = Pt(size)
    r.font.bold = True
    r.font.color.rgb = color
    r.font.name = FONT
    return sh


def header(s, kicker, title, sub=None):
    text(s, 0.9, 0.5, 8, 0.3, kicker, size=13, bold=True, color=ACCENT)
    text(s, 0.9, 0.86, 11.6, 1.2, title, size=34, bold=True, color=INK, spacing=1.2)
    if sub:
        text(s, 0.9, 1.78, 11.0, 0.5, sub, size=14, color=MUTED)


def rule(s, x, y, w, color=ACCENT, h=0.06):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid()
    sh.fill.fore_color.rgb = color
    sh.line.fill.background()
    sh.shadow.inherit = False


# ---------------------------------------------------------------- 1. 表紙
s = slide(
    "0:00-0:20 タイトル。\n"
    "「役所からの通知、読めますか？」と会場に問いかけてから、製品名を出します。\n"
    "届いた通知を撮るだけで、AI が隔離されたパソコンを操作して手続きを終える——この1文だけを覚えてもらいます。"
)
rect(s, 0.9, 1.5, 0.95, 0.95, fill=ACCENT, line=None, radius=0.22)
text(s, 0.9, 1.62, 0.95, 0.7, "お", size=40, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), align=PP_ALIGN.CENTER)
text(s, 2.05, 1.5, 10.4, 1.0, "おまかせ手続き", size=54, bold=True)
text(s, 2.1, 2.36, 8, 0.3, "O M A K A S E   T E T S U Z U K I", size=12, color=MUTED)
rule(s, 0.9, 2.95, 4.9)
text(s, 0.9, 3.35, 10.6, 1.7,
     [("届いた通知を撮るだけ。", {}), ("AI が、隔離されたパソコンで手続きを代行します。", {})],
     size=30, bold=True, color=INK, spacing=1.45)
pill(s, 0.9, 5.5, 1.25, 0.42, "Daytona", NAVY_SOFT, NAVY)
pill(s, 2.25, 5.5, 1.2, 0.42, "Nosana", ACCENT_SOFT, ACCENT)
pill(s, 3.55, 5.5, 3.3, 0.42, "Daytona HackSprint Tokyo 2026", RGBColor(0xEF, 0xE9, 0xDC), MUTED)
text(s, 0.9, 6.5, 11.5, 0.4, "2026-11-15　発表 3分　／　デモは実際の画面録画（Docker デスクトップ版）", size=12, color=MUTED)

# ---------------------------------------------------------------- 2. 課題
s = slide(
    "0:20-0:55 課題。\n"
    "高齢者の一人暮らし世帯。「何を・いつまでに」が分からないまま期限が過ぎる。\n"
    "いまは離れて暮らす家族が電話で聞き取り、親の ID とパスワードを預かって代行している。\n"
    "これは本人の負担でもあり、家族の不安でもある、と伝えます。"
)
header(s, "解決する課題", "読めない通知で、手続きが止まっている。")
cards = [
    ("役所の通知は、文面がむずかしい", "何を・いつまでに・どこで。専門の言葉で書かれている"),
    ("分からないまま、期限が過ぎる", "電子申請が増えても、画面を操作できなければ使えない"),
    ("家族が ID とパスワードを預かって代行", "電話で聞き取り、休日に実家の手続きをしている"),
]
for i, (t, d) in enumerate(cards):
    x = 0.9 + i * 4.0
    rect(s, x, 2.6, 3.7, 2.5)
    circle(s, x + 0.3, 2.85, 0.5, NAVY, str(i + 1), size=16)
    text(s, x + 0.3, 3.55, 3.1, 1.0, t, size=17, bold=True, spacing=1.3)
    text(s, x + 0.3, 4.45, 3.1, 0.5, d, size=11, color=MUTED, spacing=1.35)
text(s, 0.9, 5.6, 6.6, 0.4, "15秒で読める3行と、操作を代わりにやってくれる1台。", size=15, bold=True, color=ACCENT)
if os.path.exists("fixtures/bill.png"):
    s.shapes.add_picture("fixtures/bill.png", Inches(8.1), Inches(5.2), height=Inches(1.75))
    text(s, 10.0, 6.3, 2.6, 0.3, "見本の請求書（架空）", size=10, color=MUTED)

# ---------------------------------------------------------------- 3. 解決策
s = slide(
    "0:55-1:25 解決策。\n"
    "4つのステップ。①撮る ②3行で説明 ③隔離マシンでAIが操作 ④本人の「はい」で送信。\n"
    "ポイントは、最後まで人の判断を残すこと。送信の直前だけ本人に戻します。\n"
    "このあと約1分の実演（実際の画面録画）を流します。"
)
header(s, "解決策", "撮る → 3行 → 隔離マシンで代行 → 「はい」で送信", "すべて、実際に動く画面で確かめられます。")
steps = [
    ("1", "撮るだけ", "通知・案内・記入例を撮影して送る。", NAVY),
    ("2", "3行で説明", "何の書類か・いつまでに・何をするか。大きな字と音声で。", ACCENT),
    ("3", "隔離マシンで代行", "Daytona のサンドボックスで、AI がブラウザを操作して入力。", NAVY),
    ("4", "「はい」で送信", "読み上げて承認。送信内容は検証スクリプトで照合（exit 0）。", OK),
]
for i, (n, t, d, c) in enumerate(steps):
    x = 0.9 + i * 3.05
    rect(s, x, 2.45, 2.85, 3.15, line=c, line_w=1.5)
    circle(s, x + 0.28, 2.68, 0.56, c, n, size=18)
    text(s, x + 0.28, 3.42, 2.3, 0.4, t, size=19, bold=True, color=c)
    text(s, x + 0.28, 3.95, 2.32, 1.4, d, size=12.5, color=INK, spacing=1.45)
text(s, 0.9, 5.95, 11.5, 0.5,
     [("書類から読めない項目（口座など）だけ", {"bold": True, "color": ACCENT}),
      ("をご本人に質問。読んだ値はすべて、原文とセットで残します。", {})],
     size=14, color=INK)

# ---------------------------------------------------------------- 4. デモ動画
s = slide(
    "1:25-2:25 デモ（約60秒・音声なし）。\n"
    "見どころは2つ。右側のライブ画面でAIが実際にフォームを埋めていくこと、最後に exit 0 で照合が通ること。\n"
    "ナレーション：通知を撮ると3行に。隔離マシンが立ち上がり、申請サイトを操作。分からない口座だけ本人に聞き、"
    "読み上げて「はい」。送信後は受付番号 2026111504101 と、32項目の照合（exit 0）。"
)
header(s, "デモ", "実際の画面録画 — 通知1枚から、送信と照合まで", "Docker デスクトップ版（Daytona の Computer Use と同じ構成）で収録")
# ここに動画（poster は後で差し替え)
video_w, video_h = 9.05, 5.09
vx, vy = 0.9, 2.28
pic = s.shapes.add_picture(POSTER, Inches(vx), Inches(vy), Inches(video_w), Inches(video_h))
side_x = 10.25
for i, (t, d) in enumerate([
    ("約6秒で起動", "依頼ごとに隔離マシンを作り、終わったら破棄"),
    ("1手ずつ判断", "画面を文字で読み、次の操作をモデルが決める"),
    ("exit 0 で合格", "確認画面・受付番号・値の出どころを機械で照合"),
]):
    y = 2.35 + i * 1.62
    rect(s, side_x, y, 2.7, 1.35, fill=CARD)
    text(s, side_x + 0.18, y + 0.14, 2.35, 0.35, t, size=13, bold=True, color=ACCENT)
    text(s, side_x + 0.18, y + 0.55, 2.35, 0.7, d, size=10, color=MUTED, spacing=1.35)
text(s, vx, 7.15, 9.0, 0.3, "※ 申請先は隔離マシン内の検証用サイト（架空の「ひばり野市」）。実在のサイトには何も送りません。", size=9.5, color=MUTED)

# ---------------------------------------------------------------- 5. しくみ
s = slide(
    "2:25-2:55 しくみとスポンサー活用。\n"
    "Daytona は実行・検証・ライブ配信・破棄まで中核。Nosana は個人情報を含む画像を外の API に出さず、自分で動かす推論基盤。\n"
    "そして、モデルに任せない部分をコードで守っている、というのが審査で一番伝えたいところ。"
)
header(s, "しくみ", "個人情報は外に出さず、操作は隔離マシンで。")
nodes = [
    ("紙の通知", "請求書・案内・様式", MUTED, RGBColor(0xEF, 0xE9, 0xDC)),
    ("Nosana", "GPU 上の OSS モデルが読む\n3行 + 氏名・住所を抽出", ACCENT, ACCENT_SOFT),
    ("Daytona", "依頼ごとの隔離マシン\nブラウザ操作・検証・破棄", NAVY, NAVY_SOFT),
    ("ご本人・ご家族", "「はい」で送信\n整理番号と完了通知", OK, OK_SOFT),
]
for i, (t, d, c, bg) in enumerate(nodes):
    x = 0.9 + i * 3.05
    rect(s, x, 2.15, 2.72, 1.85, fill=bg, line=LINE)
    rule(s, x, 2.15, 2.72, color=c, h=0.09)
    text(s, x + 0.22, 2.42, 2.3, 0.4, t, size=17, bold=True, color=c)
    text(s, x + 0.22, 2.9, 2.3, 0.9, d, size=10.5, color=INK, spacing=1.4)
    if i < 3:
        text(s, x + 2.72, 2.85, 0.35, 0.4, "›", size=26, bold=True, color=MUTED, align=PP_ALIGN.CENTER)
guards = [
    ("値には、必ず出どころ", "書類の原文・本人の回答・家族の設定。出どころの無い値は入力しない"),
    ("送信の前に、本人の承認", "読み上げて「はい」。家族はデスクトップをライブで見守る"),
    ("終わったら、マシンごと破棄", "個人情報を次の依頼に残さない"),
]
for i, (t, d) in enumerate(guards):
    x = 0.9 + i * 4.0
    rect(s, x, 4.35, 3.7, 1.25, fill=CARD)
    text(s, x + 0.25, 4.5, 3.2, 0.35, t, size=14, bold=True, color=INK)
    text(s, x + 0.25, 4.9, 3.25, 0.6, d, size=10, color=MUTED, spacing=1.35)
pill(s, 0.9, 5.95, 3.6, 0.4, "Daytona：実行・検証・ライブ配信・破棄", NAVY_SOFT, NAVY, size=11)
pill(s, 4.65, 5.95, 3.0, 0.4, "Nosana：推論を自分で動かす", ACCENT_SOFT, ACCENT, size=11)
text(s, 0.9, 6.55, 11.5, 0.4, "検証はモデルを使わず、申請サイトの確認画面と受け取った内容を突き合わせる（合格で exit 0）。", size=11.5, color=MUTED)

# ---------------------------------------------------------------- 6. まとめ
s = slide(
    "2:55-3:00 まとめ。\n"
    "「読めなかった通知が、『はい』と言うだけで終わる」。この一文で締めます。\n"
    "次は、自治体の様式のばらつきと、本人確認（マイナンバーカード）への対応。"
)
text(s, 0.9, 2.05, 11.6, 2.4,
     [("読めなかった通知が、", {}), ("「はい」と言うだけ", {"color": ACCENT}), ("で終わる。", {})],
     size=46, bold=True, spacing=1.35)
rect(s, 0.9, 4.45, 0.95, 0.95, fill=ACCENT, line=None, radius=0.22)
text(s, 0.9, 4.57, 0.95, 0.7, "お", size=40, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), align=PP_ALIGN.CENTER)
text(s, 2.05, 4.5, 6, 0.45, "おまかせ手続き", size=24, bold=True)
text(s, 2.1, 5.0, 8, 0.35, "Daytona HackSprint Tokyo 2026 — Daytona / Nosana", size=12, color=MUTED)
text(s, 0.9, 6.1, 11.5, 0.4, "次の一歩：自治体ごとの様式差、マイナンバーカードによる本人確認、家族への定期レポート。", size=12, color=MUTED)

prs.save(OUT)

# ---------------------------------------------------------------- 動画の埋め込み
def embed_video(pptx_path, video_path, poster_path, left, top, width, height):
    """poster 画像の pic に <a:videoFile> を足して、mp4 を pptx に同梱する。"""
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(pptx_path) as z:
        names = z.namelist()
        slide_xml = z.read("ppt/slides/slide4.xml").decode("utf-8")
        rels_xml = z.read("ppt/slides/_rels/slide4.xml.rels").decode("utf-8")
        z.extractall(tmp)

    # 既存の最大 rId の次を使う
    import re as _re
    ids = [int(m) for m in _re.findall(r'Id="rId(\d+)"', rels_xml)]
    rid = f"rId{max(ids) + 1}"
    media_name = "media1.mp4"
    shutil.copy(video_path, os.path.join(tmp, "ppt", "media", media_name))

    ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    rels_root = etree.fromstring(rels_xml.encode("utf-8"))
    rel = etree.SubElement(rels_root, f"{{{ns}}}Relationship")
    rel.set("Id", rid)
    rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video")
    rel.set("Target", f"../media/{media_name}")
    with open(os.path.join(tmp, "ppt/slides/_rels/slide4.xml.rels"), "wb") as f:
        f.write(etree.tostring(rels_root, xml_declaration=True, encoding="UTF-8", standalone=True))

    # pic の nvPicPr/nvPr に videoFile を足す
    p_ns = "http://schemas.openxmlformats.org/presentationml/2006/main"
    a_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    root = etree.fromstring(slide_xml.encode("utf-8"))
    pics = root.findall(f".//{{{p_ns}}}pic")
    target = None
    for pic in pics:
        blip = pic.find(f".//{{{a_ns}}}blip")
        if blip is not None and blip.get(f"{{http://schemas.openxmlformats.org/officeDocument/2006/relationships}}embed"):
            target = pic
    assert target is not None, "poster の pic が見つかりません"
    nv_pr = target.find(f"{{{p_ns}}}nvPicPr/{{{p_ns}}}nvPr")
    video = etree.SubElement(nv_pr, f"{{{a_ns}}}videoFile")
    video.set(f"{{http://schemas.openxmlformats.org/officeDocument/2006/relationships}}link", rid)
    ext_lst = etree.SubElement(nv_pr, f"{{{p_ns}}}extLst")
    ext = etree.SubElement(ext_lst, f"{{{p_ns}}}ext")
    ext.set("uri", "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}")
    media = etree.SubElement(ext, "{http://schemas.microsoft.com/office/powerpoint/2010/main}media")
    media.set(f"{{http://schemas.openxmlformats.org/officeDocument/2006/relationships}}embed", rid)
    with open(os.path.join(tmp, "ppt/slides/slide4.xml"), "wb") as f:
        f.write(etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True))

    # [Content_Types].xml に mp4 を足す
    ct_path = os.path.join(tmp, "[Content_Types].xml")
    ct = open(ct_path, "rb").read().decode("utf-8")
    if 'Extension="mp4"' not in ct:
        ct = ct.replace("</Types>", '<Default Extension="mp4" ContentType="video/mp4"/></Types>')
        open(ct_path, "w").write(ct)

    out_tmp = pptx_path + ".tmp"
    with zipfile.ZipFile(out_tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(tmp):
            for fn in files:
                full = os.path.join(base, fn)
                z.write(full, os.path.relpath(full, tmp))
    shutil.move(out_tmp, pptx_path)
    shutil.rmtree(tmp)


if os.path.exists(VIDEO):
    embed_video(OUT, VIDEO, POSTER, vx, vy, video_w, video_h)
    print(f"動画を埋め込みました: {VIDEO}")
print("saved", OUT)
