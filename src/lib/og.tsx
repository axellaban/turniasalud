import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Miniaturas para compartir links (WhatsApp, LinkedIn, X, Slack): 1200×630, con el
// key visual de la web. Se generan una vez en el build desde los opengraph-image.tsx.
// Satori solo entiende flexbox y estilos en línea: cada div con más de un hijo lleva display flex.

export const TAMANO = { width: 1200, height: 630 };

const COLOR = {
  navy: "#0b0d1a",
  azul: "#2157e1",
  azulClaro: "#8fb0ff",
  aqua: "#32d5d8",
  lila: "#b3b1ff",
  sol: "#fdba4d",
  wa: "#d9fdd3",
};

const asset = (archivo: string) => readFile(join(process.cwd(), "src", "assets", "og", archivo));

async function fuentes() {
  const [medium, semibold] = await Promise.all([asset("Geist-Medium.ttf"), asset("Geist-SemiBold.ttf")]);
  return [
    { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

async function retrato() {
  return `data:image/jpeg;base64,${(await asset("retrato.jpg")).toString("base64")}`;
}

function Marca({ tamano = 44 }: { tamano?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg width={tamano} height={tamano} viewBox="0 0 32 32">
        <rect width="32" height="32" rx="9" fill={COLOR.azul} />
        <path d="M9 10.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3h-4.2L11.5 24v-4.1A3 3 0 0 1 9 17z" fill="#fff" />
        <path d="M16 10.6v6.3M12.85 13.75h6.3" stroke={COLOR.azul} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", fontSize: tamano * 0.66, fontWeight: 600, letterSpacing: -0.5, color: "#fff" }}>
        Turnia<span style={{ color: COLOR.azulClaro, marginLeft: 8 }}>Salud</span>
      </div>
    </div>
  );
}

function Tilde({ color = "#fff", tamano = 18 }: { color?: string; tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fondo navy con los halos de color del hero. */
function Fondo({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        fontFamily: "Geist",
        color: "#fff",
        backgroundColor: COLOR.navy,
        backgroundImage: `radial-gradient(circle at 92% 8%, rgba(50,213,216,.34), transparent 38%), radial-gradient(circle at 70% 105%, rgba(179,177,255,.34), transparent 42%), radial-gradient(circle at 0% 100%, rgba(33,87,225,.55), transparent 50%)`,
      }}
    >
      {children}
    </div>
  );
}

function Pie() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 21, color: "rgba(255,255,255,.72)" }}>
      {["WhatsApp", "Audios", "Llamadas", "24/7"].map((c) => (
        <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, backgroundColor: COLOR.aqua }} />
          {c}
        </div>
      ))}
    </div>
  );
}

function Burbuja({ quien, texto, hora }: { quien: "paciente" | "agente"; texto: string; hora: string }) {
  const agente = quien === "agente";
  return (
    <div style={{ display: "flex", justifyContent: agente ? "flex-start" : "flex-end", width: "100%" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: 360,
          padding: "14px 18px 10px",
          borderRadius: 22,
          borderTopLeftRadius: agente ? 6 : 22,
          borderTopRightRadius: agente ? 22 : 6,
          backgroundColor: agente ? "#fff" : COLOR.wa,
          color: "#171729",
          fontSize: 21,
          lineHeight: 1.36,
          boxShadow: "0 18px 40px rgba(0,0,0,.28)",
        }}
      >
        <div style={{ display: "flex" }}>{texto}</div>
        <div style={{ display: "flex", alignSelf: "flex-end", alignItems: "center", gap: 4, marginTop: 4, fontSize: 15, color: "#6b7280" }}>
          {hora}
          {!agente && <Tilde color="#53bdeb" tamano={16} />}
        </div>
      </div>
    </div>
  );
}

function Pastilla({ texto }: { texto: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 10,
        padding: "9px 18px",
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,.12)",
        border: "1px solid rgba(255,255,255,.18)",
        fontSize: 20,
        color: "rgba(255,255,255,.9)",
      }}
    >
      <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, backgroundColor: COLOR.aqua }} />
      {texto}
    </div>
  );
}

/** Columna izquierda: marca, pastilla, título grande y pie con los canales. */
function Texto({ eyebrow, titulo, bajada, tamanoTitulo }: { eyebrow: string; titulo: React.ReactNode; bajada?: string; tamanoTitulo: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640, height: "100%", padding: "56px 0 52px 64px" }}>
      <Marca />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Pastilla texto={eyebrow} />
        <div style={{ display: "flex", flexDirection: "column", fontSize: tamanoTitulo, fontWeight: 500, lineHeight: 1.04, letterSpacing: -2 }}>
          {titulo}
        </div>
        {bajada && <div style={{ display: "flex", fontSize: 24, lineHeight: 1.4, color: "rgba(255,255,255,.75)", maxWidth: 560 }}>{bajada}</div>}
      </div>
      <Pie />
    </div>
  );
}

