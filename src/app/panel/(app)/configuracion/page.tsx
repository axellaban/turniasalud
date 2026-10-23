import { ProfileSaveForm } from "./profile-save";
import { ProfileTest, ReadWebsite, ImportReview } from "../clinicas/forms";
import { retainClinic, discardImport } from "../../clinics-actions";
import { IMPORT_FIELDS, profileFields, type ClinicImport } from "@/lib/clinic-imports";
import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { getClinic, clinicInfoText, getCatalog, getScheduleBlocks } from "@/lib/clinic";
import { formatDateTime, localDateKey } from "@/lib/time";
import { sql } from "@/lib/db";
import { WAHA_ENV_VARS, env, isConfigured, missingWahaEnv } from "@/lib/env";
import { demoStatus } from "@/lib/demo/config";
import {
  addAppointmentType,
  addProfessional,
  addSchedule,
  deleteSchedule,
  deleteScheduleBlock,
  setAppointmentTypePrice,
  saveProfessional,
  saveAppointmentType,
  toggleAppointmentType,
  toggleProfessional,
} from "../../actions";
import { Badge, Card, Field, PageHeader, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import { AgentSetupButton } from "./agent-setup";
import { ScheduleBlockForm } from "./block-form";
import { AudiosWeb } from "./audios-web";
import { estadoAudios } from "@/lib/web-audios";
import type { AppointmentType, Professional } from "@/lib/types";
import { messagingSettings } from "@/lib/messaging-settings";
import { telegramConfigured } from "@/lib/telegram";
import { Canales } from "./canales";

// Generar los audios de la web puede tardar ~1 minuto por conversación.
export const maxDuration = 300;

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <p className="font-medium text-brand-900">{label}</p>
      <code className="mt-1 block break-all rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">{value}</code>
    </div>
  );
}

