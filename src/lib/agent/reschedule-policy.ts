// Reglas de Guerra–Mininni para mover turnos ya dados. Las reservas nuevas usan el catálogo.
export const GUERRA_MININNI = "67c3954a-8df8-46c2-a604-f818832bee36";

const treatment = /\b(?:implantes?|implantacion|exodoncias?|extraccion(?:es)?|regeneracion)\b/;
const consult = /^(?:consulta|control|evaluacion|diagnostico|revision|seguimiento)\b/;

export function isRestrictedDentalProcedure(label: string): boolean {
  const normalized = label.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  return treatment.test(normalized) && !consult.test(normalized);
}

export const RESCHEDULE_GUIDANCE =
  "Para mover un turno ya reservado, usá su turno_id en consultar_disponibilidad, aunque el catálogo diga que solo lo reserva el consultorio. " +
  "Recepción debe mover las colocaciones de implantes, cirugías de regeneración, extracciones y visitas de más de 120 minutos. " +
  "Una consulta o control de implantes sí puede cambiarse. Si la herramienta indica que el cambio lo coordina recepción, creá una tarea de derivacion_humana y aclarale al paciente que conserva el turno original.";
