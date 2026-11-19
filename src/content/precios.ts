// Precios del Programa Fundadores. Ninguna de las dos páginas está enlazada desde la web: se comparten por link.
// Montos en USD por mes salvo el setup, que es un pago único.
//
// - /pricing: los tres planes para clínicas (Core Access, Revenue Growth y Enterprise / Red).
// - /pricing/consultorio: el plan para un profesional que atiende solo. No figura en /pricing a propósito:
//   en la charla se presenta primero Core Access como referencia, y el link de Consultorio se manda al cierre.
//   Un solo precio para todos: en un barrio los colegas se conocen y comparan.

export type PlanId = "core" | "growth" | "enterprise";

export type Plan = {
  id: PlanId;
  nombre: string;
  escala: string;
  destacado?: boolean;
  fundador: number;
  /** Por mes, pagando el año por adelantado (2 meses gratis). */
  anual: number;
  lista: number;
  setupFundador: number;
  setupLista: number;
  atencion: string;
  turnos: string;
  /** null = no incluido. */
  reactivacion: string | null;
  conversaciones: number;
  minutos: number;
  sillonExtra: number;
  retorno: number;
  excedente: { minuto: string; conversacion: string };
};

export const PLANES: Plan[] = [
  {
    id: "core",
    nombre: "Core Access",
    escala: "1 a 3 sillones",
    fundador: 290,
    anual: 242,
    lista: 390,
    setupFundador: 450,
    setupLista: 690,
    atencion: "WhatsApp + Voz IA",
    turnos: "Agenda, recordatorios y derivación a tu equipo",
    reactivacion: "1 campaña por mes (hasta 300 pacientes)",
    conversaciones: 2000,
    minutos: 350,
    sillonExtra: 45,
    retorno: 1600,
    excedente: { minuto: "0.35", conversacion: "0.10" },
  },
  {
    id: "growth",
    nombre: "Revenue Growth",
    escala: "4 a 6 sillones",
    destacado: true,
    fundador: 490,
    anual: 408,
    lista: 690,
    setupFundador: 690,
    setupLista: 990,
    atencion: "WhatsApp + Voz IA",
    turnos: "Transferencia y seguimiento",
    reactivacion: "Pacientes y presupuestos, sin tope de campañas",
    conversaciones: 4500,
    minutos: 750,
    sillonExtra: 40,
    retorno: 3400,
    excedente: { minuto: "0.30", conversacion: "0.08" },
  },
  {
    id: "enterprise",
    nombre: "Enterprise / Red",
    escala: "+6 sillones o 2 a 5 sedes",
    fundador: 1190,
    anual: 992,
    lista: 1590,
    setupFundador: 1290,
    setupLista: 1990,
    atencion: "Multilínea por sede",
    turnos: "Panel consolidado",
    reactivacion: "Campañas multi-sede",
    conversaciones: 10000,
    minutos: 1800,
    sillonExtra: 35,
    retorno: 7800,
    excedente: { minuto: "0.30", conversacion: "0.08" },
  },
];

/** Lo que ahorra por año pagando el año por adelantado: los 2 meses gratis, en dólares. */
export const ahorroAnual = (p: { fundador: number }) => p.fundador * 2;

/** Lo que cuesta no tener a Turnia: la comparación del encabezado. */
export const REFERENCIA = { recepcionista: 1335, horasRecepcionista: 8, implante: 800 };

export const GARANTIAS = [
  {
    plazo: "14 días",
    titulo: "Setup en 14 días",
    texto: "Si no queda 100% operativo en 14 días, te devolvemos todo el setup.",
  },
  {
    plazo: "30 días",
    titulo: "Tracción en 30 días",
    texto: "Si no gestiona al menos 50 interacciones en el primer mes, el mes 2 es gratis.",
  },
  {
    plazo: "100 pacientes",
    titulo: "Reactivación asegurada",
    texto: "Si en Revenue Growth no contactamos a 100 pacientes dormidos en 30 días, te devolvemos el 50% del abono.",
  },
];

/** Lo que pide el Programa Fundadores a cambio del precio congelado. Va arriba, en el bloque de Fundadores. */
export const REQUISITO_FUNDADOR = ["Feedback cada 15 días", "Un caso de éxito", "2 colegas referidos"];

const FACTURACION = {
  titulo: "Facturación",
  texto:
    "En USD, por adelantado, mes a mes. Podés pagar en pesos al dólar MEP del día. El setup se abona 100% antes de implementar y los excedentes al cierre de cada mes.",
};
const CAMPANAS = {
  titulo: "Campañas",
  texto: "La armamos con vos, aprobás el mensaje y Sofi la manda de a poco desde tu WhatsApp. Cada paciente recibe como mucho un mensaje por mes.",
};

export const LETRA_CHICA = [FACTURACION, CAMPANAS, { titulo: "Expansión", texto: "10% off en tu segunda sede y 15% off desde la tercera." }];

// ---------------------------------------------------------------------------
// Consultorio (/pricing/consultorio)

export const CONSULTORIO = {
  nombre: "Consultorio",
  escala: "1 profesional · solo WhatsApp",
  fundador: 99,
  anual: 83,
  lista: 129,
  /** Bonificado para los consultorios fundadores, con permanencia mínima. */
  setup: 290,
  permanenciaMeses: 3,
  conversaciones: 600,
  excedenteConversacion: "0.10",
  pacientesPorCampana: 100,
  /** Con la consulta de Mar del Plata (unos $55.000) y el MEP a unos $1.575: US$ 99 son unos $156.000. */
  sePagaCon: "≈ 3 consultas por mes",
  incluye: [
    "Sofi atiende tu WhatsApp las 24 horas, con texto y audios",
    "Da, mueve y cancela turnos en tu agenda",
    "Recordatorio y confirmación el día anterior",
    "Urgencias que no pueden esperar: le pasa tu celular al paciente",
    "Resumen de tu agenda por WhatsApp a la mañana",
    "Si escribís vos en un chat, Sofi se corre",
    "1 campaña por mes a pacientes dormidos (hasta 100)",
    "600 conversaciones de WhatsApp por mes",
  ],
  noIncluye: ["Sin llamadas por voz", "Un solo profesional: para sumar otro, pasás a Core Access"],
};

export const GARANTIAS_CONSULTORIO = [
  {
    plazo: "14 días",
    titulo: "Andando en 14 días",
    texto: "Si no queda 100% operativo en 14 días, el primer mes es gratis.",
  },
  GARANTIAS[1],
];

export const LETRA_CHICA_CONSULTORIO = [
  FACTURACION,
  CAMPANAS,
  {
    titulo: "Setup",
    texto: `Bonificado para los consultorios fundadores, con un mínimo de ${CONSULTORIO.permanenciaMeses} meses. Si te das de baja antes, se abona el setup ($${CONSULTORIO.setup} USD).`,
  },
  { titulo: "Crecer", texto: "Si después querés llamadas por voz o sumar un profesional, pasás a Core Access." },
  { titulo: "Requisito fundador", texto: "Feedback cada 15 días, un testimonio y un colega referido." },
  { titulo: "Excedentes", texto: `$${CONSULTORIO.excedenteConversacion} USD por conversación, pasadas las ${CONSULTORIO.conversaciones} del mes.` },
];

/** $1,335: el formato con coma de miles que usa la propuesta. */
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
