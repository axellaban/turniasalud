export const LEAD_STATUSES = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  demo_agendada: "Demo agendada",
  ganado: "Ganado",
  descartado: "Descartado",
} as const;

export type LeadStatus = keyof typeof LEAD_STATUSES;

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && Object.hasOwn(LEAD_STATUSES, value);
}
