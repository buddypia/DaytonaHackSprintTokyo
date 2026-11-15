import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Img } from "remotion";
import { C, FONT, MONO } from "./theme";
import { Caption, Chip, Fade, Headline, Paper, Screen, Shot } from "./ui";

const APP = "app1.mp4"; // 実際に動かした画面（1600x900）
const DESK = "desk.mp4"; // 隔離マシンのデスクトップ（1440x900 / noVNC）

// 16:9 の画面枠（右）と、説明（左）
const SCR = { x: 668, y: 198, w: 1140, h: 641 };
const FRAME_H = SCR.h + 44;

const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => <Paper>{children}</Paper>;

const Side: React.FC<{
  n: string;
  title: string;
  sub?: string;
  extra?: React.ReactNode;
  from?: number;
  accent?: string;
}> = ({ n, title, sub, extra, from = 0, accent = C.accent }) => (
  <div style={{ position: "absolute", left: 96, top: 0, bottom: 0, width: 512, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ width: 52, height: 52, borderRadius: 999, background: accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 26, fontWeight: 800 }}>{n}</span>
      <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.16em", color: accent }}>STEP {n}</span>
    </div>
    <Caption text={title} sub={sub} from={from} />
    {extra}
  </div>
);

// 1. タイトル
const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const line = interpolate(frame, [10, 34], [0, 1], { extrapolateRight: "clamp" });
  return (
    <Stage>
      <AbsoluteFill style={{ padding: "0 130px", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.8 + mark * 0.2})`, opacity: mark }}>
          <div style={{ width: 128, height: 128, borderRadius: 32, background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 76, fontWeight: 800, boxShadow: "0 24px 50px rgba(196,83,45,0.35)" }}>お</div>
          <div>
            <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: "0.04em", lineHeight: 1.05 }}>おまかせ手続き</div>
            <div style={{ fontFamily: MONO, fontSize: 24, color: C.muted, letterSpacing: "0.28em", marginTop: 8 }}>OMAKASE TETSUZUKI</div>
          </div>
        </div>
        <div style={{ height: 8, width: 640 * line, background: C.accent, borderRadius: 99, margin: "46px 0 34px" }} />
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.55, color: C.ink, opacity: line }}>
          届いた通知を撮るだけ。
          <br />
          AI が、隔離されたパソコンで手続きを代行します。
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 44, opacity: line }}>
          <Chip color={C.navy}>Daytona</Chip>
          <Chip color={C.accent} bg={C.accentSoft}>Nosana</Chip>
          <Chip color={C.muted} bg="#efe9dc">Daytona HackSprint Tokyo 2026</Chip>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

// 2. 課題
const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = [
    ["役所の通知は、文面がむずかしい", "何を・いつまでに・どこで"],
    ["分からないまま、期限が過ぎていく", "電子申請の画面にも、たどり着けない"],
    ["家族が ID とパスワードを預かって代行", "電話で聞き取り、休日に手続き"],
  ];
  return (
    <Stage>
      <AbsoluteFill style={{ padding: "76px 120px" }}>
        <Fade from={0}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.2em", color: C.accent }}>解決する課題</div>
        </Fade>
        <div style={{ marginTop: 14 }}>
          <Headline lines={["読めない通知で、", "手続きが止まっている。"]} size={78} delay={4} />
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 44 }}>
          {rows.map(([t, s], i) => {
            const r = spring({ frame: frame - 24 - i * 12, fps, config: { damping: 18 } });
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  background: C.card,
                  border: `1px solid ${C.line}`,
                  borderRadius: 22,
                  padding: "26px 28px 30px",
                  boxShadow: "0 18px 40px rgba(30,26,20,0.08)",
                  opacity: r,
                  transform: `translateY(${(1 - r) * 34}px)`,
                }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 999, background: C.navy, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 21 }}>{i + 1}</div>
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.45, marginTop: 16 }}>{t}</div>
                <div style={{ fontSize: 21, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>{s}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 26, marginTop: 40 }}>
          <Fade from={66}>
            <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
              <div style={{ fontSize: 22, color: C.muted, textAlign: "right", lineHeight: 1.7 }}>
                15秒で読める3行と、
                <br />
                操作を代わりにやってくれる1台。
              </div>
              <Img src={staticFile("bill.png")} style={{ width: 250, borderRadius: 12, boxShadow: "0 22px 44px rgba(30,26,20,0.28)", transform: "rotate(-3deg)" }} />
            </div>
          </Fade>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

// 3. ① 撮るだけ
const Step1: React.FC = () => (
  <Stage>
    <Sequence durationInFrames={80} layout="none">
      <Shot
        src={APP}
        from={0.6}
        sourceW={1600}
        sourceH={900}
        crop={{ x: 108, y: 148, w: 694, h: 390 }}
        width={SCR.w}
        height={FRAME_H}
        label="localhost:8787 — ご本人の画面"
        style={{ position: "absolute", left: SCR.x, top: SCR.y }}
      />
    </Sequence>
    <Sequence from={80} durationInFrames={130} layout="none">
      <Shot
        src={APP}
        from={8.8}
        sourceW={1600}
        sourceH={900}
        crop={{ x: 108, y: 146, w: 694, h: 390 }}
        width={SCR.w}
        height={FRAME_H}
        label="localhost:8787 — ご本人の画面"
        style={{ position: "absolute", left: SCR.x, top: SCR.y }}
      />
    </Sequence>
    <Side
      n="1"
      title="写真を1枚送るだけ"
      sub="送ると「何の書類か・いつまでに・何をするか」を3行に。大きな字で読み上げ、書類の氏名・住所・番号も原文とセットで取り出します。"
      from={10}
      extra={
        <Fade from={40}>
          <div style={{ display: "flex", gap: 12 }}>
            <Chip color={C.navy}>画像1枚</Chip>
            <Chip color={C.accent} bg={C.accentSoft}>3行 + 音声</Chip>
          </div>
        </Fade>
      }
    />
  </Stage>
);

// 4. ② 隔離マシンで操作
const Step2: React.FC = () => {
  const frame = useCurrentFrame();
  const badge = spring({ frame: frame - 24, fps: 30, config: { damping: 200 } });
  return (
    <Stage>
      <Sequence durationInFrames={200} layout="none">
        <Shot src={DESK} from={12.2} rate={1.25} sourceW={1440} sourceH={900} width={SCR.w} height={FRAME_H} label="Daytona sandbox — 隔離マシンのデスクトップ" live style={{ position: "absolute", left: SCR.x, top: SCR.y }} />
      </Sequence>
      <Sequence from={200} durationInFrames={175} layout="none">
        <Shot src={DESK} from={23.5} rate={1.35} sourceW={1440} sourceH={900} width={SCR.w} height={FRAME_H} label="Daytona sandbox — 隔離マシンのデスクトップ" live style={{ position: "absolute", left: SCR.x, top: SCR.y }} />
      </Sequence>
      <Side
        n="2"
        title={"隔離マシンが、\n申請サイトを操作する"}
        sub="Daytona のサンドボックスを依頼ごとに起動。AI は画面を読み、次の一手を決めて入力・選択・送信まで進めます。"
        from={10}
        extra={
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", opacity: badge, transform: `translateY(${(1 - badge) * 18}px)` }}>
            <Chip color={C.navy}>起動 約6秒</Chip>
            <Chip color={C.ok} bg={C.okSoft}>家族はライブで見守る（noVNC）</Chip>
          </div>
        }
      />
    </Stage>
  );
};

// 5. ③ 分からないことだけ聞く
const Step3: React.FC = () => (
  <Stage>
    <Shot
      src={APP}
      from={49.9}
      rate={0.55}
      sourceW={1600}
      sourceH={900}
      crop={{ x: 108, y: 578, w: 694, h: 390 }}
      width={SCR.w}
      height={FRAME_H}
      label="localhost:8787 — ご本人の画面"
      style={{ position: "absolute", left: SCR.x, top: SCR.y }}
    />
    <Side
      n="3"
      title={"分からないことだけ、\n本人に聞く"}
      sub="書類から読めない項目（口座の情報など）は、選択肢か声で1つずつ。書類に書かれた値は、原文とセットで残します。"
      from={6}
      extra={
        <Fade from={30}>
          <Chip color={C.accent} bg={C.accentSoft}>選択肢・音声・文字</Chip>
        </Fade>
      }
    />
  </Stage>
);

// 6. ④ 承認して送信
const Step4: React.FC = () => (
  <Stage>
    <Shot src={DESK} from={50.0} rate={1.0} sourceW={1440} sourceH={900} width={SCR.w} height={FRAME_H} label="Daytona sandbox — 申請サイトの確認画面" live style={{ position: "absolute", left: SCR.x, top: SCR.y }} />
    <Side
      n="4"
      title="読み上げて、「はい」で送信"
      sub="入力内容を出どころごとに読み上げ、本人の承認が出てから申込ボタンを押します。"
      from={7}
      extra={
        <Fade from={20}>
          <div style={{ display: "flex", gap: 12 }}>
            <Chip color={C.ok} bg={C.okSoft}>はい / いいえ</Chip>
            <Chip color={C.muted} bg="#efe9dc">押す前に確認</Chip>
          </div>
        </Fade>
      }
    />
  </Stage>
);

// 7. 検証と完了
const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ok = spring({ frame: frame - 24, fps, config: { damping: 16 } });
  return (
    <Stage>
      <Shot src={DESK} from={61.0} rate={1} sourceW={1440} sourceH={900} width={SCR.w} height={FRAME_H} label="Daytona sandbox — 申請サイトの完了画面" live style={{ position: "absolute", left: SCR.x, top: SCR.y }} />
      <Side
        n="5"
        title={"送信した内容を、\n機械で照合する"}
        sub="確認画面・申請サイトが受け取った内容・すべての値の出どころを、検証スクリプトが突き合わせます。合格は exit 0。"
        from={8}
        extra={
          <div style={{ opacity: ok, transform: `translateY(${(1 - ok) * 20}px)`, display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 800, color: "#fff", background: C.ok, padding: "14px 26px", borderRadius: 14, alignSelf: "flex-start", boxShadow: "0 18px 40px rgba(47,125,79,0.32)" }}>exit 0</div>
            <div style={{ fontSize: 20, color: C.muted, lineHeight: 1.6 }}>32 項目を照合して合格。整理番号 2026111504101 をご本人とご家族へ。</div>
          </div>
        }
      />
    </Stage>
  );
};

// 8. 仕組み（Daytona と Nosana）
const Arch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nodes = [
    { t: "紙の通知", s: "請求書・案内・様式", c: C.muted, bg: "#efe9dc" },
    { t: "Nosana", s: "GPU 上の OSS モデルが読む\n3行 + 氏名・住所などを抽出", c: C.accent, bg: C.accentSoft },
    { t: "Daytona", s: "依頼ごとの隔離マシン\nブラウザ操作・検証・破棄", c: C.navy, bg: C.navySoft },
    { t: "ご本人・ご家族", s: "「はい」で送信\n整理番号と完了通知", c: C.ok, bg: C.okSoft },
  ];
  return (
    <Stage>
      <AbsoluteFill style={{ padding: "72px 100px" }}>
        <Fade from={0}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.2em", color: C.accent }}>しくみ</div>
        </Fade>
        <div style={{ marginTop: 10 }}>
          <Headline lines={["個人情報は外に出さず、操作は隔離マシンで。"]} size={62} delay={4} />
        </div>
        <div style={{ display: "flex", alignItems: "stretch", marginTop: 64 }}>
          {nodes.map((n, i) => {
            const r = spring({ frame: frame - 18 - i * 14, fps, config: { damping: 18 } });
            const a = spring({ frame: frame - 26 - i * 14, fps, config: { damping: 200 } });
            return (
              <React.Fragment key={i}>
                {i > 0 ? (
                  <div style={{ width: 84, display: "grid", placeItems: "center", opacity: a }}>
                    <svg width="58" height="30" viewBox="0 0 60 30">
                      <path d="M2 15 H48" stroke={C.muted} strokeWidth="4" strokeLinecap="round" />
                      <path d="M40 4 L54 15 L40 26" fill="none" stroke={C.muted} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : null}
                <div
                  style={{
                    flex: 1,
                    background: n.bg,
                    border: `1px solid ${C.line}`,
                    borderTop: `8px solid ${n.c}`,
                    borderRadius: 20,
                    padding: "24px 24px 28px",
                    opacity: r,
                    transform: `translateY(${(1 - r) * 30}px)`,
                  }}
                >
                  <div style={{ fontSize: 32, fontWeight: 800, color: n.c, letterSpacing: "0.02em" }}>{n.t}</div>
                  <div style={{ fontSize: 19, color: C.ink, lineHeight: 1.7, marginTop: 12, whiteSpace: "pre-line" }}>{n.s}</div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <Fade from={70}>
          <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
            {[
              ["値には、必ず出どころ", "書類の原文・本人の回答・家族の設定。出どころの無い値は入力しない"],
              ["送信の前に、本人の承認", "読み上げて「はい」。家族はデスクトップをライブで見守る"],
              ["終わったら、マシンごと破棄", "個人情報を次の依頼に残さない（検証は exit 0 で合格）"],
            ].map(([t, s], i) => (
              <div key={i} style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "18px 22px 20px" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.ink }}>{t}</div>
                <div style={{ fontSize: 17, color: C.muted, marginTop: 8, lineHeight: 1.65 }}>{s}</div>
              </div>
            ))}
          </div>
        </Fade>
        <Fade from={90}>
          <div style={{ display: "flex", gap: 14, marginTop: 26 }}>
            <Chip color={C.navy}>Daytona: 実行・検証・ライブ配信・破棄</Chip>
            <Chip color={C.accent} bg={C.accentSoft}>Nosana: 推論を自分で動かす</Chip>
          </div>
        </Fade>
      </AbsoluteFill>
    </Stage>
  );
};

// 9. まとめ
const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 6, fps, config: { damping: 18 } });
  return (
    <Stage>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 130px" }}>
        <div style={{ fontSize: 94, fontWeight: 800, lineHeight: 1.32, letterSpacing: "0.01em", opacity: s, transform: `translateY(${(1 - s) * 26}px)` }}>
          読めなかった通知が、
          <br />
          <span style={{ color: C.accent }}>「はい」と言うだけ</span>で終わる。
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 60, opacity: s }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 44, fontWeight: 800 }}>お</div>
          <div>
            <div style={{ fontSize: 34, fontWeight: 800 }}>おまかせ手続き</div>
            <div style={{ fontSize: 20, color: C.muted, marginTop: 4 }}>Daytona HackSprint Tokyo 2026 — Daytona / Nosana</div>
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: FONT, background: C.paper }}>
    <Sequence durationInFrames={135}>
      <Title />
    </Sequence>
    <Sequence from={135} durationInFrames={180}>
      <Problem />
    </Sequence>
    <Sequence from={315} durationInFrames={210}>
      <Step1 />
    </Sequence>
    <Sequence from={525} durationInFrames={375}>
      <Step2 />
    </Sequence>
    <Sequence from={900} durationInFrames={180}>
      <Step3 />
    </Sequence>
    <Sequence from={1080} durationInFrames={270}>
      <Step4 />
    </Sequence>
    <Sequence from={1350} durationInFrames={225}>
      <Proof />
    </Sequence>
    <Sequence from={1575} durationInFrames={255}>
      <Arch />
    </Sequence>
    <Sequence from={1830} durationInFrames={180}>
      <Close />
    </Sequence>
  </AbsoluteFill>
);
