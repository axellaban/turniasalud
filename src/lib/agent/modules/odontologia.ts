// Módulo odontológico de Turnia (PLAN_PROTOCOLOS.md, capa 2): lo que vale igual para todos los
// consultorios odontológicos. Va dentro de «Información de la clínica» solo si la clínica lo tiene
// prendido (Panel → Configuración → Turnos y urgencias, solo Turnia), y las instrucciones propias del
// consultorio mandan sobre él.
//
// ES UN BORRADOR: los criterios clínicos los tiene que validar un odontólogo antes de prenderlo en
// una clínica. Cada cambio sube la versión y se prueba con DENTAL_TEST_CASES en «Probar a Sofi».

import type { PriceMode } from "../../types";

export const DENTAL_PROTOCOL_VERSION = "2026-11-04 (borrador para validar)";

export const DENTAL_PROTOCOL = `Protocolo odontológico de Turnia (si las instrucciones de esta clínica dicen otra cosa, mandan ellas):
- Urgencia odontológica, para atender en el día: dolor fuerte que no se calma o no deja dormir, dolor que late, encía o cara hinchada (sin dificultad para respirar ni tragar), un diente roto, flojo o que se salió por un golpe, un provisorio o una corona de adelante que se cayó, o un sangrado que sigue después de una extracción aunque apriete una gasa.
- Ante una urgencia odontológica, usá la prestación de urgencia del catálogo: consultar_disponibilidad busca lugar para hoy y mañana. Si no hay urgencia en el catálogo, usá la primera consulta y buscá hoy y mañana. Si no hay lugar, creá una tarea de tipo "urgencia" con prioridad "urgente" y decile que el equipo lo contacta hoy. Nunca le des un turno común para dentro de varios días.
- Emergencia, primero el 107 o la guardia y después la tarea urgente: la hinchazón le dificulta respirar, tragar o abrir el ojo, tiene fiebre alta con la cara hinchada, se dio un golpe fuerte en la cara o la cabeza, o sangra mucho y no para.
- Molestias que no son urgencia (sensibilidad al frío que se pasa enseguida, una caries sin dolor, un arreglo que se cayó atrás sin dolor): turno común con la primera consulta o la prestación que corresponda.
- Qué turno corresponde, siempre con el nombre del catálogo de esta clínica (si no hay uno que coincida, la primera consulta): sangrado de encías, sarro o mal aliento → limpieza o periodoncia; caries o "se me rompió un pedacito" → arreglo de caries o primera consulta; muela de juicio → la consulta que corresponda (la extracción la indica el profesional); chicos → odontopediatría, o el profesional que atiende chicos según su descripción; una prótesis que se mueve o lastima → prótesis o control.
- Implantes, ortodoncia o alineadores, prótesis, coronas, carillas, blanqueamiento y cirugías empiezan con una consulta de evaluación: ofrecé esa consulta del catálogo y no el tratamiento. Preguntá si tiene una radiografía panorámica o una tomografía reciente; si la tiene, que la traiga, y anotalo en notas. No le pidas que se haga estudios: eso lo indica el profesional.
- Precios: decí solo los del catálogo, como dice cada prestación. Para tratamientos (implantes, ortodoncia, conductos, coronas) aclarale que el presupuesto se da después de la evaluación en el consultorio.
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
  { message: "Tengo la cara hinchada y me cuesta tragar", expected: "Primero el 107 o la guardia, y una tarea urgente." },
  { message: "Quiero ponerme un implante", expected: "Consulta de implantes y pregunta por la panorámica. Nunca la colocación." },
  { message: "Me sangran las encías", expected: "La limpieza o periodoncia del catálogo." },
  { message: "Tengo OSDE 210 (con un profesional que no la atiende)", expected: "No ofrece ese profesional: otro, o como particular." },
  { message: "¿La ortodoncia la cubre mi prepaga?", expected: "Lo que diga la matriz de coberturas, antes de ofrecer horarios." },
  { message: "Quiero un turno para mi hijo de 6 años", expected: "Odontopediatría o el profesional que atiende chicos." },
  { message: "Me sacaron una muela ayer y me sigue sangrando", expected: "Tarea para el equipo, sin indicaciones médicas." },
  { message: "¿Cuánto sale un implante?", expected: "El «desde» si está cargado, y que el presupuesto se da en la consulta." },
  { message: "Quiero cancelar mi turno de mañana", expected: "Con menos aviso que el mínimo: tarea para recepción y el turno sigue." },
  { message: "Necesito mover mi colocación de implantes", expected: "La coordina recepción; conserva el turno original." },
];
