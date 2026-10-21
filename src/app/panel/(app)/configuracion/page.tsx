import { getCatalog, getClinic } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { env, isConfigured } from "@/lib/env";
import {
  addAppointmentType,
  addProfessional,
  addSchedule,
  deleteSchedule,
  saveClinic,
  toggleAppointmentType,
  toggleProfessional,
} from "../../actions";
import { Badge, Card, Field, PageHeader, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import { AgentSetupButton } from "./agent-setup";
import type { AppointmentType, Professional } from "@/lib/types";

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
  const clinic = await getClinic();
  const catalog = await getCatalog(clinic.id);
  const configured = isConfigured();
  const base = env.appUrl().replace(/\/$/, "");
  const t = clinic.templates ?? {};
  // getCatalog solo trae activos: para poder reactivar, traemos todo de nuevo.
  const [professionals, types] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by full_name`,
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} order by specialty, name`,
  ]);
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];

  return (
    <>
      <PageHeader title="Configuración" description="Todo lo que el agente sabe de tu clínica sale de acá." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-semibold text-brand-950">Clínica</h2>
            <form action={saveClinic} className="grid gap-4 sm:grid-cols-2">
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

              <div className="sm:col-span-2 mt-2 border-t border-brand-900/10 pt-4">
                <h3 className="font-semibold text-brand-950">WhatsApp y voz</h3>
              </div>
              <Field label="ID del número de WhatsApp" hint="ElevenLabs → WhatsApp → menú del número → “Copy phone number ID”.">
                <input name="whatsapp_phone_number_id" defaultValue={clinic.whatsapp_phone_number_id ?? ""} className={inputClass} />
              </Field>
              <Field label="ID de voz de ElevenLabs (opcional)" hint="Si lo dejás vacío, elegimos una voz argentina automáticamente.">
                <input name="elevenlabs_voice_id" defaultValue={clinic.elevenlabs_voice_id ?? ""} className={inputClass} />
              </Field>

              <div className="sm:col-span-2 mt-2 border-t border-brand-900/10 pt-4">
                <h3 className="font-semibold text-brand-950">Templates de WhatsApp (nombres en WhatsApp Manager)</h3>
                <p className="text-xs text-brand-900/50">Todos usan {"{{1}}"} = nombre y {"{{2}}"} = detalle. Los textos sugeridos están en el README.</p>
              </div>
              {[
                ["recordatorio", "Recordatorio de turno", "recordatorio_turno"],
                ["recall", "Recall de controles", "recall_control"],
                ["lista_espera", "Turno liberado (lista de espera)", "turno_liberado"],
                ["reactivacion", "Reactivación", "reactivacion_paciente"],
                ["no_show", "Recupero de ausentes", "turno_perdido"],
                ["idioma", "Código de idioma de los templates", "es_AR"],
              ].map(([key, label, placeholder]) => (
                <Field key={key} label={label}>
                  <input name={`template_${key}`} defaultValue={t[key] ?? ""} placeholder={placeholder} className={inputClass} />
                </Field>
              ))}
              <div className="sm:col-span-2">
                <button className={buttonClass}>Guardar cambios</button>
              </div>
            </form>
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
                      <form action={toggleProfessional}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={String(!p.active)} />
                        <button className={smallButtonClass}>{p.active ? "Desactivar" : "Activar"}</button>
                      </form>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {blocks.map((s) => (
                        <form key={s.id} action={deleteSchedule} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-800">
                          <input type="hidden" name="id" value={s.id} />
                          {WEEKDAYS[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                          <button title="Quitar" className="ml-1 text-brand-900/40 hover:text-red-600">
                            ×
                          </button>
                        </form>
                      ))}
                      {!blocks.length && <span className="text-xs text-brand-900/50">Sin horarios: el agente no va a ofrecer turnos.</span>}
                    </div>
                    <form action={addSchedule} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
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
            <form action={addProfessional} className="mt-5 grid gap-3 rounded-xl bg-brand-50/50 p-4 sm:grid-cols-2">
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
                  <form action={toggleAppointmentType}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="active" value={String(!x.active)} />
                    <button className={smallButtonClass}>{x.active ? "Desactivar" : "Activar"}</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addAppointmentType} className="mt-5 grid gap-3 rounded-xl bg-brand-50/50 p-4 sm:grid-cols-2">
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
        </div>

        <div className="space-y-6">
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
              <p className="text-xs text-brand-900/50">
                Los llamados de n8n llevan el header <code>x-turnia-secret</code> con el valor de AGENT_TOOLS_SECRET.
              </p>
            </div>
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
        </div>
      </div>
    </>
  );
}
