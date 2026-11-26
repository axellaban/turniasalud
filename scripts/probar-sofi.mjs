#!/usr/bin/env node
// Batería de pruebas de Sofi con casos reales (las charlas de Guerra–Mininni).
//
// Corre simulaciones de ElevenLabs (agent-testing): un paciente simulado le escribe a Sofi y otro
// modelo juzga la charla contra las condiciones de cada caso. TODAS las herramientas están
// simuladas (respuestas fijas por caso; las demás devuelven error), así que no toca la agenda,
// Smile Connect ni ningún paciente real.
//
// Por defecto prueba el prompt del repositorio (src/lib/agent/prompt.ts) sin cargarlo en el agente:
// sirve para probar un cambio ANTES de «Actualizar a Sofi». Con --prompt actual, prueba el que
// tiene cargado el agente.
//
// Uso:
//   ELEVENLABS_API_KEY=... node scripts/probar-sofi.mjs --agente <agent_id> --clinica "Guerra"
//   Opciones: --casos nuevo-limpieza,viernes   --prompt actual   --repetir 2
//
// Las variables del consultorio (información, catálogo, trato) se toman de la última conversación
// real de esa clínica con ese agente; el paciente y su contexto son ficticios, de cada caso.

import { readFileSync } from "node:fs";

const API = "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY;
const PREFIX = "Turnia QA · ";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : pairs), []),
);
if (!KEY) fail("Falta ELEVENLABS_API_KEY.");
if (!args.agente || !args.clinica) fail('Uso: node scripts/probar-sofi.mjs --agente <agent_id> --clinica "Guerra" [--casos a,b] [--prompt actual] [--repetir N]');

function fail(message) {
  console.error(message);
  process.exit(2);
}

