// Precios del Programa Fundadores (/pricing). La página no está enlazada desde la web: se comparte por link.
// Montos en USD por mes salvo el setup, que es un pago único.
//
// Tres tarjetas (Consultorio, Core Access y Revenue Growth) y Enterprise / Red como franja «a medida»
// debajo: en Mar del Plata y Miramar casi todos son consultorios de un profesional o clínicas chicas.
// Consultorio es un solo profesional y solo WhatsApp; para llamadas o más profesionales se pasa a Core.

export type PlanId = "consultorio" | "core" | "growth" | "enterprise";

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
  /** 0 = sin llamadas por voz. */
  minutos: number;
  /** null = no se suman sillones ni profesionales (se pasa al plan de arriba). */
  sillonExtra: number | null;
  /** USD por mes. null = se muestra `sePagaCon`. */
  retorno: number | null;
  sePagaCon?: string;
  excedente: { minuto: string | null; conversacion: string };
};

export const PLANES: Plan[] = [
  {
    id: "consultorio",
    nombre: "Consultorio",
    escala: "1 profesional · solo WhatsApp",
    fundador: 69,
    anual: 58,
    lista: 99,
    setupFundador: 290,
    setupLista: 450,
    atencion: "WhatsApp (texto y audios)",
    turnos: "Agenda, recordatorios y urgencias a tu celular",
    reactivacion: "1 campaña por mes (hasta 100 pacientes)",
    conversaciones: 600,
    minutos: 0,
    sillonExtra: null,
    retorno: null,
    sePagaCon: "≈ 2 consultas por mes",
    excedente: { minuto: null, conversacion: "0.10" },
  },
  {
    id: "core",
    nombre: "Core Access",
    escala: "1 a 3 sillones",
    destacado: true,
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

export const plan = (id: PlanId): Plan => PLANES.find((p) => p.id === id)!;

/** Las tres tarjetas. Enterprise / Red va aparte, como plan a medida. */
export const PLANES_TARJETA = PLANES.filter((p) => p.id !== "enterprise");

/** Lo que cuesta no tener a Turnia: la comparación del encabezado (contra Core Access, que tiene voz). */
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

export const LETRA_CHICA = [
  {
    titulo: "Facturación",
    texto:
      "En USD, por adelantado, mes a mes. Podés pagar en pesos al dólar oficial del Banco Nación del día. El setup se abona 100% antes de implementar y los excedentes al cierre de cada mes.",
  },
  {
    titulo: "Campañas",
    texto: "La armamos con vos, aprobás el mensaje y Sofi la manda de a poco desde tu WhatsApp. Cada paciente recibe como mucho un mensaje por mes.",
  },
  {
    titulo: "Expansión",
    texto: "De Consultorio a Core Access te descontamos el setup que pagaste. 10% off en tu segunda sede y 15% off desde la tercera.",
  },
  { titulo: "Requisito fundador", texto: "Feedback quincenal, un caso de éxito y 2 colegas referidos (en Consultorio, uno)." },
];

/** $1,335: el formato con coma de miles que usa la propuesta. */
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