/** Foto con los mensajes flotando encima, como el hero de la home. */
async function FotoConChat({ paciente, agente, aviso }: { paciente: string; agente: string; aviso: string }) {
  return (
    <div style={{ display: "flex", position: "absolute", top: 0, right: 0, width: 560, height: 630 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og solo acepta <img> */}
      <img
        src={await retrato()}
        width={507}
        height={600}
        style={{ position: "absolute", top: 15, right: 15, width: 507, height: 600, borderRadius: 32, objectFit: "cover" }}
        alt=""
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 15,
          right: 15,
          width: 507,
          height: 600,
          borderRadius: 32,
          backgroundImage: "linear-gradient(to bottom, rgba(11,13,26,0) 35%, rgba(11,13,26,.78) 100%)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "absolute", left: 0, right: 40, bottom: 50 }}>
        <Burbuja quien="paciente" texto={paciente} hora="23:47" />
        <Burbuja quien="agente" texto={agente} hora="23:47" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          position: "absolute",
          top: 44,
          right: 44,
          padding: "10px 18px 10px 12px",
          borderRadius: 999,
          backgroundColor: "#fff",
          color: "#171729",
          fontSize: 19,
          fontWeight: 600,
          boxShadow: "0 12px 30px rgba(0,0,0,.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 28, backgroundColor: "#22c55e" }}>
          <Tilde tamano={16} />
        </div>
        {aviso}
      </div>
    </div>
  );
}

/** Tarjeta de chat de WhatsApp (sin foto) para las especialidades. */
function TarjetaChat({ paciente, agente, titulo }: { paciente: string; agente: string; titulo: string }) {
  return (
    <div style={{ display: "flex", position: "absolute", top: 0, right: 0, width: 560, height: 630, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 480,
          borderRadius: 32,
          overflow: "hidden",
          backgroundColor: "#efeae2",
          boxShadow: "0 40px 80px rgba(0,0,0,.45)",
          border: "1px solid rgba(255,255,255,.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", backgroundColor: "#075e54", color: "#fff" }}>
          <svg width={44} height={44} viewBox="0 0 32 32">
            <rect width="32" height="32" rx="16" fill="#fff" />
            <path d="M9 10.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3h-4.2L11.5 24v-4.1A3 3 0 0 1 9 17z" fill={COLOR.azul} />
          </svg>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 21, fontWeight: 600 }}>{titulo}</div>
            <div style={{ display: "flex", fontSize: 16, color: "rgba(255,255,255,.75)" }}>en línea · responde al instante</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "24px 20px 28px" }}>
          <Burbuja quien="paciente" texto={paciente} hora="21:12" />
          <Burbuja quien="agente" texto={agente} hora="21:12" />
        </div>
      </div>
    </div>
  );
}

const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).replace(/[\s,.;:]+\S*$/, "")}…` : t);

/** Miniatura general del sitio (home y todas las páginas sin una propia). */
export async function imagenPortada() {
  return new ImageResponse(
    (
      <Fondo>
        <Texto
          eyebrow="Agentes de IA para clínicas"
          tamanoTitulo={84}
          titulo={[
            <div key="1" style={{ display: "flex" }}>Cada paciente,</div>,
            <div key="2" style={{ display: "flex", color: COLOR.azulClaro }}>bien atendido.</div>,
          ]}
          bajada="Turnos, admisión y derivaciones por WhatsApp y teléfono, las 24 horas."
        />
        {await FotoConChat({
          paciente: "Hola! ¿Hay turno con pediatría esta semana?",
          agente: "¡Hola! Sí: jueves a las 10:30. ¿Te lo reservo?",
          aviso: "Turno confirmado",
        })}
      </Fondo>
    ),
    { ...TAMANO, fonts: await fuentes() },
  );
}

/** Miniatura de una página interna: título propio y, si hay, un ejemplo de chat. */
export async function imagenPagina({
  eyebrow,
  titulo,
  chat,
  nombreChat = "Turnia · Recepción",
}: {
  eyebrow: string;
  titulo: string;
  chat?: { paciente: string; agente: string };
  nombreChat?: string;
}) {
  const tamanoTitulo = titulo.length > 60 ? 54 : titulo.length > 38 ? 62 : 72;
  return new ImageResponse(
    (
      <Fondo>
        <Texto eyebrow={recortar(eyebrow, 46)} tamanoTitulo={tamanoTitulo} titulo={<div style={{ display: "flex" }}>{recortar(titulo, 90)}</div>} />
        {chat
          ? TarjetaChat({ paciente: recortar(chat.paciente, 120), agente: recortar(chat.agente, 150), titulo: nombreChat })
          : await FotoConChat({
              paciente: "¿Me pasás un turno para mañana?",
              agente: "¡Claro! Tengo 9:15 o 16:40. ¿Cuál preferís?",
              aviso: "Atendido a cualquier hora",
            })}
      </Fondo>
    ),
    { ...TAMANO, fonts: await fuentes() },
  );
}
