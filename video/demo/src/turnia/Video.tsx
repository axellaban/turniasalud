import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Background } from "../engine/Background";
import { StepCaption, WordsIn } from "../engine/Captions";
import { inOutWindow, out, prog } from "../engine/ease";
import { useFormat } from "../engine/layout";
import { Music } from "../engine/Music";
import { Walkthrough } from "../engine/Walkthrough";
import { Glow } from "../engine/widgets";
import { CallScreen, LiveTranscript } from "./Call";
import { Isotipo, Logo } from "./Logo";
import { Phone } from "./Phone";
import { CALL, CALL_END, CALL_RESULT, CHAT, WA_ACTIONS, WA_END, buildPanel } from "./script";
import { C, theme } from "./theme";
import { ActionList, WhatsAppChat } from "./WhatsApp";

const panel = buildPanel();
const pm = panel.marks;

export const HOOK = 88;
export const WA = WA_END;
export const CALLS = CALL_END;
export const PANEL = pm.end + 4;
export const OUTRO = 126;
const T = 12;
export const TOTAL = HOOK + WA + CALLS + PANEL + OUTRO - 4 * T;
// Inicio de cada escena en el video (para bajar la música mientras hay voces).
const AT_WA = HOOK - T;
const AT_CALL = AT_WA + WA - T;

const Dark: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 20%, #1b2a5c 0%, ${C.navy} 55%)` }}>{children}</AbsoluteFill>
);

