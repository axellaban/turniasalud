"use server";

import { z } from "zod";
import { sql } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { notifyN8n } from "@/lib/n8n";

export type EstadoLead = { ok?: boolean; error?: string };

const Lead = z.object({
  nombre: z.string().trim().min(2, "Contanos tu nombre.").max(120),
  email: z.email("Revisá el email.").max(160),
  telefono: z.string().trim().max(40).optional(),
  organizacion: z.string().trim().max(160).optional(),
  rol: z.string().trim().max(80).optional(),
  especialidad: z.string().trim().max(80).optional(),
  tamano: z.string().trim().max(40).optional(),
  mensaje: z.string().trim().max(2000).optional(),
  origen: z.string().trim().max(200).optional(),
});

const campo = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Guarda un pedido de demo y avisa a n8n (evento `lead.nuevo`). */
export async function pedirDemo(_prev: EstadoLead | undefined, form: FormData): Promise<EstadoLead> {
  // Campo trampa para bots: los humanos no lo ven.
  if (campo(form, "empresa_web")) return { ok: true };
  const parsed = Lead.safeParse({
    nombre: campo(form, "nombre"),
    email: campo(form, "email"),
    telefono: campo(form, "telefono"),
    organizacion: campo(form, "organizacion"),
    rol: campo(form, "rol"),
    especialidad: campo(form, "especialidad"),
    tamano: campo(form, "tamano"),
    mensaje: campo(form, "mensaje"),
    origen: campo(form, "origen"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const l = parsed.data;
  if (!isConfigured().database) return { error: "El formulario todavía no está conectado. Probá de nuevo más tarde." };
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into leads (name, email, phone, organization, role, specialty, size, message, source)
      values (${l.nombre}, ${l.email}, ${l.telefono ?? null}, ${l.organizacion ?? null}, ${l.rol ?? null},
              ${l.especialidad ?? null}, ${l.tamano ?? null}, ${l.mensaje ?? null}, ${l.origen ?? null})
      returning id`;
    await notifyN8n("lead.nuevo", { lead: { id: row.id, ...l } });
    return { ok: true };
  } catch (e) {
    console.error("No se pudo guardar el pedido de demo", e);
    return { error: "No pudimos guardar tu pedido. Probá de nuevo en un rato." };
  }
}
