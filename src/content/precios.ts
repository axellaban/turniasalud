// Precios del Programa Fundadores (/pricing). La página no está enlazada desde la web: se comparte por link.
// Montos en USD por mes salvo el setup, que es un pago único.

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
    turnos: "Agenda y recordatorios",
    reactivacion: null,
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
    reactivacion: "Pacientes y presupuestos",
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

export const LETRA_CHICA = [
  { titulo: "Facturación", texto: "En USD, por adelantado, mes a mes. El setup se abona 100% antes de implementar y los excedentes al cierre de cada mes." },
  { titulo: "Expansión", texto: "10% off en tu segunda sede y 15% off desde la tercera." },
  { titulo: "Requisito fundador", texto: "Feedback quincenal, un caso de éxito y 2 colegas referidos." },
];

/** $1,335: el formato con coma de miles que usa la propuesta. */
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