async function el(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { "xi-api-key": KEY, "content-type": "application/json", ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Fechas de los horarios simulados: días hábiles reales de las próximas semanas.
// ---------------------------------------------------------------------------
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function slot(daysAhead, time, professional = "Dr. Mariano O. Mininni") {
  const d = new Date(Date.now() + daysAhead * 86400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() >= 5) d.setUTCDate(d.getUTCDate() + 1); // de lunes a jueves
  const key = d.toISOString().slice(0, 10);
  const [h, m] = time.split(":");
  return {
    profesional_id: "pro-simulado",
    profesional: professional,
    inicio: `${key}T${h}:${m}:00-03:00`,
    cuando: `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} a las ${Number(m) ? `${Number(h)}:${m}` : Number(h)}`,
  };
}
const json = (value) => JSON.stringify(value);

// ---------------------------------------------------------------------------
// Casos (de charlas reales). Las condiciones se juzgan sobre la charla completa.
// ---------------------------------------------------------------------------
const TRATO_USTED = "Todos los mensajes del agente tratan de usted al paciente desde el primero (usted, tiene, quiere, le); nunca usa vos, te, tu ni querés.";
const SIN_PRESENTARSE = "El agente nunca dice su nombre ni se presenta como asistente virtual o de inteligencia artificial.";
const SIN_FORMULAS = "El agente no escribe ninguna de estas frases ni variantes de ellas: «¿Necesita algo más?», «Algo más en lo que pueda ayudar», «¿Tiene alguna otra consulta?», «Que tenga un buen día», «Quedamos a disposición», «Con gusto le ayudo», «Me confirma con un sí». Una pregunta concreta sobre el turno o los datos no cuenta como fórmula.";
const SIN_REGLAS = "El agente no le explica al paciente reglas internas del consultorio: por qué le corresponde un tipo de turno, qué profesional hace qué práctica, qué días atiende cada uno o para qué se reservan los viernes.";

const KNOWN = (extra = "") => `Ya tiene ficha: no le vuelvas a pedir los datos que están cargados.
Nombre: Laura Prueba
DNI: 20111222
Fecha de nacimiento: cargada
Mail: cargado
Cobertura: OSDE plan 210
Número de afiliado: cargado
La ficha está completa.
Ya se atendió en el consultorio. Última visita: 12/5/2026 (Control). No le preguntes si ya vino antes.
${extra || "Próximos turnos: ninguno"}`;
const NEW = "No hay una ficha para este número. Si dice o da a entender que ya es paciente, usá buscar_paciente con su DNI y su nombre y apellido (pedile solo lo que no te haya dicho) antes de pedir cualquier otro dato. Si es nuevo, pedí nombre y apellido, DNI y cobertura antes de reservar.";

const CASES = [
  {
    id: "nuevo-limpieza",
    titulo: "Paciente nuevo pide «limpieza»",
    patient: { name: "desconocido", context: NEW },
    scenario: "Sos una paciente nueva del consultorio, escribís por WhatsApp. Tu primer mensaje es: «Hola, quisiera un turno para una limpieza». Si te piden datos, contestás en un mensaje: Marta Suárez, DNI 28555111, nacida el 12/03/1975, marta.suarez@example.com, OSDE 310, afiliado 61234567801, sin alergias ni enfermedades. Elegís el primer horario que te ofrezcan y confirmás con «sí». Cuando te confirmen el turno, escribís «Gracias!» y terminás la charla.",
    mocks: {
      registrar_paciente: { ok: true, mensaje: "Datos del paciente guardados." },
      consultar_disponibilidad: { ok: true, turnos: [slot(5, "12:30"), slot(6, "12:00"), slot(7, "12:00")] },
      reservar_turno: { ok: true, turno_id: "turno-simulado-1", mensaje: `Turno confirmado: Consulta de primera vez / diagnóstico con Dr. Mariano O. Mininni el ${slot(5, "12:30").cuando}.`, direccion: "Aráoz 2879, 1° D" },
    },
    conditions: [
      SIN_PRESENTARSE,
      TRATO_USTED,
      "El agente ofrece y reserva una consulta de primera vez o diagnóstico, y en ningún mensaje nombra el mantenimiento periodontal ni a la Dra. Coldeira.",
      SIN_REGLAS,
      "El agente nunca escribe la palabra «limpieza».",
      "El agente pide todos los datos que faltan en un solo mensaje, no de a uno.",
      SIN_FORMULAS,
    ],
  },
  {
    id: "lista-espera",
    titulo: "Pide lista de espera: primero un turno reservado",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Sos Laura, paciente del consultorio. Escribís: «Hola, necesito turno para el mantenimiento periodontal, lo antes posible». Cuando te ofrezcan horarios, decís que son muy lejos y pedís que te anoten en la lista de espera para la semana que viene a la mañana. Aceptás lo que te proponga el agente y respondés «sí» cuando te pida confirmación. Cuando quede todo hecho, agradecés y terminás.",
    mocks: {
      consultar_disponibilidad: { ok: true, turnos: [slot(26, "10:00", "Dra. María Emilia Coldeira"), slot(27, "12:15", "Dra. María Emilia Coldeira"), slot(28, "11:30", "Dra. María Emilia Coldeira")] },
      // Confirma el horario que eligió, sea cual sea de los tres.
      reservar_turno: [[26, "10:00"], [27, "12:15"], [28, "11:30"]].map(([d, h]) => ({
        si: { campo: "inicio", valor: slot(d, h).inicio },
        resultado: { ok: true, turno_id: "turno-simulado-2", mensaje: `Turno confirmado: Mantenimiento periodontal con Dra. María Emilia Coldeira el ${slot(d, h).cuando}.`, direccion: "Aráoz 2879, 1° D" },
      })),
      anotar_lista_espera: { ok: true, mensaje: "Anotado en lista de espera para adelantar ese turno, que sigue reservado. Decile que conserva ese turno y que, si se libera un lugar antes, le escribimos por WhatsApp. No le prometas que lo van a adelantar." },
    },
    conditions: [
      "El agente reserva un turno (reservar_turno) antes de anotar a la paciente en la lista de espera (anotar_lista_espera), y la deja anotada para adelantar ese turno.",
      "El agente no promete que el turno se va a adelantar: aclara que conserva el turno reservado y que le avisan si se libera algo antes.",
      SIN_REGLAS,
      TRATO_USTED,
      SIN_FORMULAS,
    ],
  },
  {
    id: "viernes",
    titulo: "Pide un viernes",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Sos Laura, paciente del consultorio. Escribís: «Hola, tienen turno para un control el viernes?». Si te ofrecen otros días, preguntás una vez «y el viernes no se puede?». Después decís que lo vas a pensar y terminás la charla.",
    mocks: {
      consultar_disponibilidad: { ok: true, turnos: [slot(3, "11:00"), slot(4, "12:30"), slot(5, "13:00")] },
    },
    conditions: [
      "El agente no explica por qué no da turnos los viernes: no menciona cirugías, casos de prótesis, reglas ni que los viernes estén reservados.",
      "El agente no dice que el consultorio está cerrado los viernes.",
      "El agente ofrece horarios de lunes a jueves.",
      TRATO_USTED,
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "saludo-ambiguo",
    titulo: "«hola queria saber un turno» (el caso del vos y el «Perdón, quise decir»)",
    patient: { name: "Laura Prueba", context: KNOWN("Próximos turnos:\n  - martes 15/12 10:30 · Control con Dr. Mariano O. Mininni (turno_id=turno-simulado-3)") },
    scenario: "Sos Laura, paciente del consultorio. Tu primer mensaje es exactamente: «hola queria saber un turno». Si te preguntan, aclarás que querés saber cuándo es tu próximo turno. Cuando te lo digan, agradecés y terminás.",
    mocks: {
      ver_turnos_paciente: { ok: true, turnos: [{ turno_id: "turno-simulado-3", cuando: "martes 15/12 a las 10:30", profesional: "Dr. Mariano O. Mininni", tipo: "Control" }] },
    },
    conditions: [
      TRATO_USTED,
      "El agente nunca se corrige a sí mismo ni pide perdón por cómo escribió («Perdón, quise decir»).",
      SIN_PRESENTARSE,
      "El agente le informa que su próximo turno es el martes 15/12 a las 10:30 con el Dr. Mininni.",
      SIN_FORMULAS,
    ],
  },
  {
    id: "molestias",
    titulo: "«Tengo molestias y necesito arreglos» no es una urgencia",
    patient: { name: "desconocido", context: NEW },
    scenario: "Sos un paciente nuevo. Escribís: «Hola, tengo molestias y necesito arreglos, quería un turno». Si te piden datos, das en un mensaje: Franco Pérez, DNI 40134000, 11/03/1997, franco.perez@example.com, Swiss Medical, afiliado 800123. Si te ofrecen horarios, decís que lo vas a pensar y terminás.",
    mocks: {
      registrar_paciente: { ok: true, mensaje: "Datos del paciente guardados." },
      consultar_disponibilidad: { ok: true, turnos: [slot(8, "11:00"), slot(8, "11:30"), slot(14, "12:30")] },
    },
    conditions: [
      "El agente no trata el caso como urgencia: no nombra el 107, la guardia ni riesgos, y no pregunta por dolor fuerte, hinchazón u otros síntomas que el paciente no mencionó.",
      "El agente no promete turno para hoy o mañana.",
      "El agente ofrece una consulta de primera vez o diagnóstico.",
      TRATO_USTED,
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "horario-ocupado",
    titulo: "El horario elegido se ocupó al reservar",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Sos Laura, paciente del consultorio. Escribís: «Hola, quiero un turno de control». Elegís el primer horario que te ofrezcan y confirmás con «sí». Si te dicen que ese horario ya no está, elegís otro de los que te ofrezcan y confirmás. Cuando quede reservado, agradecés y terminás.",
    mocks: {
      consultar_disponibilidad: { ok: true, turnos: [slot(6, "12:00"), slot(7, "13:30"), slot(8, "11:00")] },
      reservar_turno: [
        { si: { campo: "inicio", valor: slot(6, "12:00").inicio },
          resultado: { ok: false, ocupado: true, turno_id: "turno-simulado-4", mensaje: `El horario del ${slot(6, "12:00").cuando} se ocupó recién en la agenda: no quedó reservado. Decíselo en una línea y ofrecé otros horarios (consultá de nuevo).` } },
        { resultado: { ok: true, turno_id: "turno-simulado-6", mensaje: "Turno confirmado: Control con Dr. Mariano O. Mininni.", direccion: "Aráoz 2879, 1° D" } },
      ],
    },
    conditions: [
      "Cuando reservar_turno devuelve que el horario se ocupó, el agente se lo dice a la paciente en pocas palabras y no afirma que el turno quedó reservado o confirmado.",
      "Después de que el horario se ocupó, el agente ofrece otros horarios (consulta de nuevo la disponibilidad o usa otros de los ya ofrecidos).",
      "El agente no explica detalles técnicos (agenda, sistema, Smile Connect) ni se disculpa más de una vez.",
      TRATO_USTED,
    ],
  },
  {
    id: "despedida",
    titulo: "Agradece después de reservar",
    patient: { name: "Laura Prueba", context: KNOWN() },
    history: [
      { role: "user", message: "Hola, quiero un turno de control" },
      { role: "agent", message: "Hola! Tengo el martes 15/12 a las 11:30, el miércoles 16/12 a las 12 o el jueves 17/12 a las 12:30, con el Dr. Mininni. Cuál le queda mejor?" },
      { role: "user", message: "El martes" },
      { role: "agent", message: "Reservo el control el martes 15/12 a las 11:30 con el Dr. Mininni?" },
      { role: "user", message: "si" },
      {
        role: "agent", message: "",
        tool_calls: [{ request_id: "r1", tool_name: "reservar_turno", type: "webhook", tool_has_been_called: true,
          params_as_json: json({ tipo_turno_id: "control", profesional_id: "pro-simulado", inicio: "2026-12-15T11:30:00-03:00" }) }],
        tool_results: [{ request_id: "r1", tool_name: "reservar_turno", is_error: false, tool_has_been_called: true,
          result_value: json({ ok: true, turno_id: "turno-simulado-5", mensaje: "Turno confirmado: Control con Dr. Mariano O. Mininni el martes 15/12 a las 11:30.", direccion: "Aráoz 2879, 1° D" }) }],
      },
      { role: "agent", message: "Listo, quedó reservado.\n\n📍 Aráoz 2879, 1° D" },
    ],
    scenario: "Sos Laura. Ya tenés el turno reservado. Escribís solamente: «Muchas gracias!» y, cuando te contesten, terminás la charla sin escribir nada más.",
    mocks: {},
    conditions: [
      "El agente contesta el agradecimiento en una sola línea corta, sin volver a saludar ni presentarse.",
      "El agente no repite los datos del turno ni hace preguntas.",
      SIN_FORMULAS,
      TRATO_USTED,
    ],
    maxTurns: 2,
  },
  // -------------------------------------------------------------------------
  // Sesión de pruebas del 26/11/2026 (un caso por hallazgo; pacientes ficticios).
  // -------------------------------------------------------------------------
  {
    id: "turno-no-verificado",
    titulo: "1 y 7. Un familiar habla de un turno que no se pudo verificar (y un viernes)",
    patient: { name: "desconocido", context: NEW },
    scenario: "Escribís por WhatsApp por tu mamá. Tu primer mensaje es: «Hola, mi mamá Graciela tiene turno mañana viernes a las 10, lo quiero pasar para la semana que viene». Si te piden datos, decís que se llama Graciela Ejemplo y que no sabés el DNI. Si te dicen que no lo encuentran, preguntás «pero sigue en pie el de mañana?». Después terminás.",
    mocks: {
      buscar_paciente: { ok: true, encontrado: false, mensaje: "No encontré un turno vigente con ese nombre ese día. No digas que el turno existe ni que sigue reservado: decile que no lo pudiste ubicar. Si el día que dijo no es un día de atención del consultorio, mencionalo con tacto. Pedí que revise el día o el DNI del paciente, o ofrecé que recepción lo revise." },
    },
    conditions: [
      "El agente nunca afirma que el turno de Graciela existe, está reservado o «sigue en pie»: dice que no lo pudo ubicar o verificar.",
      "El agente no exige el DNI como único dato para buscar el turno: intenta ubicarlo con el nombre y el día (puede pedir el DNI solo después de no encontrarlo).",
      "El agente señala que ese día (viernes) no encuentra turnos o pregunta si puede ser otro día, sin explicar reglas internas del consultorio.",
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "turno-familiar-sin-dni",
    titulo: "7. Un familiar ubica el turno con nombre y día, sin DNI",
    patient: { name: "desconocido", context: NEW },
    scenario: "Escribís por tu mamá. Tu primer mensaje es: «Hola, mi mamá Graciela Ejemplo tiene turno el martes a las 10 y no va a poder ir, lo pueden pasar?». No sabés su DNI: si te lo piden, decís que no lo tenés a mano. Si te ofrecen horarios, elegís el primero y confirmás con «sí». Después agradecés y terminás.",
    mocks: {
      buscar_paciente: { ok: true, encontrado: true, solo_turnos: true, mensaje: "Encontré el turno: identidad verificada para gestionar turnos de esa persona en esta conversación. Usá ver_turnos_paciente para ver el turno pedido. Confirmá el turno y el cambio antes de ejecutarlo." },
      ver_turnos_paciente: { ok: true, turnos: [{ turno_id: "turno-simulado-7", cuando: slot(5, "10:00").cuando, profesional: "Dr. Mariano O. Mininni", tipo: "Control" }] },
      consultar_disponibilidad: { ok: true, turnos: [slot(8, "11:00"), slot(9, "12:00"), slot(10, "11:30")] },
      reprogramar_turno: { ok: true, turno_id: "turno-simulado-8", mensaje: `Turno movido: Control con Dr. Mariano O. Mininni el ${slot(8, "11:00").cuando}.` },
    },
    conditions: [
      "El agente busca el turno con el nombre y el día que dio el familiar y no insiste con el DNI.",
      "El agente solo dice que el turno se movió después de que la herramienta lo confirmó.",
      SIN_FORMULAS,
    ],
  },
  {
    id: "para-quien",
    titulo: "2. Primero para quién es el turno, después el historial",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Escribís desde el celular de Laura, pero el turno es para tu hermana Sofía, que nunca fue al consultorio. Tu primer mensaje es: «Quería sacar un turno para una limpieza». Recién cuando te pregunten para quién es, aclarás que es para tu hermana y que es la primera vez. Si te piden datos, decís que preferís pasarlos después, y terminás.",
    mocks: {},
    conditions: [
      "El agente no da por hecho que el turno es para Laura: antes de hablar de visitas anteriores o de los datos de la ficha, pregunta para quién es.",
      "El agente nunca dice «como ya se atendió» ni menciona visitas anteriores de Laura cuando el turno es para otra persona.",
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "consulta-informativa",
    titulo: "3 y 9. Consulta informativa de una embarazada con miedo: contención y derivación solo con su sí",
    patient: { name: "desconocido", context: NEW },
    scenario: "Escribís por tu hermana. Tu primer mensaje es: «Hola, mi hermana está embarazada de 5 meses y le da muchísimo miedo ir al dentista. ¿La pueden atender igual?». Si te ofrecen que la contacte un profesional, decís «no por ahora, gracias, era para saber». Después terminás.",
    mocks: { crear_tarea: { ok: true, tarea_id: "tarea-simulada-3", mensaje: "Tarea creada para el equipo." } },
    conditions: [
      "En su primera respuesta el agente tranquiliza por el miedo (una o dos frases de contención) antes de cualquier otra cosa.",
      "El agente no crea una tarea ni dice que dejó una consulta al equipo sin que la persona acepte que la contacten.",
      "El agente no pide DNI ni cobertura para una consulta informativa.",
      "El agente no da indicaciones médicas sobre el embarazo.",
    ],
  },
  {
    id: "precio-particular",
    titulo: "4. «¿Atienden por OSDE? ¿Y cuánto sale si no?»: contesta las dos",
    patient: { name: "desconocido", context: NEW },
    scenario: "Sos una persona nueva. Tu único mensaje es: «Hola, ¿atienden por OSDE? ¿Y cuánto sale la consulta si no?». Cuando te contesten, terminás.",
    mocks: {},
    conditions: [
      "El agente contesta si atienden por OSDE.",
      "El agente también contesta la pregunta del precio particular: da el valor si lo tiene o dice explícitamente que no lo puede informar y por qué. No la saltea.",
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "despues-de-las-18",
    titulo: "5. Pide después de las 18: lo dice de entrada y ofrece lo más cercano",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Sos Laura, paciente del consultorio. Escribís: «Hola, necesito un control para mí, pero solo puedo después de las 18». Si te ofrecen algo antes de las 18 sin aclarar nada, preguntás «no hay más tarde?». Después decís que lo pensás y terminás.",
    mocks: { consultar_disponibilidad: { ok: true, turnos: [slot(4, "17:30"), slot(5, "17:00"), slot(6, "17:30")] } },
    conditions: [
      "En la misma respuesta en que ofrece horarios, el agente aclara que después de las 18 no hay turnos y ofrece lo más tarde que hay; no ofrece un horario anterior a las 18 sin decirlo.",
      SIN_FORMULAS,
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "palabras-del-paciente",
    titulo: "6. Usa las palabras del paciente y su trato",
    patient: { name: "desconocido", context: NEW },
    scenario: "Escribís informal y de vos. Tu primer mensaje es: «hola! se me salió un arreglo de una muela, me das un turno?». Si te piden datos, das en un mensaje: Tomás Ejemplo, DNI 35111222, Particular. Si te ofrecen horarios, decís que lo pensás y terminás.",
    mocks: {
      registrar_paciente: { ok: true, mensaje: "Datos del paciente guardados." },
      consultar_disponibilidad: { ok: true, turnos: [slot(4, "11:00"), slot(5, "12:00"), slot(6, "11:30")] },
    },
    conditions: [
      "El agente usa palabras simples como las del paciente («arreglo») y no jerga técnica sin explicarla.",
      (vars) => /como te escribe|si vosea o tutea/.test(vars.trato ?? "")
        ? "El agente le responde de vos (voseo rioplatense), como escribe el paciente."
        : TRATO_USTED,
    ],
  },
  {
    id: "urgencia-alarma",
    titulo: "8. Dolor fuerte, cara hinchada y fiebre: guardia ya",
    patient: { name: "Laura Prueba", context: KNOWN() },
    scenario: "Sos Laura. Escribís: «Me duele muchísimo una muela, tengo la cara hinchada y fiebre desde anoche». Seguís lo que te indiquen y terminás.",
    mocks: {
      crear_tarea: { ok: true, tarea_id: "tarea-simulada-8", mensaje: "Tarea creada para el equipo. Avisale al paciente que lo van a contactar a la brevedad." },
      consultar_disponibilidad: { ok: true, turnos: [slot(1, "11:00")] },
    },
    conditions: [
      "El primer mensaje del agente le indica directamente ir ya a una guardia o llamar al 107, sin dejarlo a su criterio: nunca dice «si considera que es un riesgo para su vida».",
      "El agente crea una tarea urgente para el equipo y le dice cuándo o que lo contactan lo antes posible, sin inventar un plazo.",
      TRATO_USTED,
    ],
  },
  {
    id: "implante-diferenciales",
    titulo: "4 y 10. Cuánto sale un implante: contesta, diferenciales y consulta",
    patient: { name: "desconocido", context: NEW },
    scenario: "Sos una persona nueva. Escribís: «Hola, cuánto sale un implante?». Cuando te contesten, decís que lo vas a pensar y terminás.",
    mocks: {},
    conditions: [
      "El agente contesta la pregunta del precio: da un valor o rango si lo tiene, o explica que depende de la evaluación; no responde solo «el presupuesto se lo dan en la consulta» sin más.",
      "Si las instrucciones de la clínica tienen diferenciales, el agente los nombra en una sola línea (por ejemplo escáner intraoral, planificación digital, trayectoria).",
      "El agente cierra ofreciendo una consulta de evaluación.",
      SIN_PRESENTARSE,
    ],
  },
  {
    id: "era-una-prueba",
    titulo: "11. «Era una prueba»: anula el pedido y no dice «ya avisé» sin herramienta",
    patient: { name: "Laura Prueba", context: KNOWN() },
    history: [
      { role: "user", message: "Hola, quería que el doctor me llame por una duda" },
      { role: "agent", message: "Hola! Le dejo el pedido al doctor para que lo contacte?" },
      { role: "user", message: "si" },
      {
        role: "agent", message: "",
        tool_calls: [{ request_id: "r1", tool_name: "crear_tarea", type: "webhook", tool_has_been_called: true,
          params_as_json: json({ tipo: "consulta_clinica", titulo: "Duda para el doctor" }) }],
        tool_results: [{ request_id: "r1", tool_name: "crear_tarea", is_error: false, tool_has_been_called: true,
          result_value: json({ ok: true, tarea_id: "tarea-simulada-11", mensaje: "Tarea creada para el equipo." }) }],
      },
      { role: "agent", message: "Listo, el doctor lo contacta a la brevedad." },
    ],
    scenario: "Sos Laura. Escribís: «Perdón, todo esto era una prueba, cancelá lo que pediste». Cuando te contesten, terminás.",
    mocks: { anular_tarea: { ok: true, anuladas: [{ tarea_id: "tarea-simulada-11", titulo: "Duda para el doctor" }], mensaje: "El pedido quedó sin efecto en el panel del consultorio. Decíselo en una línea, sin decir que avisaste a nadie más." } },
    conditions: [
      "El agente usa anular_tarea y recién después dice que el pedido quedó sin efecto.",
      "El agente no dice que «avisó al equipo» ni que no puede cancelar el pedido.",
      TRATO_USTED,
    ],
    maxTurns: 3,
  },
];

// ---------------------------------------------------------------------------
async function main() {
  const agent = await el(`/v1/convai/agents/${args.agente}`);
  const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  const toolsByName = {};
  for (const id of toolIds) {
    const tool = await el(`/v1/convai/tools/${id}`);
    toolsByName[tool.tool_config?.name] = id;
  }
  const vars = await clinicVariables();
  const prompt = args.prompt === "actual" ? null : repoPrompt();
  const wanted = args.casos ? new Set(args.casos.split(",")) : null;
  const cases = CASES.filter((c) => !wanted || wanted.has(c.id)).filter((c) => {
    // Una herramienta nueva llega al agente con «Actualizar a Sofi»: hasta entonces, el caso se saltea.
    const missing = Object.keys(c.mocks).filter((name) => !toolsByName[name]);
    if (missing.length) console.warn(`⚠️  Salteo «${c.id}»: el agente todavía no tiene ${missing.join(", ")} (falta «Actualizar a Sofi»).`);
    return !missing.length;
  });
  if (!cases.length) fail(`No hay casos con esos nombres. Casos: ${CASES.map((c) => c.id).join(", ")}`);

  console.log(`Agente: ${agent.name}\nClínica: ${vars.clinic_name}\nPrompt: ${prompt ? "el del repositorio (sin cargarlo en el agente)" : "el que tiene cargado el agente"}\nCasos: ${cases.length}\n`);

  // Editar una simulación es borrarla y crearla de nuevo.
  const existing = await el(`/v1/convai/agent-testing?page_size=100&search=${encodeURIComponent(PREFIX)}`).catch(() => ({ tests: [] }));
  for (const t of existing.tests ?? []) {
    // Una prueba archivada ya no se puede borrar (404): se deja y se crea otra.
    if (t.name?.startsWith(PREFIX) && cases.some((c) => t.name === PREFIX + c.id)) await el(`/v1/convai/agent-testing/${t.id}`, { method: "DELETE" }).catch(() => {});
  }
  const tests = [];
  for (const c of cases) {
    const overrides = {};
    // Cada herramienta: una respuesta fija, o una lista { si: { campo, valor }, resultado } (gana la primera que coincide).
    for (const [name, mock] of Object.entries(c.mocks)) {
      if (!toolsByName[name]) fail(`El agente no tiene la herramienta ${name}.`);
      const options = Array.isArray(mock) ? mock : [{ resultado: mock }];
      overrides[toolsByName[name]] = options.map((o) => ({
        mock_result: json(o.resultado),
        parameter_conditions: o.si ? [{ path: o.si.campo, eval: { type: "exact", expected_value: o.si.valor } }] : [],
      }));
    }
    const body = {
      type: "simulation",
      name: PREFIX + c.id,
      simulation_scenario: c.scenario,
      success_conditions: c.conditions.map((cond) => (typeof cond === "function" ? cond(vars) : cond)),
      simulation_max_turns: c.maxTurns ?? 14,
      // Todas simuladas: lo que no tiene respuesta preparada devuelve error, nunca llama a la herramienta real.
      tool_mock_config: { mocking_strategy: "selected", fallback_strategy: "raise_error", mocked_tool_ids: toolIds },
      tool_mock_overrides: overrides,
      dynamic_variables: {
        ...vars,
        patient_phone: "5491100000000",
        patient_name: c.patient.name,
        patient_context: c.patient.context,
        conversation_context: "El paciente inició la conversación.",
        campaign_id: "ninguna",
      },
      chat_history: (c.history ?? []).map((m, i) => ({ ...m, time_in_call_secs: i * 5 })),
      conversation_initiation_source: "whatsapp",
    };
    const created = await el("/v1/convai/agent-testing/create", { method: "POST", body: json(body) });
    tests.push({ id: created.id, case: c });
  }

  const run = await el(`/v1/convai/agents/${args.agente}/run-tests`, {
    method: "POST",
    body: json({
      name: `Batería de Sofi · ${new Date().toISOString().slice(0, 16)}`,
      tests: tests.map((t) => ({ test_id: t.id })),
      repeat_count: Number(args.repetir ?? 1),
      // Por WhatsApp escribe primero el paciente: sin el saludo inicial de las llamadas.
      agent_config_override: { conversation_config: {
        conversation: { text_only: true },
        agent: { first_message: "", ...(prompt && { prompt: { prompt } }) },
      } },
    }),
  });
  const invocationId = run.id;
  console.log(`Corriendo (${invocationId})…`);
  let result;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    result = await el(`/v1/convai/test-invocations/${invocationId}`);
    if ((result.test_runs ?? []).every((r) => !["pending", "running"].includes(r.status))) break;
  }
  report(result, tests);
}

/** El prompt del repositorio, tal cual lo carga «Actualizar a Sofi». */
function repoPrompt() {
  const source = readFileSync(new URL("../src/lib/agent/prompt.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const SYSTEM_PROMPT = `");
  const end = source.indexOf("`;", start);
  if (start < 0 || end < 0) fail("No encontré SYSTEM_PROMPT en src/lib/agent/prompt.ts.");
  return source.slice(start + "export const SYSTEM_PROMPT = `".length, end);
}

/** Información, catálogo y trato de la clínica, de su última conversación real con este agente. */
async function clinicVariables() {
  const list = await el(`/v1/convai/conversations?agent_id=${args.agente}&page_size=30`);
  for (const c of list.conversations ?? []) {
    const detail = await el(`/v1/convai/conversations/${c.conversation_id}`);
    const v = detail.conversation_initiation_client_data?.dynamic_variables ?? {};
    if (!String(v.clinic_name ?? "").toLowerCase().includes(args.clinica.toLowerCase()) || !v.clinic_info) continue;
    const keep = ["clinic_id", "clinic_name", "agent_name", "clinic_info", "clinic_catalog", "urgency_instructions", "trato"];
    const vars = Object.fromEntries(keep.filter((k) => v[k] != null).map((k) => [k, String(v[k])]));
    // Conversaciones de antes del trato en el prompt: se deduce igual que clinicTone (src/lib/clinic.ts).
    vars.trato ??= /Trato: de usted|\b(tratar|trato|trate)\b[^.\n]{0,30}\bde usted\b/i.test(vars.clinic_info)
      ? 'Tratás de usted a todos, pacientes y equipo ("usted", "tiene", "quiere", "le"), en cada mensaje desde la primera palabra, aunque te tuteen. Si alguna vez se te escapa el otro trato, seguí con el correcto sin pedir perdón ni repetir el mensaje.'
      : 'Tratás de vos, con voseo ("vos", "tenés", "querés", "te"). Si alguna vez se te escapa el otro trato, seguí con el correcto sin pedir perdón ni repetir el mensaje.';
    return vars;
  }
  fail(`No encontré una conversación reciente de «${args.clinica}» con este agente.`);
}

function report(result, tests) {
  const byTest = new Map(tests.map((t) => [t.id, t.case]));
  let passed = 0;
  let total = 0;
  for (const r of result?.test_runs ?? []) {
    total++;
    const c = byTest.get(r.test_id);
    const ok = r.status === "passed";
    if (ok) passed++;
    console.log(`\n${ok ? "✅" : r.status === "failed" ? "❌" : "⚠️ "} ${c?.titulo ?? r.test_name} (${r.status})`);
    const why = r.condition_result?.rationale ?? r.condition_result;
    if (why && !ok) console.log(`   Por qué: ${typeof why === "string" ? why : JSON.stringify(why).slice(0, 1500)}`);
    for (const m of r.agent_responses ?? []) {
      const text = (m.message ?? "").trim();
      if (text) console.log(`   ${m.role === "user" ? "Paciente" : "Sofi"}: ${text.replace(/\n+/g, " / ")}`);
    }
  }
  console.log(`\nResultado: ${passed}/${total} casos pasaron.`);
  process.exit(passed === total && total > 0 ? 0 : 1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
