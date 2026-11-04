"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { applyDentalTemplate } from "@/lib/dental-template";
import { getPanelClinic, requireAdmin, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { normalizePhone } from "@/lib/phone";
import { COVERAGE_MODES, type CoverageMode } from "@/lib/types";
import type { FormState } from "./actions";

// Panel → Configuración → Turnos y urgencias, Coberturas y la plantilla odontológica
// (PLAN_PROTOCOLOS.md). Lo que se guarda acá lo hacen cumplir las herramientas de Sofi.

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const uuid = (form: FormData, key: string) => {
  const value = text(form, key);
  return isUuid(value) ? value : null;
};

/** Un número entero entre min y max, o vacío. `undefined` si no es válido. */
function wholeNumber(form: FormData, key: string, min: number, max: number): number | null | undefined {
  const raw = text(form, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** "$45.000", "45000" o "45.000,50" → 45000 / 45000.5 (formato argentino). */
function parseAmount(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

async function panelClinicOr(form: FormData): Promise<Awaited<ReturnType<typeof getPanelClinic>> | FormState> {
  try {
    return await getPanelClinic(form);
  } catch (error) {
    // Otra pestaña cambió la clínica elegida: se avisa acá, sin perder lo escrito.
    if (error instanceof Error && error.message.includes("clínica seleccionada")) return { ok: false, message: error.message };
    throw error;
  }
}

/** Lo que devuelven los ayudantes cuando algo está mal (tiene `ok`; la clínica y los datos, no). */
const isFormState = (value: unknown): value is FormState => typeof value === "object" && value !== null && "ok" in value;

// ---------------------------------------------------------------------------
// Turnos y urgencias
// ---------------------------------------------------------------------------

/** Teléfono para derivar llamadas: +54 11 5555-0100 → +541155550100. Vacío vale; otra cosa, no. */
function handoffPhone(raw: string | null): string | null | undefined {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return /^\+?\d{8,15}$/.test(digits) ? raw.trim() : undefined;
}

/**
 * Turnos y urgencias: reglas para mover y cancelar, otras condiciones, seguimiento de los que no
 * contestan, urgencias, fuera de horario, derivación y (solo Turnia) el protocolo odontológico.
 * Solo se guardan los campos que vienen en el formulario.
 */
export async function saveBookingRules(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const fields: Record<string, unknown> = {};
  const numbers: Array<[string, number, number, string]> = [
    ["reschedule_notice_hours", 1, 720, "El aviso mínimo va en horas, de 1 a 720 (30 días)."],
    ["cancel_notice_hours", 1, 720, "El aviso mínimo va en horas, de 1 a 720 (30 días)."],
    ["reschedule_max_minutes", 15, 600, "La visita más larga que mueve Sofi va en minutos, de 15 a 600."],
    ["urgent_release_hours", 1, 72, "Las horas de urgencia se liberan entre 1 y 72 horas antes."],
  ];
  for (const [key, min, max, message] of numbers) {
    if (!form.has(key)) continue;
    const value = wholeNumber(form, key, min, max);
    if (value === undefined) return { ok: false, message };
    fields[key] = value;
  }
  if (form.has("followup_attempts")) {
    const attempts = Number(text(form, "followup_attempts"));
    if (![0, 1, 2].includes(attempts)) return { ok: false, message: "Elegí cuántas veces volver a escribir (ninguna, 1 o 2)." };
    fields.followup_attempts = attempts;
  }
  if (form.has("followup_delay_hours")) {
    const delay = Number(text(form, "followup_delay_hours"));
    if (!Number.isInteger(delay) || delay < 1 || delay > 24) return { ok: false, message: "Elegí cuánto esperar antes de volver a escribir." };
    fields.followup_delay_hours = delay;
  }
  if (form.has("handoff_phone")) {
    const phone = handoffPhone(text(form, "handoff_phone"));
    if (phone === undefined) return { ok: false, message: "Revisá el teléfono de recepción: con código de área, por ejemplo +54 223 555-0100." };
    fields.handoff_phone = phone;
  }
  for (const key of ["policies", "urgency_instructions", "after_hours_instructions"]) {
    if (form.has(key)) fields[key] = text(form, key)?.slice(0, 4000) ?? null;
  }
  if (form.has("reception_only_terms")) fields.reception_only_terms = text(form, "reception_only_terms")?.slice(0, 500) ?? null;
  // Casillas: sin el marcador de la pantalla, no se tocan.
  if (form.has("rules_form")) {
    fields.keep_duration_on_reschedule = form.get("keep_duration_on_reschedule") === "on";
    fields.move_panel_only = form.get("move_panel_only") === "on";
  }
  // Prender o apagar el protocolo odontológico es una decisión de Turnia.
  if (user.role === "admin" && form.has("dental_protocol_field")) fields.dental_protocol = form.get("dental_protocol") === "on";
  if (Object.keys(fields).length) await sql`update clinics set ${sql(fields)} where id = ${clinic.id}`;
  await touchClinic(clinic.id, "Turnos y urgencias");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Guardado. Sofi lo usa desde el próximo mensaje." };
}

// ---------------------------------------------------------------------------
// Coberturas
// ---------------------------------------------------------------------------

type RuleInput = {
  coverage: string;
  plan: string | null;
  appointment_type_id: string | null;
  professional_id: string | null;
  mode: CoverageMode;
  copay: number | null;
  requires_authorization: boolean;
  note: string | null;
};

async function ruleInput(form: FormData, clinicId: string): Promise<RuleInput | FormState> {
  const coverage = text(form, "coverage")?.slice(0, 80);
  if (!coverage) return { ok: false, message: "Escribí la obra social o prepaga (o «Particular»)." };
  const mode = text(form, "mode") as CoverageMode | null;
  if (!mode || !COVERAGE_MODES.includes(mode)) return { ok: false, message: "Elegí qué pasa con esa cobertura." };
  const type = uuid(form, "appointment_type_id");
  const pro = uuid(form, "professional_id");
  if (type) {
    const [row] = await sql`select id from appointment_types where id = ${type} and clinic_id = ${clinicId}`;
    if (!row) return { ok: false, message: "Esa prestación no es de esta clínica. Recargá la página." };
  }
  if (pro) {
    const [row] = await sql`select id from professionals where id = ${pro} and clinic_id = ${clinicId}`;
    if (!row) return { ok: false, message: "Ese profesional no es de esta clínica. Recargá la página." };
  }
  const rawCopay = text(form, "copay");
  const copay = mode === "copago" ? parseAmount(rawCopay) : null;
  if (mode === "copago" && rawCopay && copay === null) return { ok: false, message: "Revisá el copago: usá solo números (por ejemplo, 5000)." };
  return {
    coverage,
    plan: text(form, "plan")?.slice(0, 40) ?? null,
    appointment_type_id: type,
    professional_id: pro,
    mode,
    copay,
    requires_authorization: form.get("requires_authorization") === "on",
    note: text(form, "note")?.slice(0, 200) ?? null,
  };
}

export async function addCoverageRule(_previous: FormState, form: FormData): Promise<FormState> {
  await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const input = await ruleInput(form, clinic.id);
  if (isFormState(input)) return input;
  await sql`insert into coverage_rules ${sql({ clinic_id: clinic.id, ...input })}`;
  await touchClinic(clinic.id, "Coberturas");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Regla agregada." };
}

export async function saveCoverageRule(_previous: FormState, form: FormData): Promise<FormState> {
  await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "No encontré esa regla. Recargá la página." };
  const input = await ruleInput(form, clinic.id);
  if (isFormState(input)) return input;
  const rows = await sql`update coverage_rules set ${sql(input)} where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "Esa regla ya no está. Recargá la página." };
  await touchClinic(clinic.id, "Coberturas");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Regla guardada." };
}

export async function deleteCoverageRule(form: FormData): Promise<void> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  if (id) await sql`delete from coverage_rules where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Coberturas");
  revalidatePath("/panel/configuracion", "layout");
}

/** Coberturas que acepta el consultorio (lo que Sofi le dice al paciente) y las de cada profesional. */
export async function saveCoverageLists(_previous: FormState, form: FormData): Promise<FormState> {
  await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const list = (key: string) => [...new Set((text(form, key) ?? "").split(",").map((c) => c.trim().slice(0, 80)).filter(Boolean))];
  await sql.begin(async (tx) => {
    if (form.has("accepted_coverages")) await tx`update clinics set accepted_coverages = ${list("accepted_coverages")} where id = ${clinic.id}`;
    // Un campo por profesional («pro:<id>»); vacío: atiende todas.
    for (const key of [...form.keys()].filter((k) => k.startsWith("pro:"))) {
      const id = key.slice(4);
      if (!isUuid(id)) continue;
      const coverages = list(key);
      await tx`update professionals set accepted_coverages = ${coverages.length ? coverages : null} where id = ${id} and clinic_id = ${clinic.id}`;
    }
  });
  await touchClinic(clinic.id, "Coberturas");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Coberturas guardadas. Sofi las usa desde el próximo mensaje." };
}

// ---------------------------------------------------------------------------
// Plantilla odontológica
// ---------------------------------------------------------------------------

/** Suma las prestaciones odontológicas que faltan. No cambia las que ya están. */
export async function loadDentalTemplate(_previous: FormState, form: FormData): Promise<FormState> {
  await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const added = await applyDentalTemplate(clinic.id);
  if (added) await touchClinic(clinic.id, "Prestaciones");
  revalidatePath("/panel/configuracion", "layout");
  return added
    ? { ok: true, message: `Se sumaron ${added === 1 ? "1 prestación" : `${added} prestaciones`}. Revisá duraciones y precios, y desactivá las que no das.` }
    : { ok: true, message: "Ya tenías todas las prestaciones de la plantilla." };
}


// ---------------------------------------------------------------------------
// Acceso total por WhatsApp (equipo del consultorio)
// ---------------------------------------------------------------------------

/**
 * Un celular del equipo con acceso total a través de Sofi por WhatsApp. Solo Turnia lo da, como los
 * códigos de acceso al panel: quien lo tiene ve y cambia la agenda y los pacientes.
 */
export async function addStaffPhone(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const name = text(form, "name")?.slice(0, 80);
  const phone = normalizePhone(text(form, "phone"));
  if (!name) return { ok: false, message: "Escribí de quién es (por ejemplo, Dr. Mininni)." };
  if (!/^\d{10,15}$/.test(phone)) return { ok: false, message: "Revisá el celular: con código de área, por ejemplo 11 5555-0100." };
  const [row] = await sql`
    insert into clinic_staff_phones (clinic_id, phone, name) values (${clinic.id}, ${phone}, ${name})
    on conflict (clinic_id, phone) do update set name = excluded.name
    returning (xmax = 0) as created`;
  // Las conversaciones abiertas de ese número arrancan de nuevo con el acceso del equipo.
  await touchClinic(clinic.id, "Acceso total por WhatsApp");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: row.created ? `Listo: ${name} ya tiene acceso total por WhatsApp.` : `Actualizado: ese celular es de ${name}.` };
}

export async function removeStaffPhone(form: FormData): Promise<void> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  if (id) await sql`delete from clinic_staff_phones where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Acceso total por WhatsApp");
  revalidatePath("/panel/configuracion", "layout");
}
