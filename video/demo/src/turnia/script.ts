import data from "../../public/turnia/shots.json";
import { Timeline } from "../engine/timeline";
import type { ShotsFile } from "../engine/types";
import type { CallClip } from "./Call";
import type { Action, ChatMsg } from "./WhatsApp";

// ---------- WhatsApp (cuadros a 30 fps desde el inicio de la escena) ----------
const VOICE_AT = 24;
const VOICE = 196; // public/turnia/audio/voice-note.mp3: 6,53 s
const S1 = VOICE_AT + VOICE + 14;
const P2 = S1 + 34;
const S2 = P2 + 24;
export const WA_END = S2 + 54;

export const CHAT: ChatMsg[] = [
  {
    at: VOICE_AT,
    me: true,
    time: "07:12",
    voice: { src: "turnia/audio/voice-note.mp3", frames: VOICE, transcript: "Hola Sofi, buen día. Quería sacar un turno con la traumatóloga, y de paso necesito que me renueven una receta." },
  },
  {
    at: S1,
    me: false,
    time: "07:12",
    typing: 18,
    text: "¡Hola, Jorge! Te ayudo con las dos cosas. Para el control de la rodilla con la Dra. Fernández tengo el lunes 26 a las 9:40 o el miércoles 28 a las 11:00. ¿Cuál preferís?",
  },
  { at: P2, me: true, time: "07:13", text: "Lunes 9:40" },
  {
    at: S2,
    me: false,
    time: "07:13",
    typing: 16,
    text: "Listo, reservado ✅ Lunes 26 a las 9:40 con la Dra. Fernández, en Av. Santa Fe 3200, 4º piso. Traé la credencial de Swiss Medical.\n\nLa receta ya se la pedí a la doctora: te llega por acá en 48 h hábiles.",
  },
];

export const WA_ACTIONS: Action[] = [
  { at: VOICE_AT + 20, done: VOICE_AT + VOICE, title: "Escucha el audio", detail: "Pide turno con traumatología y una receta" },
  { at: VOICE_AT + VOICE + 2, done: VOICE_AT + VOICE + 12, title: "Reconoce al paciente", detail: "Jorge Pérez · Swiss Medical SMG20" },
  { at: VOICE_AT + VOICE + 8, done: S1 - 2, title: "Busca en la agenda real", detail: "2 turnos libres con la Dra. Fernández" },
  { at: P2 + 6, done: S2 - 4, title: "Reserva el turno", detail: "Lunes 26 · 9:40" },
  { at: S2 - 2, done: S2 + 14, title: "Pide la receta a la doctora", detail: "Queda como tarea en el panel" },
];

// ---------- Llamada: tramos de public/turnia/audio (de la demo «Dermatología» de la web) ----------
const A = 14;
const B = A + 152 + 4;
const Cc = B + 176 + 18;
export const CALL: CallClip[] = [
  { src: "turnia/audio/call-a.mp3", at: A, frames: 152, who: "agente", callSec: 0, text: "Centro Médico Plaza, hola. Te atiende Sofi, la asistente virtual. ¿En qué te puedo ayudar?" },
  { src: "turnia/audio/call-b.mp3", at: B, frames: 176, who: "paciente", callSec: 5.04, text: "Hola Sofi. Tengo un lunar en la espalda que me parece que cambió, y quería que me lo vea un dermatólogo." },
  { src: "turnia/audio/call-c.mp3", at: Cc, frames: 222, who: "agente", callSec: 78.6, text: "Listo, te lo dejo reservado: control de lunares con el Dr. Méndez, el jueves 13 a las 16:20, con Galeno." },
];
export const CALL_RESULT = { at: Cc + 200, title: "Turno reservado", detail: "Control de lunares · jueves 13, 16:20 · Galeno" };
export const CALL_END = Cc + 222 + 28;

// ---------- Panel real (capturado en local con datos ficticios) ----------
export function buildPanel() {
  const tl = new Timeline(data as ShotsFile, "turnia");
  tl.show("agenda-dia", 0);
  tl.camera({ landscape: { x: 720, y: 450 }, portrait: { x: 950, y: 470 } }, { landscape: 1, portrait: 1 }, 1, 0);
  tl.camera({ x: 955, y: 500 }, { landscape: 1.75, portrait: 1.35 }, 30, 12);
  tl.wait(14).mark("jorge").wait(44);
  tl.camera({ landscape: { x: 520, y: 330 }, portrait: { x: 380, y: 330 } }, { landscape: 1.25, portrait: 1.0 }, 26);
  tl.place({ x: 980, y: 760 }).wait(4);
  tl.move("agenda-dia.navConv", 24).click(4).mark("conv");
  tl.show("conversaciones", 6).wait(6);
  tl.move("conversaciones.jorge", 18, { dx: -380 }).click(4);
  tl.show("conversacion", 6).mark("detail");
  tl.camera({ landscape: { x: 720, y: 420 }, portrait: { x: 640, y: 440 } }, { landscape: 1.25, portrait: 1.0 }, 1);
  tl.wait(26);
  tl.camera({ landscape: { x: 1180, y: 430 }, portrait: { x: 1250, y: 430 } }, { landscape: 1.6, portrait: 1.3 }, 28);
  tl.wait(38);
  tl.camera({ landscape: { x: 560, y: 330 }, portrait: { x: 380, y: 330 } }, { landscape: 1.25, portrait: 1.0 }, 24);
  tl.move("conversacion.navCamp", 24).click(4).mark("camp");
  tl.show("campanas", 6);
  tl.camera({ landscape: { x: 620, y: 420 }, portrait: { x: 560, y: 400 } }, { landscape: 1.3, portrait: 1.1 }, 26);
  tl.wait(24).mark("money");
  tl.camera({ landscape: { x: 660, y: 330 }, portrait: { x: 480, y: 320 } }, { landscape: 1.8, portrait: 1.45 }, 28);
  tl.wait(46).mark("end");
  return tl;
}