// ---------- 1. Gancho ----------
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const a = 1 - prog(f, 34, 42);
  const b = prog(f, 40, 52, out);
  const size = fmt === "landscape" ? 120 : 112;
  return (
    <Dark>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: theme.display, color: "#fff", padding: 60 }}>
        {f < 44 ? (
          <div style={{ opacity: a, filter: `blur(${(1 - a) * 8}px)` }}>
            <div style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.03em" }}>
              <WordsIn text="Domingo, 7:12." from={2} stagger={4} />
            </div>
            <div style={{ fontSize: size * 0.42, color: "rgba(255,255,255,.7)", marginTop: 18 }}>
              <WordsIn text="Tu consultorio está cerrado." from={14} />
            </div>
          </div>
        ) : (
          <div style={{ opacity: b, transform: `scale(${0.94 + 0.06 * b})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
            <div style={{ width: 120, height: 120, borderRadius: 32, background: "#fff", display: "grid", placeItems: "center", boxShadow: `0 0 80px ${C.brand}` }}>
              <Isotipo size={78} />
            </div>
            <div style={{ fontSize: size * 0.72, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
              Pero Sofi ya está <span style={{ color: C.aqua }}>atendiendo</span>.
            </div>
          </div>
        )}
      </AbsoluteFill>
    </Dark>
  );
};

/** Escena con un celular a la izquierda (o al centro en vertical) y lo que pasa al costado. */
const PhoneScene: React.FC<{ kicker: string; title: string; phone: React.ReactNode; side: React.ReactNode; below: React.ReactNode; captionTo: number }> = ({ kicker, title, phone, side, below, captionTo }) => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const enter = prog(f, 0, 20, out);
  const phoneStyle: React.CSSProperties =
    fmt === "landscape"
      ? { left: 300, top: 70, transform: `translateY(${(1 - enter) * 120}px) scale(1.08)`, transformOrigin: "top left", opacity: enter }
      : { left: 540 - 200, top: 370, transform: `translateY(${(1 - enter) * 120}px) scale(1.4)`, transformOrigin: "top center", opacity: enter };
  return (
    <AbsoluteFill>
      <Background theme={theme} glow={C.brand} glow2={C.aqua} />
      <Phone style={phoneStyle} time={kicker === "Teléfono" ? "7:31" : "7:12"} dark={kicker === "Teléfono"}>
        {phone}
      </Phone>
      {fmt === "landscape" ? (
        <div style={{ position: "absolute", left: 900, top: 120, width: 820, opacity: inOutWindow(f, 6, captionTo, 12) }}>
          <div style={{ fontFamily: theme.font, fontSize: 26, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.brand }}>{kicker}</div>
          <div style={{ fontFamily: theme.display, fontSize: 64, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.05, color: C.brand900, marginTop: 10, marginBottom: 40 }}>{title}</div>
          {side}
        </div>
      ) : (
        <>
          <StepCaption theme={theme} n={undefined} text={title} from={6} to={captionTo} />
          <div style={{ position: "absolute", left: 50, right: 50, bottom: 46 }}>{below}</div>
        </>
      )}
    </AbsoluteFill>
  );
};

// ---------- 2. WhatsApp ----------
const WhatsAppScene: React.FC = () => (
  <PhoneScene
    kicker="WhatsApp"
    title="Sofi atiende tu WhatsApp, también los audios"
    captionTo={WA + 10}
    phone={<WhatsAppChat msgs={CHAT} contact="Centro Médico Plaza" />}
    side={<ActionList actions={WA_ACTIONS} title="Mientras tanto, Sofi:" />}
    below={<ActionList actions={WA_ACTIONS} compact last={1} />}
  />
);

// ---------- 3. Llamada ----------
const CallScene: React.FC = () => (
  <PhoneScene
    kicker="Teléfono"
    title="Y el teléfono, con voz natural"
    captionTo={CALLS + 10}
    phone={<CallScreen clips={CALL} contact="Centro Médico Plaza" />}
    side={<LiveTranscript clips={CALL} gapNote="pide el DNI, verifica Galeno y busca turno" result={CALL_RESULT} size={30} />}
    below={<LiveTranscript clips={CALL} gapNote="verifica cobertura y busca turno" result={CALL_RESULT} size={29} last={1} />}
  />
);

// ---------- 4. Panel ----------
const Panel: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  return (
    <AbsoluteFill>
      <Background theme={theme} glow={C.brand} glow2={C.lila} />
      <Walkthrough
        tl={panel}
        enter={prog(f, 0, 20, out)}
        accent={C.brand}
        url={(id) => `turniasalud.vercel.app/panel/${id.startsWith("agenda") ? "agenda" : id.startsWith("conv") ? "conversaciones" : "campanas"}`}
        overlays={[
          (f) => <Glow f={f} box={{ x: 867, y: 477, w: 176, h: 21 }} from={pm.jorge + 16} to={pm.conv - 10} color={C.brand} radius={6} pad={2} />,
          (f) =>
            f >= pm.jorge + 20 && f < pm.conv - 8 ? (
              <div
                style={{
                  position: "absolute",
                  left: 1048,
                  top: 476,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: C.wa,
                  color: "#fff",
                  fontFamily: theme.font,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  opacity: prog(f, pm.jorge + 20, pm.jorge + 28, out),
                  transform: `scale(${0.8 + 0.2 * prog(f, pm.jorge + 20, pm.jorge + 28, out)})`,
                  transformOrigin: "left center",
                }}
              >
                Nuevo · por WhatsApp
              </div>
            ) : null,
          (f) => <Glow f={f} box={{ x: 1094, y: 200, w: 308, h: 232 }} from={pm.detail + 30} to={pm.camp - 20} color={C.brand} radius={16} pad={2} />,
          (f) => <Glow f={f} box={{ x: 290, y: 236, w: 420, h: 128 }} from={pm.money} to={pm.end + 4} color={C.aqua} radius={14} pad={6} />,
        ]}
      />
      <StepCaption theme={theme} text="Cada turno aparece en tu agenda" from={10} to={pm.conv} />
      <StepCaption theme={theme} text="Con la conversación y su resumen" sub={fmt === "landscape" ? "y los pedidos para el equipo" : "Y los pedidos para el equipo"} from={pm.conv + 4} to={pm.camp} />
      <StepCaption theme={theme} text="Y le escribe a tus pacientes para que vuelvan" from={pm.camp + 4} to={PANEL + 10} />
      {fmt === "portrait" && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, display: "flex", justifyContent: "center" }}>
          <Logo size={56} />
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- 5. Cierre ----------
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const fmt = useFormat();
  const t = prog(f, 0, 18, out);
  const b = prog(f, 24, 42, out);
  return (
    <Dark>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: fmt === "landscape" ? 34 : 48, padding: 60, textAlign: "center" }}>
        <div style={{ opacity: t, transform: `scale(${0.9 + 0.1 * t})` }}>
          <Logo size={fmt === "landscape" ? 84 : 96} dark />
        </div>
        <div style={{ fontFamily: theme.display, color: "#fff", fontSize: fmt === "landscape" ? 76 : 84, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
          <WordsIn text="Cada paciente," from={8} />
          {fmt === "portrait" && <br />}
          <WordsIn text="bien atendido." from={16} highlight={["atendido"]} accent={C.aqua} />
        </div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 20}px)`, padding: fmt === "landscape" ? "22px 44px" : "26px 46px", borderRadius: 16, background: C.brand, color: "#fff", fontFamily: theme.font, fontSize: fmt === "landscape" ? 38 : 40, fontWeight: 600, boxShadow: `0 20px 60px -10px ${C.brand}` }}>
          Probalo con tu web en <b>turniasalud.vercel.app</b>
        </div>
        <div style={{ opacity: b, fontFamily: theme.font, color: "rgba(255,255,255,.72)", fontSize: 28 }}>WhatsApp, audios y llamadas · las 24 horas</div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 40, right: 40, bottom: fmt === "landscape" ? 26 : 70, textAlign: "center", fontFamily: theme.font, fontSize: 18, color: "rgba(255,255,255,.45)", opacity: b }}>
        Consultorio, pacientes y conversaciones de ejemplo. Voces de la demo de Turnia, generadas con IA.
      </div>
    </Dark>
  );
};

export const TurniaVideo: React.FC = () => {
  const tm = linearTiming({ durationInFrames: T });
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={HOOK}>
          <Hook />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={WA}>
          <WhatsAppScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={CALLS}>
          <CallScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={PANEL}>
          <Panel />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={tm} />
        <TransitionSeries.Sequence durationInFrames={OUTRO}>
          <Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Music
        file="turnia.mp3"
        volume={0.3}
        duck={[
          { from: AT_WA + CHAT[0].at, to: AT_WA + CHAT[0].at + CHAT[0].voice!.frames, level: 0.25 },
          { from: AT_CALL + CALL[0].at, to: AT_CALL + CALL[2].at + CALL[2].frames, level: 0.22 },
        ]}
      />
    </AbsoluteFill>
  );
};
