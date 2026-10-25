import React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { out, prog } from "../engine/ease";
import { Isotipo } from "./Logo";
import { C, theme } from "./theme";

export type ChatMsg = {
  at: number;
  me: boolean;
  time: string;
  text?: React.ReactNode;
  voice?: { src: string; frames: number; transcript: string };
  /** Cuadros de «escribiendo…» antes del mensaje. */
  typing?: number;
};

const WAVE = Array.from({ length: 34 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45 + 1)));

const Ticks: React.FC = () => (
  <svg width="17" height="11" viewBox="0 0 17 11" style={{ marginLeft: 3 }}>
    <path d="M1 6l3 3 6-7M6 9l1 .9 6-7.4" fill="none" stroke="#53bdeb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Bubble: React.FC<{ m: ChatMsg; f: number }> = ({ m, f }) => {
  const t = prog(f, m.at, m.at + 8, out);
  const playing = m.voice ? Math.min(1, Math.max(0, (f - m.at) / m.voice.frames)) : 0;
  return (
    <div style={{ maxHeight: 40 + 360 * t, overflow: "hidden", display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", padding: "3px 0" }}>
      <div
        style={{
          maxWidth: m.voice ? 290 : "80%",
          background: m.me ? C.waBubble : "#fff",
          borderRadius: 14,
          borderTopRightRadius: m.me ? 4 : 14,
          borderTopLeftRadius: m.me ? 14 : 4,
          padding: m.voice ? "8px 10px 6px" : "7px 10px 6px",
          boxShadow: "0 1px 0.5px rgba(11,20,26,.13)",
          fontSize: 15.5,
          lineHeight: 1.36,
          color: "#111b21",
          whiteSpace: "pre-wrap",
          transform: `scale(${0.92 + 0.08 * t})`,
          transformOrigin: m.me ? "top right" : "top left",
          opacity: t,
        }}
      >
        {m.voice ? (
          <div style={{ width: 268 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#c9d3db", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontFamily: theme.font, fontSize: 15, position: "relative", flex: "none" }}>
                JP
                <svg width="14" height="14" viewBox="0 0 24 24" style={{ position: "absolute", right: -3, bottom: -2 }}>
                  <circle cx="12" cy="12" r="11" fill={C.waBubble} />
                  <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0M12 17v3" stroke="#22a2ed" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              </div>
              <svg width="18" height="20" viewBox="0 0 18 20" style={{ flex: "none" }}>
                {playing > 0 && playing < 1 ? (
                  <g fill="#54656f">
                    <rect x="2" y="2" width="5" height="16" rx="1" />
                    <rect x="11" y="2" width="5" height="16" rx="1" />
                  </g>
                ) : (
                  <path d="M3 1.5v17l14-8.5z" fill="#54656f" />
                )}
              </svg>
              <div style={{ display: "flex", alignItems: "center", gap: 2, height: 30, flex: 1 }}>
                {WAVE.map((h, i) => (
                  <span key={i} style={{ width: 3, height: 4 + h * 22, borderRadius: 2, background: i / WAVE.length < playing ? "#22a2ed" : "#a9b8c2" }} />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#667781", marginTop: 2, paddingLeft: 50 }}>
              <span>{`0:0${Math.min(6, Math.floor((playing > 0 ? playing : 1) * 6.5))}`}</span>
              <span style={{ display: "flex", alignItems: "center" }}>
                {m.time}
                {m.me && <Ticks />}
              </span>
            </div>
            {playing > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(0,0,0,.08)", fontSize: 13.5, color: "#3b4a54", fontStyle: "italic" }}>
                {m.voice.transcript.split(" ").slice(0, Math.ceil(m.voice.transcript.split(" ").length * Math.min(1, playing * 1.05))).join(" ")}
              </div>
            )}
          </div>
        ) : (
          <>
            {m.text}
            <span style={{ float: "right", display: "inline-flex", alignItems: "center", fontSize: 11.5, color: "#667781", margin: "6px 0 -4px 10px" }}>
              {m.time}
              {m.me && <Ticks />}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

/** Chat de WhatsApp (perspectiva del paciente) dentro del marco del celular. */
export const WhatsAppChat: React.FC<{ msgs: ChatMsg[]; contact: string }> = ({ msgs, contact }) => {
  const f = useCurrentFrame();
  const typing = msgs.some((m) => m.typing && f >= m.at - m.typing && f < m.at);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ height: 64, background: "#f7f8fa", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", flex: "none" }}>
        <svg width="12" height="20" viewBox="0 0 12 20">
          <path d="M10 2 2 10l8 8" stroke="#007aff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.brand50, display: "grid", placeItems: "center" }}>
          <Isotipo size={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16.5, color: "#111b21" }}>{contact}</div>
          <div style={{ fontSize: 12.5, color: typing ? C.wa : "#667781" }}>{typing ? "escribiendo…" : "en línea"}</div>
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2">
          <rect x="2" y="6" width="14" height="12" rx="3" />
          <path d="M16 10l6-3v10l-6-3" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2" style={{ marginLeft: 12 }}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
      </div>
      <div
        style={{
          flex: 1,
          background: C.waBg,
          backgroundImage: "radial-gradient(rgba(0,0,0,.035) 1.2px, transparent 1.2px)",
          backgroundSize: "18px 18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "8px 12px 10px",
          overflow: "hidden",
        }}
      >
        <div style={{ alignSelf: "center", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#54656f", marginBottom: 8, boxShadow: "0 1px 0.5px rgba(11,20,26,.13)" }}>HOY</div>
        {msgs.filter((m) => f >= m.at).map((m, i) => (
          <Bubble key={i} m={m} f={f} />
        ))}
        {typing && (
          <div style={{ display: "flex", padding: "3px 0" }}>
            <div style={{ background: "#fff", borderRadius: 14, borderTopLeftRadius: 4, padding: "11px 14px", display: "flex", gap: 4, boxShadow: "0 1px 0.5px rgba(11,20,26,.13)" }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: "#8696a0", opacity: 0.4 + 0.6 * Math.max(0, Math.sin((f / 4) - i * 0.9)) }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ height: 66, background: "#f7f8fa", display: "flex", alignItems: "center", gap: 10, padding: "0 12px 10px", flex: "none" }}>
        <span style={{ fontSize: 26, color: "#007aff", lineHeight: 1 }}>+</span>
        <div style={{ flex: 1, height: 36, borderRadius: 18, background: "#fff", border: "1px solid #e1e4e8", padding: "0 14px", display: "flex", alignItems: "center", color: "#8696a0", fontSize: 15 }}>Mensaje</div>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2">
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0M12 18v3" strokeLinecap="round" />
        </svg>
      </div>
      {msgs
        .filter((m) => m.voice)
        .map((m, i) => (
          <Sequence key={i} from={m.at} durationInFrames={m.voice!.frames + 4} layout="none">
            <Audio src={staticFile(m.voice!.src)} />
          </Sequence>
        ))}
    </div>
  );
};

/** Lista de lo que va haciendo el agente, con tilde cuando termina cada paso. */
export type Action = { at: number; done: number; title: string; detail: string };

export const ActionList: React.FC<{ actions: Action[]; title?: string; compact?: boolean; last?: number }> = ({ actions, title, compact = false, last }) => {
  const f = useCurrentFrame();
  let shown = actions.filter((a) => f >= a.at);
  if (last) shown = shown.slice(-last);
  return (
    <div style={{ fontFamily: theme.font }}>
      {title && <div style={{ fontSize: compact ? 26 : 24, fontWeight: 600, color: C.tinta, marginBottom: compact ? 12 : 18, letterSpacing: "0.01em" }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
        {shown.map((a) => {
          const t = prog(f, a.at, a.at + 10, out);
          const done = f >= a.done;
          const d = prog(f, a.done, a.done + 8, out);
          return (
            <div
              key={a.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: compact ? "14px 18px" : "16px 22px",
                borderRadius: 18,
                background: "#fff",
                boxShadow: "0 1px 0 rgba(8,24,63,.06), 0 14px 30px -18px rgba(8,24,63,.35)",
                opacity: t,
                transform: `translateY(${(1 - t) * 18}px)`,
              }}
            >
              <div style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: done ? C.brand : C.brand50 }}>
                {done ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" style={{ transform: `scale(${0.6 + 0.4 * d})` }}>
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" style={{ transform: `rotate(${f * 12}deg)` }}>
                    <path d="M12 3a9 9 0 1 0 9 9" stroke={C.brand} strokeWidth="3" fill="none" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: compact ? 27 : 26, fontWeight: 600, color: C.brand900, lineHeight: 1.2 }}>{a.title}</div>
                <div style={{ fontSize: compact ? 23 : 21, color: C.tinta, marginTop: 3, opacity: done ? 1 : 0.55 }}>{done ? a.detail : "…"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
