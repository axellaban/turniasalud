"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { applyDentalTemplate } from "@/lib/dental-template";
import { getPanelClinic, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
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

/** Reglas para mover y cancelar turnos, horas de urgencia y (solo Turnia) el protocolo odontológico. */
export async function saveBookingRules(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requirePanelSession();
  const clinic = await panelClinicOr(form);
  if (isFormState(clinic)) return clinic;
  const reschedule = wholeNumber(form, "reschedule_notice_hours", 1, 720);
  const cancel = wholeNumber(form, "cancel_notice_hours", 1, 720);
  const longest = wholeNumber(form, "reschedule_max_minutes", 15, 600);
  const release = wholeNumber(form, "urgent_release_hours", 1, 72);
  if (reschedule === undefined || cancel === undefined) return { ok: false, message: "El aviso mínimo va en horas, de 1 a 720 (30 días)." };
  if (longest === undefined) return { ok: false, message: "La visita más larga que mueve Sofi va en minutos, de 15 a 600." };
  if (release === undefined) return { ok: false, message: "Las horas de urgencia se liberan entre 1 y 72 horas antes." };
  const fields: Record<string, unknown> = {
    reschedule_notice_hours: reschedule,
    cancel_notice_hours: cancel,
    reschedule_max_minutes: longest,
    keep_duration_on_reschedule: form.get("keep_duration_on_reschedule") === "on",
    move_panel_only: form.get("move_panel_only") === "on",
    reception_only_terms: text(form, "reception_only_terms")?.slice(0, 500) ?? null,
    urgent_release_hours: release,
  };
  // Prender el protocolo odontológico es una decisión de Turnia (primero lo valida un odontólogo).
  if (user.role === "admin" && form.has("dental_protocol_field")) fields.dental_protocol = form.get("dental_protocol") === "on";
  await sql`update clinics set ${sql(fields)} where id = ${clinic.id}`;
  await touchClinic(clinic.id, "Turnos y urgencias");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Reglas guardadas. Sofi las usa desde el próximo mensaje." };
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

