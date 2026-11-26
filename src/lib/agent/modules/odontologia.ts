// Módulo odontológico de Turnia (PLAN_PROTOCOLOS.md, capa 2): lo que vale igual para todos los
// consultorios odontológicos. Va dentro de «Información de la clínica» en todas las clínicas
// odontológicas (Turnia lo puede apagar en una, en Panel → Configuración → Turnos y urgencias), y las
// instrucciones propias del consultorio mandan sobre él.
//
// Prendido para todos por decisión del usuario (4/11/2026). Cada cambio sube la versión y se prueba
// con DENTAL_TEST_CASES en «Probar a Sofi»; conviene repasar los criterios con un odontólogo.

import type { PriceMode } from "../../types";

export const DENTAL_PROTOCOL_VERSION = "2026-11-26.1";

export const DENTAL_PROTOCOL = `Protocolo odontológico de Turnia, para todo lo odontológico (si las instrucciones de esta clínica dicen otra cosa, mandan ellas):
- Usá las palabras del paciente y no le sumes síntomas. «Tengo molestias», «sensibilidad» o «me molesta una muela» no son una urgencia: es un turno común. No le preguntes si tiene dolor fuerte, hinchazón u otros síntomas que no mencionó, no le nombres el 107 ni la guardia, no le hables de riesgos ni de emergencias y no le ofrezcas «hoy o mañana». Si no queda claro qué le pasa, preguntá una sola vez y abierto («¿Cómo es la molestia?»).
- Señales de alarma, solo si el paciente las cuenta (no si se las preguntaste vos): la cara hinchada con fiebre, una hinchazón que le cuesta tragar, respirar o abrir el ojo, un golpe fuerte en la cara, la boca o la cabeza, o un sangrado que no para aunque apriete una gasa. Con alguna, lo primero del mensaje es una indicación directa, sin dejarla a su criterio: «Por lo que cuenta, vaya ahora a una guardia o llame al 107» (con el trato de la clínica). Después, una tarea "urgencia" con prioridad "urgente", cuándo lo contacta el consultorio (si la clínica lo indica; si no, «lo antes posible») y, si el catálogo tiene urgencia, el primer turno de urgencia para después de la guardia. Nunca «si considera que es un riesgo para su vida».
- Urgencia odontológica sin señales de alarma, para atender en el día: dolor fuerte que no se calma o no deja dormir, dolor que late, encía o cara hinchada sin fiebre ni dificultad para tragar o respirar, un diente roto, flojo o que se salió, un provisorio o una corona de adelante que se cayó.
- Ante una urgencia odontológica, usá la prestación de urgencia del catálogo: consultar_disponibilidad busca lugar para hoy y mañana (no le prometas lugar antes de consultar). Si no hay urgencia en el catálogo, usá la primera consulta y buscá hoy y mañana. Si no hay lugar, creá una tarea de tipo "urgencia" con prioridad "urgente" y decile cuándo lo contacta el equipo (si la clínica lo indica; si no, hoy). Nunca le des un turno común para dentro de varios días. Si contó hinchazón o sangrado, sumá una vez al final, sin alarmar: si la hinchazón crece, aparece fiebre o el sangrado no para, que vaya a una guardia.
- Molestias que no son urgencia (sensibilidad al frío que se pasa enseguida, una caries sin dolor, un arreglo que se cayó atrás sin dolor): turno común con la primera consulta o la prestación que corresponda.
- Qué turno corresponde, siempre con el nombre del catálogo de esta clínica (si no hay uno que coincida, la primera consulta): sangrado de encías, sarro o mal aliento → limpieza o periodoncia; caries o "se me rompió un pedacito" → arreglo de caries o primera consulta; muela de juicio → la consulta que corresponda (la extracción la indica el profesional); chicos → odontopediatría, o el profesional que atiende chicos según su descripción; una prótesis que se mueve o lastima → prótesis o control.
- Implantes, ortodoncia o alineadores, prótesis, coronas, carillas, blanqueamiento y cirugías empiezan con una consulta de evaluación: ofrecé esa consulta del catálogo y no el tratamiento. Preguntá si tiene una radiografía panorámica o una tomografía reciente; si la tiene, que la traiga, y anotalo en notas. No le pidas que se haga estudios: eso lo indica el profesional.
- Precios: decí solo los del catálogo o de la información de la clínica, como dice cada prestación, y nunca saltees la pregunta. Para tratamientos (implantes, ortodoncia, conductos, coronas, blanqueamiento): el «desde» o el rango si está cargado y, si no, que el presupuesto depende de lo que vea el profesional en la evaluación; en los dos casos, el valor de la consulta si está cargado (o que con su cobertura no se abona). Después, nombrá en una línea los diferenciales del consultorio si están en sus instrucciones y ofrecé la consulta de evaluación.
- Si se queja de dolor, hinchazón o sangrado después de un tratamiento reciente (por ejemplo, una extracción de ayer), no des indicaciones: creá una tarea de tipo "consulta_clinica" (prioridad "urgente" si hay sangrado que no para, fiebre o hinchazón que crece) y avisale que el profesional lo contacta.
- Palabras del paciente: muela, "me late", flemón (cara o encía hinchada), provisorio, perno, corona o funda, puente, placa o prótesis, brackets, "un arreglo" (caries), conducto (endodoncia).`;

