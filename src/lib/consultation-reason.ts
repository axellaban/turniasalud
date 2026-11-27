export const CONSULTATION_CATEGORIES = ['general', 'control', 'implantes', 'protesis', 'blanqueamiento', 'otro'] as const;
export type ConsultationCategory = typeof CONSULTATION_CATEGORIES[number];
export const CONSULTATION_LABELS: Record<ConsultationCategory, string> = {
  general: 'Consulta general', control: 'Control', implantes: 'Implantes', protesis: 'Prótesis',
  blanqueamiento: 'Blanqueamiento', otro: 'Otro motivo',
};

export type ConsultationInput = { motivo_consulta?: string; categorias_motivo?: string; primera_vez?: boolean };

/** Clasificación declarada por el agente a partir de lo dicho por el paciente, sin inferir diagnósticos. */
export function consultationFields(input: ConsultationInput, required: boolean) {
  const reason = input.motivo_consulta?.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  if (required && !reason) throw new Error('Antes de reservar, pregunte el motivo de la consulta si todavía no lo dijo. Guárdelo en motivo_consulta. No se reservó el turno.');
  const categories = [...new Set((input.categorias_motivo ?? '').split(',').map(x => x.trim()).filter(Boolean))];
  if (categories.some(x => !CONSULTATION_CATEGORIES.includes(x as ConsultationCategory))) throw new Error('Revise las categorías del motivo: general, control, implantes, protesis, blanqueamiento u otro.');
  if (required && !categories.length) throw new Error('Clasifique el motivo ya informado en categorias_motivo, sin volver a preguntárselo al paciente. No se reservó el turno.');
  return { consultation_reason: reason, consultation_categories: reason ? categories as ConsultationCategory[] : [],
    patient_first_visit: typeof input.primera_vez === 'boolean' ? input.primera_vez : null };
}

export const CONSULTATION_INSTRUCTIONS = [
  'Al dar un turno nuevo, antes de buscar horarios averiguá el motivo si no está claro: «Cuál es el motivo de la consulta?». Si ya lo dijo, usalo sin volver a preguntarlo. Si prefiere no detallarlo, aceptá «consulta general».',
  'Al reservar o anotar en lista de espera, enviá motivo_consulta con sus palabras y categorias_motivo (general, control, implantes, protesis, blanqueamiento u otro; varias separadas por coma).',
  'primera_vez=true solo si confirmó que nunca se atendió; false si ya vino o el historial registra atención. Sin información, omitilo: no deduzcas primera vez por falta de datos en Turnia.',
  'Una consulta de tratamiento usa la prestación y el profesional correspondientes del catálogo. La clasificación es interna: no le expliques prioridades ni etiquetas al paciente.',
  'Para mover, cancelar o poner en espera un turno existente ya identificado, no vuelvas a hacer esta admisión: conservá el motivo conocido.',
].join(' ');
