import type { Campaign, CampaignRecipient } from "@/lib/types";

type Tone = "gray" | "green" | "yellow" | "red" | "blue";

export const CAMPAIGN_STATUS: Record<Campaign["status"], { label: string; tone: Tone }> = {
  borrador: { label: "Para revisar", tone: "yellow" },
  enviando: { label: "En curso", tone: "blue" },
  finalizada: { label: "Enviada", tone: "green" },
};

export const RECIPIENT_STATUS: Record<CampaignRecipient["status"], { label: string; tone: Tone }> = {
  pendiente: { label: "Por enviar", tone: "yellow" },
  enviado: { label: "Enviado", tone: "blue" },
  respondio: { label: "Respondió", tone: "blue" },
  agendo: { label: "Sacó turno", tone: "green" },
  error: { label: "No salió", tone: "red" },
  excluido: { label: "Fuera de la lista", tone: "gray" },
};

export const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-AR")} ${n === 1 ? one : many}`;