export default async function SettingsPage() {
  const clinic = await getPanelClinic();
  const mainClinic = await getClinic();
  const isMain = mainClinic.id === clinic.id;
  const imports = await sql<ClinicImport[]>`select * from clinic_imports where clinic_id = ${clinic.id} order by created_at desc limit 20`;
  const reading = imports.some((item) => item.status === "reading");
  const messaging = await messagingSettings();
  const catalog = await getCatalog(clinic.id);
  const configured = isConfigured();
  const missingWaha = new Set(missingWahaEnv());
  const base = env.appUrl().replace(/\/$/, "");
  // getCatalog solo trae activos: para poder reactivar, traemos todo de nuevo.
  const now = new Date();
  const [professionals, types, blocks, audios, demo] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by full_name`,
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} order by specialty, name`,
    getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 365 * 86400_000)),
    estadoAudios(),
    demoStatus(),
  ]);
  const proName = new Map(professionals.map((p) => [p.id, p.full_name]));
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];

  return (
    <>
      <PageHeader title={`Configuración · ${clinic.name}`} description="Completá el contexto de esta clínica. Los cambios se usan en conversaciones nuevas." actions={<Link href="/panel/clinicas" className={buttonClass}>Ver clínicas</Link>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {isMain && <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Canal de la demo y del agente</h2>
            <Canales settings={messaging} telegramConfigured={telegramConfigured()} whatsappConfigured={configured.waha} />
          </Card>}
          <Card>
            <h2 className="mb-4 font-semibold text-brand-950">Clínica</h2>
            <ProfileSaveForm key={clinic.id} clinicId={clinic.id} revision={clinic.context_revision}>
              <Field label="Nombre de la clínica">
                <input name="name" defaultValue={clinic.name} className={inputClass} required />
              </Field>
              <Field label="Nombre del agente">
                <input name="agent_name" defaultValue={clinic.agent_name} className={inputClass} required />
              </Field>
              <Field label="Especialidad / tipo de centro">
                <input name="specialty" defaultValue={clinic.specialty} className={inputClass} />
              </Field>
              <Field label="Teléfono">
                <input name="phone" defaultValue={clinic.phone ?? ""} className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Dirección">
                  <input name="address" defaultValue={clinic.address ?? ""} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Horario de atención">
                  <input name="hours_text" defaultValue={clinic.hours_text ?? ""} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Coberturas aceptadas" hint="Separadas por coma. Incluí “Particular” si atienden sin cobertura.">
                  <input name="accepted_coverages" defaultValue={clinic.accepted_coverages.join(", ")} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Preguntas frecuentes" hint="Estacionamiento, precios, qué traer, formas de pago… una por línea.">
                  <textarea name="faq" rows={5} defaultValue={clinic.faq ?? ""} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Políticas" hint="Cancelaciones, tolerancia, coberturas que no se aceptan…">
                  <textarea name="policies" rows={3} defaultValue={clinic.policies ?? ""} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Protocolo de urgencias">
                  <textarea name="urgency_instructions" rows={3} defaultValue={clinic.urgency_instructions ?? ""} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Fuera de horario"
                  hint="Qué decir cuando no hay nadie atendiendo: guardia de un profesional, teléfono de emergencias, cuándo se responden los pedidos."
                >
                  <textarea name="after_hours_instructions" rows={2} defaultValue={clinic.after_hours_instructions ?? ""} className={inputClass} />
                </Field>
              </div>

              <Field label="Web del consultorio"><input name="website" defaultValue={clinic.website ?? ""} placeholder="https://miclinica.com.ar" className={inputClass} /></Field>
              <Field label="Zona horaria"><input name="timezone" defaultValue={clinic.timezone} placeholder="America/Argentina/Buenos_Aires" className={inputClass} /></Field>
              <div className="sm:col-span-2"><Field label="Formas de pago"><textarea name="payment_methods" rows={2} defaultValue={clinic.payment_methods ?? ""} className={inputClass} /></Field></div>
              <div className="sm:col-span-2"><Field label="Instrucciones adicionales del agente" hint="Cómo atender, qué preguntar, qué evitar y cualquier contexto propio de esta clínica."><textarea name="agent_context" rows={5} defaultValue={clinic.agent_context ?? ""} className={inputClass} /></Field></div>
              <Field label="Teléfono de derivación a recepción"><input name="handoff_phone" defaultValue={clinic.handoff_phone ?? ""} className={inputClass} /></Field>
            </ProfileSaveForm>
          </Card>

          <Card>
            <h2 className="mb-4 font-semibold text-brand-950">Profesionales y horarios</h2>
            <div className="space-y-4">
              {professionals.map((p) => {
                const blocks = catalog.schedules.filter((s) => s.professional_id === p.id).sort((a, b) => a.weekday - b.weekday);
                return (
                  <div key={p.id} className={`rounded-xl border border-brand-900/10 p-4 ${p.active ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-brand-950">
                        {p.full_name} <span className="font-normal text-brand-900/50">· {p.specialty}</span>
                        {p.accepted_coverages?.length ? <span className="ml-2 text-xs text-brand-900/50">Solo: {p.accepted_coverages.join(", ")}</span> : null}
                      </p>
                      <form action={toggleProfessional}><input type="hidden" name="clinic_id" value={clinic.id} />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={String(!p.active)} />
                        <button className={smallButtonClass}>{p.active ? "Desactivar" : "Activar"}</button>
                      </form>
                    </div>
                    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">Editar profesional</summary>
                      <form action={saveProfessional} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
                        <input type="hidden" name="id" value={p.id} />
                        <Field label="Nombre del profesional"><input name="full_name" required defaultValue={p.full_name} className={inputClass} /></Field>
                        <Field label="Especialidad del profesional"><input name="specialty" required defaultValue={p.specialty} list="specialties" className={inputClass} /></Field>
                        <Field label="Coberturas del profesional"><input name="accepted_coverages" defaultValue={p.accepted_coverages?.join(", ") ?? ""} className={inputClass} /></Field>
                        <Field label="Descripción del profesional"><input name="bio" defaultValue={p.bio ?? ""} className={inputClass} /></Field>
                        <button className={buttonClass}>Guardar profesional</button>
                      </form>
                    </details>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {blocks.map((s) => (
                        <form key={s.id} action={deleteSchedule} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-800"><input type="hidden" name="clinic_id" value={clinic.id} />
                          <input type="hidden" name="id" value={s.id} />
                          {WEEKDAYS[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                          <button title="Quitar" className="ml-1 text-brand-900/40 hover:text-red-600">
                            ×
                          </button>
                        </form>
                      ))}
                      {!blocks.length && <span className="text-xs text-brand-900/50">Sin horarios: el agente no va a ofrecer turnos.</span>}
                    </div>
                    <form action={addSchedule} className="mt-3 flex flex-wrap items-end gap-2 text-xs"><input type="hidden" name="clinic_id" value={clinic.id} />
                      <input type="hidden" name="professional_id" value={p.id} />
                      <div className="flex gap-1">
                        {WEEKDAYS.map((w, i) => (
                          <label key={w} className="flex cursor-pointer items-center gap-1 rounded-lg bg-neutral-50 px-1.5 py-1">
                            <input type="checkbox" name="weekday" value={i} /> {w}
                          </label>
                        ))}
                      </div>
                      <input type="time" name="start_time" required className="rounded-lg border border-brand-900/15 px-2 py-1" />
                      <span>a</span>
                      <input type="time" name="end_time" required className="rounded-lg border border-brand-900/15 px-2 py-1" />
                      <button className={smallButtonClass}>+ Horario</button>
                    </form>
                  </div>
                );
              })}
            </div>
            <form action={addProfessional} className="mt-5 grid gap-3 rounded-xl bg-brand-50/50 p-4 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
              <Field label="Nuevo profesional">
                <input name="full_name" required placeholder="Dra. Ana López" className={inputClass} />
              </Field>
              <Field label="Especialidad">
                <input name="specialty" required list="specialties" placeholder="Dermatología" className={inputClass} />
              </Field>
              <Field label="Coberturas (opcional)" hint="Solo si atiende algunas. Separadas por coma.">
                <input name="accepted_coverages" className={inputClass} />
              </Field>
              <Field label="Descripción breve">
                <input name="bio" className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <button className={buttonClass}>Agregar profesional</button>
              </div>
            </form>
          </Card>

          <Card>
            <h2 className="mb-4 font-semibold text-brand-950">Tipos de turno</h2>
            <ul className="divide-y divide-brand-900/5 text-sm">
              {types.map((x) => (
                <li key={x.id} className={`flex flex-wrap items-center gap-3 py-2 ${x.active ? "" : "opacity-60"}`}>
                  <span className="flex-1">
                    <span className="font-medium text-brand-950">{x.name}</span>{" "}
                    <span className="text-brand-900/50">
                      · {x.specialty} · {x.duration_min} min{x.recall_months ? ` · control cada ${x.recall_months} meses` : ""}
                    </span>
                  </span>
                  {x.is_first_visit && <Badge tone="blue">primera vez</Badge>}
                  <details className="w-full"><summary className="cursor-pointer text-sm font-medium text-brand-700">Editar prestación</summary>
                    <form action={saveAppointmentType} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
                      <input type="hidden" name="id" value={x.id} />
                      <Field label="Nombre de la prestación"><input name="name" required defaultValue={x.name} className={inputClass} /></Field>
                      <Field label="Especialidad de la prestación"><input name="specialty" required defaultValue={x.specialty} list="specialties" className={inputClass} /></Field>
                      <Field label="Duración del turno (min)"><input name="duration_min" type="number" min={5} max={480} required defaultValue={x.duration_min} className={inputClass} /></Field>
                      <Field label="Precio"><input name="price" defaultValue={x.price ? String(Number(x.price)).replace(".", ",") : ""} className={inputClass} /></Field>
                      <Field label="Control periódico (meses)"><input name="recall_months" type="number" min={1} max={60} defaultValue={x.recall_months ?? ""} className={inputClass} /></Field>
                      <Field label="Indicaciones previas"><textarea name="instructions" defaultValue={x.instructions ?? ""} className={inputClass} /></Field>
                      <label className="text-sm"><input type="checkbox" name="is_first_visit" defaultChecked={x.is_first_visit} /> Primera consulta</label>
                      <button className={buttonClass}>Guardar prestación</button>
                    </form>
                  </details>

                  <form action={setAppointmentTypePrice} className="flex items-center gap-1"><input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="id" value={x.id} />
                    <span className="text-xs text-brand-900/50">$</span>
                    <input
                      name="price"
                      inputMode="decimal"
                      defaultValue={x.price ? String(Number(x.price)).replace(".", ",") : ""}
                      placeholder="precio"
                      aria-label={`Precio de ${x.name}`}
                      className="w-24 rounded-lg border border-brand-900/15 px-2 py-1 text-xs"
                    />
                    <button className={smallButtonClass}>Guardar</button>
                  </form>
                  <form action={toggleAppointmentType}><input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="active" value={String(!x.active)} />
                    <button className={smallButtonClass}>{x.active ? "Desactivar" : "Activar"}</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addAppointmentType} className="mt-5 grid gap-3 rounded-xl bg-brand-50/50 p-4 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
              <Field label="Nombre">
                <input name="name" required placeholder="Control de ortodoncia" className={inputClass} />
              </Field>
              <Field label="Especialidad" hint="Tiene que coincidir con la del profesional.">
                <input name="specialty" required list="specialties" className={inputClass} />
              </Field>
              <Field label="Duración (min)">
                <input name="duration_min" type="number" min={5} max={480} defaultValue={30} className={inputClass} />
              </Field>
              <Field label="Control periódico (meses)" hint="Para las campañas de recall. Vacío si no aplica.">
                <input name="recall_months" type="number" min={1} max={60} className={inputClass} />
              </Field>
              <Field label="Precio de referencia (opcional)" hint="Para estimar cuánto recuperan las campañas.">
                <input name="price" inputMode="decimal" placeholder="45000" className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Indicaciones previas">
                  <input name="instructions" className={inputClass} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_first_visit" /> Es primera consulta
              </label>
              <div className="sm:col-span-2">
                <button className={buttonClass}>Agregar tipo de turno</button>
              </div>
            </form>
            <datalist id="specialties">
              {specialties.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Card>

          <Card>
            <h2 className="font-semibold text-brand-950">Feriados, vacaciones y bloqueos</h2>
            <p className="mb-4 mt-1 text-sm text-brand-900/60">
              En estos períodos el agente no ofrece turnos y avisa que no se atiende. Los turnos ya dados no se cancelan solos.
            </p>
            <ul className="mb-4 space-y-2 text-sm">
              {blocks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50/60 px-3 py-2">
                  <span>
                    <span className="font-medium text-brand-950">{b.professional_id ? proName.get(b.professional_id) ?? "Profesional" : "Toda la clínica"}</span>
                    <span className="text-brand-900/60">
                      {" "}
                      · {formatDateTime(b.starts_at, clinic.timezone)} → {formatDateTime(b.ends_at, clinic.timezone)}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </span>
                  </span>
                  <form action={deleteScheduleBlock}><input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="id" value={b.id} />
                    <button className={smallButtonClass}>Quitar</button>
                  </form>
                </li>
              ))}
              {!blocks.length && <li className="text-brand-900/50">No hay bloqueos cargados.</li>}
            </ul>
            <ScheduleBlockForm
              clinicId={clinic.id}
              professionals={professionals.filter((p) => p.active).map((p) => ({ id: p.id, name: p.full_name }))}
              today={localDateKey(now, clinic.timezone)}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Perfil de la clínica</h2>
            <p className="mb-3 text-sm text-brand-900/70">{!clinic.is_demo ? "Clínica principal" : clinic.retained_at ? "Demo conservada: mantiene su agenda de prueba." : "Demo temporal: al guardar o conservar, queda protegida de la limpieza."}</p>
            {clinic.is_demo && <><form action={retainClinic} className="mb-3"><input type="hidden" name="clinic_id" value={clinic.id} /><button className={buttonClass} disabled={Boolean(clinic.retained_at)}>{clinic.retained_at ? "Perfil conservado" : "Conservar perfil"}</button></form><ProfileTest key={clinic.id} clinicId={clinic.id} /></>}
            <Link href="/demo" className="mt-4 inline-block text-sm text-brand-600 underline">Probar por voz o texto desde el navegador</Link>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Lecturas de la web</h2>
            <ReadWebsite key={clinic.id} clinicId={clinic.id} reading={reading} hasWebsite={Boolean(clinic.website)} />
            {!imports.length && <p className="mt-3 text-sm text-brand-900/60">Todavía no hay una referencia guardada. Las demos anteriores a esta función conservan la ficha; una nueva lectura guardará sus fuentes.</p>}
          </Card>
          {imports.map((item) => <Card key={item.id}>
            <h3 className="font-semibold text-brand-950">{item.status === "reading" ? "Leyendo…" : item.status === "pending" ? "Propuesta para revisar" : item.status === "applied" ? "Lectura aplicada" : item.status === "error" ? "Lectura con error" : "Propuesta descartada"}</h3>
            <p className="my-2 break-all text-xs text-brand-900/60">{formatDateTime(item.created_at, clinic.timezone)} · {item.source_url} · {item.pages.length} páginas</p>
            {item.error && <p className="text-sm text-red-700">{item.error}</p>}
            {item.status === "pending" && item.profile && <>
              <ImportReview key={`${item.id}:${clinic.context_revision}`} clinicId={clinic.id} importId={item.id} revision={clinic.context_revision} rows={Object.entries(IMPORT_FIELDS).map(([key, label]) => {
                const proposed = profileFields(item.profile!)[key as keyof typeof IMPORT_FIELDS];
                const current = clinic[key as keyof typeof IMPORT_FIELDS];
                return { key, label, current: Array.isArray(current) ? current.join(", ") : current ?? "", proposed: Array.isArray(proposed) ? proposed.join(", ") : proposed ?? "" };
              })} catalog={`Profesionales: ${item.profile.profesionales.map((p) => p.nombre).join(", ") || "Equipo por especialidad"}\nPrestaciones: ${item.profile.prestaciones.map((p) => p.nombre).join(", ")}\nHorarios: ${item.profile.horarios.length ? item.profile.horarios.map((h) => `${WEEKDAYS[h.dia]} ${h.desde}–${h.hasta}`).join(", ") : "Agenda de prueba: lunes a viernes de 9 a 18"}`} />
              <form action={discardImport} className="mt-3"><input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="import_id" value={item.id} /><button className={smallButtonClass}>Descartar propuesta</button></form>
            </>}
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-brand-700">Ver texto leído y fuentes</summary>
              {item.pages.map((page) => <div key={page.url} className="mt-3"><a href={page.url} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline">{page.title || page.url}</a><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-brand-50 p-3 font-sans text-xs">{page.text}</pre></div>)}
            </details>
          </Card>)}
          <Card><details><summary className="cursor-pointer font-semibold text-brand-950">Vista previa del contexto</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-brand-900/70">{clinicInfoText(clinic)}</pre></details></Card>
          {isMain && <>
          <Card>
            <h2 className="font-semibold text-brand-950">Agente de IA</h2>
            <p className="mt-1 text-sm text-brand-900/60">
              Crea o actualiza el agente en tu cuenta de ElevenLabs, con sus herramientas apuntando a esta app.
            </p>
            <div className="mt-3 text-sm">
              {clinic.elevenlabs_agent_id ? (
                <p>
                  <Badge tone="green">Conectado</Badge> <code className="text-xs">{clinic.elevenlabs_agent_id}</code>
                </p>
              ) : (
                <Badge tone="yellow">Sin crear</Badge>
              )}
            </div>
            <div className="mt-4">
              <AgentSetupButton disabled={!configured.elevenlabs || !configured.tools} />
              {(!configured.elevenlabs || !configured.tools) && (
                <p className="mt-2 text-xs text-red-600">Faltan ELEVENLABS_API_KEY y/o AGENT_TOOLS_SECRET en Vercel.</p>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">URLs para ElevenLabs y n8n</h2>
            <div className="space-y-3">
              <CopyRow label="Webhook post-conversación (ElevenLabs → Agents → Settings)" value={`${base}/api/elevenlabs/post-call`} />
              <CopyRow label="Webhook de inicio (se configura solo al crear el agente)" value={`${base}/api/elevenlabs/initiation`} />
              <CopyRow label="Automatización: recordatorios (n8n)" value={`${base}/api/automations/recordatorios`} />
              <CopyRow label="Automatización: recall (n8n)" value={`${base}/api/automations/recall`} />
              <CopyRow label="Automatización: encuestas post-consulta (n8n)" value={`${base}/api/automations/encuestas`} />
              <p className="text-xs text-brand-900/50">
                Los llamados de n8n llevan el header <code>x-turnia-secret</code> con el valor de AGENT_TOOLS_SECRET.
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">WhatsApp por WAHA</h2>
            <p className="mb-3 text-xs text-brand-900/60">
              {clinic.whatsapp_provider === "waha" ? (
                <Badge tone={messaging.active_channel === "whatsapp" ? "green" : "yellow"}>{messaging.active_channel === "whatsapp" ? "Habilitado" : "Pausado"}</Badge>
              ) : (
                "Proveedor general actual: Meta. Editar el contexto conserva esta conexión."
              )}
            </p>
            <ul className="space-y-1 text-sm">
              {WAHA_ENV_VARS.map((name) => (
                <li key={name}>
                  {missingWaha.has(name) ? "❌" : "✅"} <code className="text-xs">{name}</code>
                </li>
              ))}
              <li>
                ➖ <code className="text-xs">WAHA_SESSION</code> <span className="text-xs text-brand-900/50">(opcional: {env.wahaSession()})</span>
              </li>
            </ul>
            <div className="mt-4 space-y-3">
              <CopyRow label="Webhook de la sesión en WAHA (evento “message”, con clave HMAC)" value={`${base}/api/waha/webhook`} />
              <CopyRow label="Reply Webhook URL del Custom Channel (ElevenLabs → agente → Channels)" value={`${base}/api/elevenlabs/canal`} />
              <p className="text-xs text-brand-900/50">Los valores se cargan en Vercel → Settings → Environment Variables. Acá nunca se muestran.</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">Demo con tu web</h2>
            <p className="mb-3 text-xs text-brand-900/60">
              <Badge tone={demo.base && (demo.canal === "telegram" ? demo.telegram : demo.whatsapp) ? "green" : "yellow"}>{demo.base && (demo.canal === "telegram" ? demo.telegram : demo.whatsapp) ? "Activa" : "Falta configurar"}</Badge>{" "}
              El interesado deja su web en <Link href="/probar-demo" className="underline">/probar-demo</Link> y la prueba por el canal habilitado arriba.
            </p>
            <ul className="space-y-1 text-sm">
              <li>{demo.base ? "✅" : "❌"} Base actualizada <span className="text-xs text-brand-900/50">(se actualiza sola en cada deploy de producción)</span></li>
              <li>
                {demo.whatsapp ? "✅" : "❌"} WhatsApp de la demo{" "}
                <span className="text-xs text-brand-900/50">
                  {demo.whatsapp_source === "variable" ? "(DEMO_WHATSAPP_NUMBER)" : demo.whatsapp_source === "waha" ? "(número del chip de WAHA)" : "(necesita WAHA conectado)"}
                </span>
              </li>
              <li>{demo.claude ? "✅" : "⚠️"} <code className="text-xs">ANTHROPIC_API_KEY</code> <span className="text-xs text-brand-900/50">{demo.claude ? "" : "(sin clave arma una ficha básica)"}</span></li>
              <li>{demo.llamada_telefonica ? "✅" : "➖"} <code className="text-xs">ELEVENLABS_PHONE_NUMBER_ID</code> <span className="text-xs text-brand-900/50">{demo.llamada_telefonica ? "(llama al celular)" : "(opcional: sin número, la llamada es desde el navegador)"}</span></li>
            </ul>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">Audios de la web</h2>
            <p className="mb-3 text-xs text-brand-900/60">
              Las conversaciones que se escuchan en la home y en “Escuchá a nuestros agentes”.
            </p>
            <AudiosWeb items={audios} />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Estado</h2>
            <ul className="space-y-1 text-sm">
              <li>{configured.database ? "✅" : "❌"} Base de datos (DATABASE_URL)</li>
              <li>{configured.elevenlabs ? "✅" : "❌"} ElevenLabs API key</li>
              <li>{configured.tools ? "✅" : "❌"} AGENT_TOOLS_SECRET</li>
              <li>{configured.webhook ? "✅" : "❌"} ELEVENLABS_WEBHOOK_SECRET</li>
              <li>{configured.n8n ? "✅" : "➖"} N8N_WEBHOOK_URL (opcional)</li>
              <li className="pt-2 text-xs text-brand-900/50">LLM del agente: {env.agentLlm()}</li>
            </ul>
          </Card>
          </>}
        </div>
      </div>
    </>
  );
}
