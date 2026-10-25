import React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { out, prog } from "../engine/ease";
import { Isotipo } from "./Logo";
import { C, theme } from "./theme";

/** Un tramo de la llamada real: audio, quién habla, texto y en qué segundo de la llamada original empieza. */
export type CallClip = { src: string; at: number; frames: number; who: "agente" | "paciente"; text: string; callSec: number };

function activeClip(clips: CallClip[], f: number) {
  return clips.find((c) => f >= c.at && f < c.at + c.frames) ?? null;
}

/** Segundos de la llamada original en el cuadro f (el reloj salta donde se cortó la grabación). */
export function callSeconds(clips: CallClip[], f: number, fps: number) {
  let last = clips[0];
  for (const c of clips) if (f >= c.at) last = c;
  if (f < clips[0].at) return 0;
  return last.callSec + Math.min(last.frames, f - last.at) / fps;
}

/** Pantalla de llamada (del lado del paciente) con la voz real de Sofi. */
export const CallScreen: React.FC<{ clips: CallClip[]; contact: string }> = ({ clips, contact }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Un hook por tramo (siempre en el mismo orden).
  const data = [useAudioData(staticFile(clips[0].src)), useAudioData(staticFile(clips[1].src)), useAudioData(staticFile(clips[2].src))];
  const cur = activeClip(clips, f);
  let level = 0;
  if (cur) {
    const d = data[clips.indexOf(cur)];
    if (d) {
      const v = visualizeAudio({ fps, frame: f - cur.at, audioData: d, numberOfSamples: 16 });
      level = Math.min(1, (v.reduce((a, b) => a + b, 0) / v.length) * 9);
    }
  }
  const agent = cur?.who === "agente";
  const secs = Math.floor(callSeconds(clips, f, fps));
  const connected = f >= clips[0].at - 8;
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #1d2b4f 0%, #0b0d1a 70%)", color: "#fff", fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ marginTop: 46, fontSize: 15, opacity: 0.7 }}>{connected ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "llamando…"}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 600, letterSpacing: "-0.01em" }}>{contact}</div>
      <div style={{ marginTop: 6, fontSize: 15, opacity: 0.7 }}>Te atiende Sofi · asistente virtual</div>
      <div style={{ position: "relative", marginTop: 80, width: 170, height: 170 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: -i * 26 - level * 30 * (agent ? 1 : 0),
              borderRadius: "50%",
              border: `2px solid ${C.brand}`,
              opacity: agent ? (0.55 - i * 0.15) * (0.4 + level) : 0.08,
            }}
          />
        ))}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", boxShadow: agent ? `0 0 ${30 + level * 60}px ${C.brand}` : "none" }}>
          <Isotipo size={88} />
        </div>
      </div>
      <div style={{ marginTop: 60, height: 26, fontSize: 15, opacity: cur ? 0.85 : 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: agent ? C.aqua : "#a7f3d0" }} />
        {agent ? "Sofi está hablando" : "Estás hablando"}
      </div>
      <div style={{ marginTop: "auto", marginBottom: 70, display: "grid", gridTemplateColumns: "repeat(3, 72px)", gap: "22px 30px" }}>
        {(
          [
            ["silenciar", <path key="m" d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0M12 18v3" />],
            ["teclado", <g key="k">{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={6 + c * 6} cy={5 + r * 6} r="1.6" fill="#fff" stroke="none" />))}</g>],
            ["altavoz", <path key="s" d="M4 9v6h4l5 4V5L8 9zm12 0a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />],
          ] as const
        ).map(([l, icon]) => (
          <div key={l} style={{ textAlign: "center", fontSize: 12, opacity: 0.85 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: l === "altavoz" ? "#fff" : "rgba(255,255,255,.16)", marginBottom: 6, display: "grid", placeItems: "center" }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={l === "altavoz" ? "#0b0d1a" : "#fff"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>
            </div>
            {l}
          </div>
        ))}
        <div />
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#ff3b30", display: "grid", placeItems: "center" }}>
          <svg width="34" height="34" viewBox="0 0 24 24">
            <path d="M3 13.5c5-4.5 13-4.5 18 0l-2 2.6-3.6-1.4.2-2.4a10 10 0 0 0-7.2 0l.2 2.4L5 16.1z" fill="#fff" />
          </svg>
        </div>
      </div>
      {clips.map((c, i) => (
        <Sequence key={i} from={c.at} durationInFrames={c.frames + 2} layout="none">
          <Audio src={staticFile(c.src)} />
        </Sequence>
      ))}
    </div>
  );
};

/** Transcripción en vivo, palabra por palabra, con el corte marcado. */
export const LiveTranscript: React.FC<{ clips: CallClip[]; gapNote: string; result?: { at: number; title: string; detail: string }; size?: number; last?: number }> = ({
  clips,
  gapNote,
  result,
  size = 30,
  last,
}) => {
  const f = useCurrentFrame();
  const rows: React.ReactNode[] = [];
  clips.forEach((c, i) => {
    if (f < c.at) return;
    if (i > 0 && c.callSec - (clips[i - 1].callSec + clips[i - 1].frames / 30) > 5) {
      rows.push(
        <div key={`gap${i}`} style={{ display: "flex", alignItems: "center", gap: 14, color: C.tinta, fontSize: size * 0.72, fontStyle: "italic", opacity: prog(f, c.at - 14, c.at - 4) }}>
          <span style={{ flex: "none", width: 34, borderTop: `2px dashed ${C.brand100}` }} />
          {gapNote}
          <span style={{ flex: 1, borderTop: `2px dashed ${C.brand100}` }} />
        </div>,
      );
    }
    const words = c.text.split(" ");
    const total = c.text.length;
    const p = Math.min(1, (f - c.at) / (c.frames * 0.94));
    let acc = 0;
    const t = prog(f, c.at, c.at + 8, out);
    rows.push(
      <div key={i} style={{ opacity: t, transform: `translateY(${(1 - t) * 14}px)` }}>
        <div style={{ fontSize: size * 0.62, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: c.who === "agente" ? C.brand : C.tinta, marginBottom: 4 }}>
          {c.who === "agente" ? "Sofi" : "Paciente"}
        </div>
        <div style={{ fontSize: size, lineHeight: 1.32, fontWeight: 500, color: C.brand900 }}>
          {words.map((w, k) => {
            acc += w.length + 1;
            const lit = acc / total <= p + 0.02;
            return (
              <span key={k} style={{ opacity: lit ? 1 : 0.22 }}>
                {w}{" "}
              </span>
            );
          })}
        </div>
      </div>,
    );
  });
  if (result && f >= result.at) {
    const r = prog(f, result.at, result.at + 10, out);
    rows.push(
      <div key="result" style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 22px", borderRadius: 18, background: "#fff", boxShadow: "0 14px 30px -18px rgba(8,24,63,.4)", opacity: r, transform: `scale(${0.94 + 0.06 * r})`, transformOrigin: "left center" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.brand, display: "grid", placeItems: "center", flex: "none" }}>
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: size * 0.86, fontWeight: 700, color: C.brand900 }}>{result.title}</div>
          <div style={{ fontSize: size * 0.7, color: C.tinta }}>{result.detail}</div>
        </div>
      </div>,
    );
  }
  const visible = last ? rows.slice(-last) : rows;
  return <div style={{ display: "flex", flexDirection: "column", gap: size * 0.8, fontFamily: theme.font }}>{visible}</div>;
};
