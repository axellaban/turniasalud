import Link from "next/link";
import type { Metadata } from "next";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { getCatalog, isDentalClinic } from "@/lib/clinic";
import { DENTAL_PROTOCOL, DENTAL_PROTOCOL_VERSION, DENTAL_TEST_CASES } from "@/lib/agent/modules/odontologia";
import { Badge, Field, inputClass } from "@/components/ui";
import { saveBookingRules } from "../../../protocol-actions";
import { ConfigHeader, loadConfigConflicts } from "../header";
import { healthFormSheet, healthFormSheetText } from "@/lib/health-form";
import { ProfileSaveForm } from "../profile-save";
import { Section, wide } from "../section";

export const metadata: Metadata = { title: "Turnos y urgencias · Panel" };

const check = "flex items-start gap-2 text-sm";
const hint = "block text-xs text-brand-900/60";
const link = "font-medium text-brand-700 underline";

export default async function BookingRulesPage() {
  const [clinic, user] = await Promise.all([getPanelClinic(), getPanelUser()]);
  const admin = user.role === "admin";
  const agent = clinic.agent_name || "Sofi";
  const dental = isDentalClinic(clinic, await getCatalog(clinic.id));
  const active = clinic.dental_protocol && dental;
  const sheet = healthFormSheet(clinic);

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/turnos" conflicts={await loadConfigConflicts(clinic)} />
      <ProfileSaveForm key={clinic.id} clinicId={clinic.id} revision={clinic.context_revision} action={saveBookingRules} scope="turnos" agentName={agent}>
        <input type="hidden" name="rules_form" value="1" />
        <Section id="mover" title="Mover y cancelar turnos" description={`Si no se cumple una regla, ${agent} no toca el turno: crea una tarea para recepción y le dice al paciente que lo conserva.`}>
          <Field label="Aviso mínimo para mover (horas)" hint="Vacío: sin mínimo. Por ejemplo, 24.">
            <input name="reschedule_notice_hours" type="number" min={1} max={720} defaultValue={clinic.reschedule_notice_hours ?? ""} className={inputClass} />
          </Field>
          <Field label="Aviso mínimo para cancelar (horas)" hint="Vacío: cancela siempre y ofrece el lugar a la lista de espera.">
            <input name="cancel_notice_hours" type="number" min={1} max={720} defaultValue={clinic.cancel_notice_hours ?? ""} className={inputClass} />
          </Field>
          <Field label={`Visita más larga que mueve ${agent} (minutos)`} hint="Las más largas las mueve recepción. Vacío: sin tope.">
            <input name="reschedule_max_minutes" type="number" min={15} max={600} step={5} defaultValue={clinic.reschedule_max_minutes ?? ""} className={inputClass} />
          </Field>
          <Field label="Turnos que mueve solo recepción" hint="Palabras separadas por coma, en el nombre, el título o las notas del turno. Una consulta o un control de eso sí se mueven.">
            <input name="reception_only_terms" defaultValue={clinic.reception_only_terms ?? ""} placeholder="implante, extracción" className={inputClass} />
          </Field>
          <label className={check}>
            <input type="checkbox" name="keep_duration_on_reschedule" defaultChecked={clinic.keep_duration_on_reschedule} className="mt-1" />
            <span>Al mover un turno, conservar su duración<span className={hint}>Si no, el turno nuevo dura lo que dice su prestación.</span></span>
          </label>
          <label className={check}>
            <input type="checkbox" name="move_panel_only" defaultChecked={clinic.move_panel_only} className="mt-1" />
            <span>{agent} mueve también lo que da solo el consultorio<span className={hint}>Si el paciente ya tiene el turno. Las reglas de arriba siguen valiendo.</span></span>
          </label>
          <label className={check}>
            <input type="checkbox" name="verify_appointment_access" defaultChecked={clinic.verify_appointment_access} className="mt-1" />
            <span>Verificar la identidad para gestionar un turno desde otro número<span className={hint}>Si alguien escribe desde un número que no es el de la ficha, {agent} pide DNI, nombre y, si hace falta, la fecha de nacimiento, y solo deja mover o cancelar en esa charla. Ese número no queda unido a la ficha.</span></span>
          </label>
          <div className={wide}>
            <Field label="Otras condiciones" hint={`${agent} las explica cuando preguntan: tolerancia, seña, qué pasa si no avisa.`}>
              <textarea name="policies" rows={3} defaultValue={clinic.policies ?? ""} className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section id="seguimiento" title="Si el paciente no contesta" description={`Cuando ${agent} le pasa horarios por WhatsApp y no responde, le vuelve a escribir con los que siguen libres. Solo de 9 a 20.`}>
          <Field label="Volver a escribirle" hint="El segundo mensaje va al día siguiente del primero.">
            <select name="followup_attempts" defaultValue={String(clinic.followup_attempts)} className={inputClass}>
              <option value="0">No</option>
              <option value="1">1 vez</option>
              <option value="2">2 veces</option>
            </select>
          </Field>
          <Field label="Primer mensaje después de">
            <select name="followup_delay_hours" defaultValue={String(clinic.followup_delay_hours)} className={inputClass}>
              {[1, 2, 3, 4, 6, 12, 24].map((h) => <option key={h} value={h}>{h === 1 ? "1 hora" : `${h} horas`}</option>)}
            </select>
          </Field>
        </Section>

        <Section id="urgencias" title="Urgencias" description={<>Para guardar lugar en la agenda, marcá una prestación como «Es un turno de urgencia» en <Link href="/panel/configuracion/prestaciones" className={link}>Prestaciones</Link> ({agent} busca para hoy y mañana) y agregá horarios «Solo urgencias» en <Link href="/panel/configuracion/equipo" className={link}>Equipo y horarios</Link>.</>}>
          <div className={wide}>
            <Field label="Qué hacer ante una urgencia" hint="Vacío: le indica llamar al 107 o ir a la guardia más cercana.">
              <textarea name="urgency_instructions" rows={3} defaultValue={clinic.urgency_instructions ?? ""} className={inputClass} />
            </Field>
          </div>
          <Field label="Liberar las horas de urgencia (horas antes)" hint="Si nadie las usó, desde cuántas horas antes se ofrecen para cualquier turno. Vacío: nunca.">
            <input name="urgent_release_hours" type="number" min={1} max={72} defaultValue={clinic.urgent_release_hours ?? ""} className={inputClass} />
          </Field>
        </Section>

        <Section id="ficha-salud" title="Ficha de salud" description={`Si la cargás, ${agent} le manda al paciente la ficha de salud para completar por WhatsApp cuando saca su primer turno, y en la Agenda se imprime con este encabezado. Vacía: el paciente la completa en el consultorio.`}>
          <input type="hidden" name="health_form_field" value="1" />
          <Field label="Iniciales del logo" hint="Hasta 3 letras, por ejemplo CG.">
            <input name="health_form_monogram" maxLength={3} defaultValue={sheet?.monogram ?? ""} className={inputClass} />
          </Field>
          <div className={wide}>
            <Field label="Profesionales del encabezado" hint="Uno por bloque: el nombre en la primera línea y debajo sus datos (título, matrícula, especialidad). Un renglón en blanco entre profesionales. Hasta 4.">
              <textarea name="health_form_text" rows={6} defaultValue={healthFormSheetText(sheet)} placeholder={"DRA. ANA EJEMPLO\nODONTÓLOGA\nM. N. 00000"} className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section id="fuera-de-horario" title="Fuera de horario y derivación">
          <div className={wide}>
            <Field label="Qué decir fuera de horario" hint="Guardia de un profesional, teléfono de emergencias, cuándo se responden los pedidos.">
              <textarea name="after_hours_instructions" rows={2} defaultValue={clinic.after_hours_instructions ?? ""} className={inputClass} />
            </Field>
          </div>
          <Field label="Teléfono para pasar llamadas" hint={`Solo para llamadas: ${agent} le pasa acá a quien pide hablar con una persona. Tiene que ser otra línea, no la que atiende ${agent}. Vacío: deja el pedido en Tareas. El teléfono que se le da al paciente es el de «Consultorio».`}>
            <input name="handoff_phone" defaultValue={clinic.handoff_phone ?? ""} inputMode="tel" placeholder="Otra línea de recepción" className={inputClass} />
          </Field>
        </Section>

        {admin && (
          <Section id="protocolo" title="Protocolo odontológico de Turnia" description="Lo común a todos los consultorios odontológicos: qué es urgente, qué turno corresponde a cada pedido y qué tratamientos empiezan con una consulta. Las instrucciones propias del consultorio mandan sobre él.">
            <div className={`${wide} flex flex-wrap items-center gap-2`}>
              <Badge tone={active ? "green" : "gray"}>{active ? "Prendido" : "Apagado"}</Badge>
              <Badge>Solo Turnia</Badge>
              <span className="text-xs text-brand-900/65">Versión {DENTAL_PROTOCOL_VERSION}</span>
            </div>
            {!dental && <p className={`${wide} text-sm text-sun-700`}>Este consultorio no es odontológico (ni su especialidad ni la de sus profesionales): el protocolo no se usa acá.</p>}
            <input type="hidden" name="dental_protocol_field" value="1" />
            <label className={`${check} ${wide}`}>
              <input type="checkbox" name="dental_protocol" defaultChecked={clinic.dental_protocol} className="mt-1" />
              <span>Usar el protocolo odontológico en este consultorio<span className={hint}>Va prendido en todos los consultorios odontológicos. Después de cada cambio, probá los {DENTAL_TEST_CASES.length} casos de <Link href="/panel/probar" className={link}>Probar a {agent}</Link>.</span></span>
            </label>
            <details className={wide}>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Ver el texto que recibe {agent}</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-neutral-50 p-4 font-sans text-sm text-brand-900/80">{DENTAL_PROTOCOL}</pre>
            </details>
          </Section>
        )}
      </ProfileSaveForm>
    </>
  );
}