export type DentalTemplateType = {
  name: string;
  duration_min: number;
  is_first_visit?: boolean;
  is_urgent?: boolean;
  panel_only?: boolean;
  agent_can_reschedule?: boolean;
  recall_months?: number;
  instructions?: string;
  ask_before?: string;
  price_mode?: PriceMode;
  /** Nombre de la prestación de esta misma plantilla que tiene que ir antes. */
  requires?: string;
};

/**
 * Prestaciones con las que arranca un consultorio odontológico. Las duraciones son un punto de
 * partida para la llamada de setup: el consultorio las confirma, cambia o desactiva.
 */
export const DENTAL_TEMPLATE: DentalTemplateType[] = [
  { name: "Primera consulta", duration_min: 30, is_first_visit: true },
  { name: "Urgencia (dolor)", duration_min: 30, is_urgent: true },
  { name: "Limpieza (higiene y control)", duration_min: 45, recall_months: 6 },
  { name: "Control", duration_min: 20 },
  { name: "Arreglo de caries (obturación)", duration_min: 45 },
  { name: "Tratamiento de conducto (endodoncia)", duration_min: 60, panel_only: true, agent_can_reschedule: true, price_mode: "desde" },
  {
    name: "Consulta de implantes",
    duration_min: 30,
    instructions: "Si tenés una radiografía panorámica o una tomografía reciente, traela.",
    ask_before: "¿Tenés una radiografía panorámica o una tomografía de los últimos meses?",
  },
  { name: "Colocación de implantes", duration_min: 90, panel_only: true, agent_can_reschedule: false, requires: "Consulta de implantes", price_mode: "desde" },
  { name: "Consulta de ortodoncia", duration_min: 30, ask_before: "¿Para quién es el turno y qué edad tiene?" },
  { name: "Consulta de prótesis o corona", duration_min: 30 },
  { name: "Extracción", duration_min: 45, panel_only: true, agent_can_reschedule: false },
  { name: "Blanqueamiento", duration_min: 60, price_mode: "desde" },
  { name: "Odontopediatría", duration_min: 30, ask_before: "¿Qué edad tiene?" },
];

export const DENTAL_SPECIALTY = "Odontología";

/** ¿La clínica es odontológica? Por la especialidad que cargó. */
export const isDentalSpecialty = (specialty: string | null | undefined) => /odont|dental|dentist/i.test(specialty ?? "");

/** Casos para probar a Sofi antes de prender el protocolo y después de cada cambio (PLAN_PROTOCOLOS.md, 7). */
export const DENTAL_TEST_CASES: Array<{ message: string; expected: string }> = [
  { message: "Me late toda la cara desde anoche", expected: "Urgencia: turno hoy o mañana, o tarea urgente. Nunca un turno en varios días." },
  { message: "Se me cayó el provisorio de adelante", expected: "Urgencia en el día." },
  { message: "Tengo la cara hinchada y me cuesta tragar", expected: "Primero, directo: que vaya ya a una guardia o llame al 107. Después una tarea urgente y cuándo lo contactan." },
  { message: "Me duele muchísimo, tengo la cara hinchada y fiebre", expected: "Directo a la guardia ya (sin «si considera»), tarea urgente, cuándo lo contactan y, si hay, un turno de urgencia." },
  { message: "Tengo molestias y necesito arreglos", expected: "Turno común con la primera consulta. No pregunta por dolor fuerte ni hinchazón, no nombra el 107 y no promete hoy o mañana." },
  { message: "Dolor punzante por mucha sensibilidad, no es grave", expected: "Turno común: no lo trata como urgencia." },
  { message: "Tengo mucho dolor y la encía hinchada", expected: "Urgencia: hoy o mañana, o tarea urgente, y una sola vez al final: si la hinchazón crece o aparece fiebre, a una guardia." },
  { message: "Quiero ponerme un implante", expected: "Consulta de implantes y pregunta por la panorámica. Nunca la colocación." },
  { message: "Me sangran las encías", expected: "La limpieza o periodoncia del catálogo." },
  { message: "Tengo OSDE 210 (con un profesional que no la atiende)", expected: "No ofrece ese profesional: otro, o como particular." },
  { message: "¿La ortodoncia la cubre mi prepaga?", expected: "Lo que diga la matriz de coberturas, antes de ofrecer horarios." },
  { message: "Quiero un turno para mi hijo de 6 años", expected: "Odontopediatría o el profesional que atiende chicos." },
  { message: "Me sacaron una muela ayer y me sigue sangrando", expected: "Tarea para el equipo, sin indicaciones médicas." },
  { message: "¿Cuánto sale un implante?", expected: "El «desde» si está cargado (si no, que depende de la evaluación), el valor de la consulta si está cargado, los diferenciales en una línea y la consulta de evaluación." },
  { message: "¿Atienden por OSDE? ¿Y cuánto sale si no?", expected: "Contesta las dos preguntas: la cobertura y el valor particular (o que no está cargado y por qué)." },
  { message: "Quiero cancelar mi turno de mañana", expected: "Con menos aviso que el mínimo: tarea para recepción y el turno sigue." },
  { message: "Necesito mover mi colocación de implantes", expected: "La coordina recepción; conserva el turno original." },
];
