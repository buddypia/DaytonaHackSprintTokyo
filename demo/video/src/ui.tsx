import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, MONO } from "./theme";

// 背景: 紙の質感 + うっすらとした方眼
export const Paper: React.FC<{ children?: React.ReactNode; tone?: "paper" | "ink" }> = ({ children, tone = "paper" }) => {
  const dark = tone === "ink";
  return (
    <AbsoluteFill
      style={{
        background: dark ? `radial-gradient(120% 100% at 50% 0%, #243447 0%, #101720 60%, #0a0f15 100%)` : C.paper,
        fontFamily: FONT,
        color: dark ? "#fff" : C.ink,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: dark
            ? "none"
            : `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(90% 80% at 50% 40%, #000 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(90% 80% at 50% 40%, #000 40%, transparent 100%)",
          opacity: dark ? 0 : 0.55,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

// 見出しの小ラベル（章番号つき）
export const Kicker: React.FC<{ n: string; children: React.ReactNode; color?: string }> = ({ n, children, color = C.accent }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    <span
      style={{
        width: 46,
        height: 46,
        borderRadius: 999,
        background: color,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: 24,
        letterSpacing: 0,
      }}
    >
      {n}
    </span>
    <span style={{ fontSize: 26, fontWeight: 700, color: color, letterSpacing: "0.12em" }}>{children}</span>
  </div>
);

// 大きな見出し。行ごとに入る
export const Headline: React.FC<{ lines: string[]; delay?: number; size?: number; color?: string }> = ({
  lines,
  delay = 0,
  size = 74,
  color = C.ink,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lines.map((line, i) => {
        const s = spring({ frame: frame - delay - i * 6, fps, config: { damping: 200 } });
        return (
          <div
            key={i}
            style={{
              fontSize: size,
              lineHeight: 1.28,
              fontWeight: 800,
              letterSpacing: "0.01em",
              color,
              opacity: s,
              transform: `translateY(${(1 - s) * 26}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

export const Fade: React.FC<{ from: number; to?: number; children: React.ReactNode; y?: number }> = ({ from, to, children, y = 0 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const oo = to === undefined ? 1 : interpolate(frame, [to - 12, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ opacity: o * oo, transform: `translateY(${(1 - o) * y}px)` }}>{children}</div>;
};

// 実画面を入れる枠（ブラウザのウィンドウ風）
export const Screen: React.FC<{
  children: React.ReactNode;
  label?: string;
  live?: boolean;
  width: number;
  height: number;
  style?: React.CSSProperties;
}> = ({ children, label = "localhost:8787", live, width, height, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 22,
      overflow: "hidden",
      background: "#101418",
      border: "1px solid rgba(0,0,0,0.5)",
      boxShadow: "0 40px 90px rgba(35,32,27,0.28), 0 2px 0 rgba(255,255,255,0.35) inset",
      ...style,
    }}
  >
    <div style={{ height: 44, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: "#1b222b", borderBottom: "1px solid #2a333e" }}>
      <span style={{ width: 11, height: 11, borderRadius: 999, background: "#3d4a58" }} />
      <span style={{ width: 11, height: 11, borderRadius: 999, background: "#3d4a58" }} />
      <span style={{ width: 11, height: 11, borderRadius: 999, background: "#3d4a58" }} />
      <span style={{ marginLeft: 14, fontFamily: MONO, fontSize: 14, color: "#9aa7b4", letterSpacing: "0.02em" }}>{label}</span>
      {live ? (
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: "#ff8a65" }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "#ff5a3c" }} />
          LIVE
        </span>
      ) : null}
    </div>
    <div style={{ position: "relative", width, height: height - 44, overflow: "hidden" }}>{children}</div>
  </div>
);

// 素材の切り出し。src は public の動画、from は秒、crop は元動画の座標
export const Shot: React.FC<{
  src: string;
  from: number;
  rate?: number;
  crop?: { x: number; y: number; w: number; h: number };
  sourceW: number;
  sourceH: number;
  width: number;
  height: number;
  label?: string;
  live?: boolean;
  style?: React.CSSProperties;
}> = ({ src, from, rate = 1, crop, sourceW, sourceH, width, height, label, live, style }) => {
  const c = crop ?? { x: 0, y: 0, w: sourceW, h: sourceH };
  const scale = Math.max(width / c.w, height / c.h);
  return (
    <Screen width={width} height={height} label={label} live={live} style={style}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <OffthreadVideo
          src={staticFile(src)}
          startFrom={Math.round(from * 30)}
          playbackRate={rate}
          muted
          style={{
            position: "absolute",
            width: sourceW * scale,
            height: sourceH * scale,
            left: -c.x * scale + (width - c.w * scale) / 2,
            top: -c.y * scale + (height - 44 - c.h * scale) / 2,
          }}
        />
      </div>
    </Screen>
  );
};

// 画面下の字幕（セリフではなく、いま起きていることの説明）
export const Caption: React.FC<{ text: string; sub?: string; from?: number }> = ({ text, sub, from = 0 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: o }}>
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "0.01em", color: C.ink, lineHeight: 1.3, whiteSpace: "pre-line" }}>{text}</div>
      {sub ? <div style={{ fontSize: 23, color: C.muted, lineHeight: 1.6 }}>{sub}</div> : null}
    </div>
  );
};

export const Chip: React.FC<{ children: React.ReactNode; color?: string; bg?: string }> = ({ children, color = C.navy, bg = C.navySoft }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 999, background: bg, color, fontSize: 20, fontWeight: 700 }}>{children}</span>
);
