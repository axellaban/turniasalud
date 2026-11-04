import Link from "next/link";
import { ProfileSaveForm } from "./profile-save";
import { retainClinic, revokeAccess } from "../../clinics-actions";
import { getPanelClinic, getPanelUser, recentClinicChanges } from "@/lib/panel-clinic";
import { clinicInfoText, getClinic } from "@/lib/clinic";
import { listClinicAccess } from "@/lib/clinic-access";
import { listStaffPhones } from "@/lib/staff";
import { displayPhone } from "@/lib/phone";
import { addStaffPhone, removeStaffPhone } from "../../protocol-actions";
import { ActionForm } from "./action-form";
import { formatDateTime } from "@/lib/time";
import { env } from "@/lib/env";
import { Badge, Card, Field, Notice, inputClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { ConfigHeader } from "./header";
import { Section, wide } from "./section";
import { AccessCreator } from "./access-manager";
import { ClinicAgentSetup, StaffAgentSetup } from "./clinic-agent";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Consultorio · Panel" };



/** Zonas horarias habituales (Argentina primero); se conserva la guardada aunque sea otra. */
const TIMEZONES: Array<[string, string]> = [
  ["America/Argentina/Buenos_Aires", "Argentina · Buenos Aires y la mayoría de las provincias"],
  ["America/Argentina/Cordoba", "Argentina · Córdoba"],
  ["America/Argentina/Mendoza", "Argentina · Mendoza"],
  ["America/Argentina/Salta", "Argentina · Salta"],
  ["America/Argentina/Jujuy", "Argentina · Jujuy"],
  ["America/Argentina/Tucuman", "Argentina · Tucumán"],
  ["America/Argentina/Catamarca", "Argentina · Catamarca"],
  ["America/Argentina/La_Rioja", "Argentina · La Rioja"],
  ["America/Argentina/San_Juan", "Argentina · San Juan"],
  ["America/Argentina/San_Luis", "Argentina · San Luis"],
  ["America/Argentina/Rio_Gallegos", "Argentina · Santa Cruz"],
  ["America/Argentina/Ushuaia", "Argentina · Tierra del Fuego"],
  ["America/Montevideo", "Uruguay"],
  ["America/Santiago", "Chile"],
  ["America/Asuncion", "Paraguay"],
  ["America/La_Paz", "Bolivia"],
  ["America/Lima", "Perú"],
  ["America/Bogota", "Colombia"],
  ["America/Sao_Paulo", "Brasil · São Paulo"],
  ["America/Mexico_City", "México · Ciudad de México"],
  ["Europe/Madrid", "España"],
];
function timezones(current: string): Array<{ value: string; label: string }> {
  const list = TIMEZONES.map(([value, label]) => ({ value, label }));
  return list.some((z) => z.value === current) ? list : [{ value: current, label: current.replace(/_/g, " ") }, ...list];
}

export default async function SettingsPage() {
  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const admin = user.role === "admin";
  const agent = clinic.agent_name || "Sofi";
  const [accesses, changes, main, staff] = await Promise.all([
    admin ? listClinicAccess(clinic.id) : [],
    recentClinicChanges(clinic.id),
    admin ? getClinic() : null,
    admin ? listStaffPhones(clinic.id) : [],
  ]);
  const loginUrl = `${env.appUrl().replace(/\/$/, "")}/panel/login`;
  const status = !clinic.is_demo ? "Clínica principal." : clinic.retained_at ? "Demo conservada: su agenda es de prueba y no se borra sola." : "Demo temporal: se borra sola a los 7 días si no la conservás.";

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion" />
      {!admin && <Notice tone="info" className="mb-6">
        <strong>Hola{user.label ? `, ${user.label}` : ""}.</strong> Acá cargás cómo atiende tu consultorio. Empezá por estos datos y seguí con las pestañas de arriba, en orden.
        Cada cambio lo usa {agent} desde el próximo mensaje.
      </Notice>}
      {/* En pantallas angostas la columna de la derecha queda debajo de todo el formulario. */}
      {admin && <nav aria-label="Solo Turnia" className="mb-4 flex flex-wrap items-center gap-2 text-sm xl:hidden">
        <span className="text-brand-900/60">Solo Turnia:</span>
        <a href="#whatsapp-equipo" className={smallButtonClass}>Acceso total por WhatsApp{staff.length ? ` (${staff.length})` : ""}</a>
        <a href="#acceso-consultorio" className={smallButtonClass}>Acceso del consultorio</a>
        {clinic.id !== main?.id && <a href="#agente-llamadas" className={smallButtonClass}>{agent} · llamadas</a>}
      </nav>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <ProfileSaveForm key={clinic.id} clinicId={clinic.id} revision={clinic.context_revision} agentName={agent}>
            <Section id="datos" title="Datos del consultorio" description={`Lo que ${agent} le dice al paciente cuando pregunta dónde están, cuándo atienden o cómo se paga.`}>
              <Field label="Nombre del consultorio"><input name="name" defaultValue={clinic.name} className={inputClass} required /></Field>
              <Field label="Nombre del agente" hint="Cómo se presenta al atender."><input name="agent_name" defaultValue={clinic.agent_name} className={inputClass} required /></Field>
              <Field label="Especialidad"><input name="specialty" defaultValue={clinic.specialty} placeholder="Odontología" className={inputClass} /></Field>
              <Field label="Teléfono"><input name="phone" defaultValue={clinic.phone ?? ""} inputMode="tel" className={inputClass} /></Field>
              <div className={wide}><Field label="Dirección"><input name="address" defaultValue={clinic.address ?? ""} className={inputClass} /></Field></div>
              <div className={wide}>
                <Field label="Horario de atención" hint="Cómo lo dice al paciente. Los turnos que ofrece salen de «Equipo y horarios».">
                  <input name="hours_text" defaultValue={clinic.hours_text ?? ""} placeholder="Lunes a viernes de 9 a 18" className={inputClass} />
                </Field>
              </div>
              <div className={wide}><Field label="Formas de pago"><textarea name="payment_methods" rows={2} defaultValue={clinic.payment_methods ?? ""} placeholder="Efectivo, transferencia y tarjetas" className={inputClass} /></Field></div>
              <Field
                label="Web"
                hint={clinic.website ? undefined : "Con la web guardada, se puede leer para completar la ficha."}
              >
                <input name="website" defaultValue={clinic.website ?? ""} placeholder="https://miconsultorio.com.ar" className={inputClass} />
              </Field>
              <Field label="Zona horaria"><select name="timezone" defaultValue={clinic.timezone} className={inputClass}>{timezones(clinic.timezone).map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}</select></Field>
              {clinic.website && <p className={`${wide} -mt-2 text-sm`}><Link href="/panel/configuracion/web" className="font-medium text-brand-700 hover:underline">Completar la ficha con lo que dice la web →</Link></p>}
            </Section>

            <Section id="respuestas" title={`Lo que responde ${agent}`} description="Una idea por línea es más fácil de mantener. Los turnos, las coberturas y las urgencias tienen su pestaña: ahí se cargan como reglas que se cumplen siempre.">
              <div className={wide}><Field label="Preguntas frecuentes" hint="Estacionamiento, qué traer, si atienden chicos… una por línea."><textarea name="faq" rows={6} defaultValue={clinic.faq ?? ""} className={inputClass} /></Field></div>
              <Field label="Cómo trata a los pacientes" hint="De usted: en todos los mensajes, aunque el paciente tutee.">
                <select name="tone" defaultValue={clinic.tone === "usted" ? "usted" : ""} className={inputClass}>
                  <option value="">De vos</option>
                  <option value="usted">De usted</option>
                </select>
              </Field>
              <div className={wide}><Field label="Instrucciones adicionales" hint="Cómo atender, qué preguntar, qué evitar y cualquier contexto propio del consultorio."><textarea name="agent_context" rows={5} defaultValue={clinic.agent_context ?? ""} className={inputClass} /></Field></div>
            </Section>
          </ProfileSaveForm>
        </div>

        <div className="space-y-6">
          {admin && <Card id="whatsapp-equipo" className="scroll-mt-20">
            <h2 className="font-semibold text-brand-950">Acceso total por WhatsApp</h2>
            <p className="mt-1 text-sm text-brand-900/60">
              Celulares del equipo que, al escribirle a {agent} por WhatsApp, pueden ver la agenda y los pacientes, dar, mover y cancelar cualquier turno, bloquear la agenda y responder los pedidos al equipo. Por llamada, no: el número de quien llama se puede falsear.
            </p>
            {staff.length > 0 && <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
              {staff.map((member) => <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium text-brand-950">{member.name}</span> <span className="text-brand-900/65">· {displayPhone(member.phone)}</span></span>
                <form action={removeStaffPhone}><input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="id" value={member.id} /><button className={smallButtonClass} aria-label={`Quitar el acceso de ${member.name}`}>Quitar</button></form>
              </li>)}
            </ul>}
            <ActionForm action={addStaffPhone} submit="Dar acceso" resetOnSuccess secondary className="mt-4 grid gap-3">
              <input type="hidden" name="clinic_id" value={clinic.id} />
              <Field label="De quién es"><input name="name" required maxLength={80} placeholder="Dr. Mininni" className={inputClass} /></Field>
              <Field label="Celular" hint="Con código de área. Es el de WhatsApp."><input name="phone" required inputMode="tel" placeholder="11 5555-0100" className={inputClass} /></Field>
            </ActionForm>
            <div className="mt-4 border-t border-brand-900/5 pt-4">
              <p className="mb-2 text-xs text-brand-900/65">
                Si {agent} no reconoce al equipo (contesta como a un paciente), actualizala acá una vez. Después, cada celular nuevo vale desde su próximo mensaje.
              </p>
              <StaffAgentSetup key={clinic.id} clinicId={clinic.id} agentName={agent} disabled={!process.env.ELEVENLABS_API_KEY} />
            </div>
          </Card>}

          {admin && clinic.id !== main?.id && <Card id="agente-llamadas" className="scroll-mt-20">
            <h2 className="font-semibold text-brand-950">{agent} de este consultorio · llamadas</h2>
            <p className="mt-1 text-sm text-brand-900/60">Un agente propio para atender las llamadas con las reglas y la agenda de {clinic.name}.</p>
            <p className="mt-3 text-sm text-brand-900/70">{clinic.elevenlabs_agent_id ? <>Agente preparado: <code className="break-all text-xs">{clinic.elevenlabs_agent_id}</code>.</> : "Todavía no tiene un agente propio preparado."}</p>
            <ClinicAgentSetup key={clinic.id} clinicId={clinic.id} disabled={!process.env.ELEVENLABS_API_KEY} />
            <p className="mt-3 text-xs text-brand-900/65">
              {clinic.elevenlabs_agent_id
                ? "Actualizalo después de cada cambio de Turnia en Sofi, para que las llamadas lo tomen. No toca el número ni el desvío de la línea."
                : "Prepararlo no conecta ni desvía la línea telefónica. Después hay que asignarle el número en el proveedor y comprobar una llamada entrante."}
            </p>
            <p className="mt-2 text-xs text-brand-900/65">Las llamadas que Turnia inicia por Twilio se graban (con cargo por uso); las del navegador y Telegram, no. <a href="https://www.twilio.com/console/voice/recordings/recording-logs?x-target-region=us1&__override_layout__=embed" target="_blank" rel="noopener noreferrer" className="underline">Ver grabaciones en Twilio</a>.</p>
          </Card>}

          {admin && <Card id="acceso-consultorio" className="scroll-mt-20">
            <h2 className="font-semibold text-brand-950">Acceso del consultorio</h2>
            <p className="mt-1 text-sm text-brand-900/60">Un código para que el consultorio entre al panel. Solo ve y edita esta clínica, y no puede borrar fichas.</p>
            <div className="mt-4"><AccessCreator clinicId={clinic.id} loginUrl={loginUrl} /></div>
            {accesses.length > 0 && <ul className="mt-4 divide-y divide-brand-900/5 text-sm">
              {accesses.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-brand-950">{a.label || "Sin nombre"}</span> <span className="font-mono text-xs text-brand-900/65">····{a.code_hint}</span>
                  <span className="block text-xs text-brand-900/65">{a.revoked_at ? `Revocado ${formatDateTime(a.revoked_at, clinic.timezone)}` : a.last_used_at ? `Último ingreso ${formatDateTime(a.last_used_at, clinic.timezone)}` : `Creado ${formatDateTime(a.created_at, clinic.timezone)} · sin ingresos`}</span>
                </span>
                {a.revoked_at ? <Badge>Revocado</Badge> : <form action={revokeAccess}><input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="access_id" value={a.id} /><button className={smallButtonClass}>Revocar</button></form>}
              </li>)}
            </ul>}
            <p className="mt-4 text-xs text-brand-900/65">{status}</p>
            {clinic.is_demo && !clinic.retained_at && <form action={retainClinic} className="mt-2"><input type="hidden" name="clinic_id" value={clinic.id} /><button className={secondaryButtonClass}>Conservar esta demo</button></form>}
          </Card>}

          <Card>
            <h2 className="font-semibold text-brand-950">Últimos cambios</h2>
            {changes.length ? <ul className="mt-3 space-y-2 text-sm">
              {changes.map((c) => <li key={c.id} className="flex flex-wrap justify-between gap-x-2">
                <span><span className="font-medium text-brand-950">{c.actor}</span> <span className="text-brand-900/60">· {c.area}</span></span>
                <span className="text-xs text-brand-900/65">{formatDateTime(c.created_at, clinic.timezone)}</span>
              </li>)}
            </ul> : <p className="mt-2 text-sm text-brand-900/60">Todavía no hay cambios registrados.</p>}
          </Card>

          <Card>
            <details>
              <summary className="cursor-pointer font-semibold text-brand-950">Lo que sabe {agent} del consultorio</summary>
              <p className="mt-2 text-xs text-brand-900/65">Así le llega lo guardado en esta pestaña y en «Turnos y urgencias». Los profesionales, las prestaciones y las coberturas le llegan aparte.</p>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-brand-900/70">{clinicInfoText(clinic)}</pre>
            </details>
          </Card>
        </div>
      </div>
    </>
  );
}
