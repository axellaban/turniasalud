import Link from "next/link";
import { ProfileSaveForm } from "./profile-save";
import { ProfileTest } from "../clinicas/forms";
import { retainClinic, revokeAccess } from "../../clinics-actions";
import { getPanelClinic, getPanelUser, recentClinicChanges } from "@/lib/panel-clinic";
import { clinicInfoText } from "@/lib/clinic";
import { listClinicAccess } from "@/lib/clinic-access";
import { formatDateTime } from "@/lib/time";
import { env } from "@/lib/env";
import { Badge, Card, Field, Notice, buttonClass, inputClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { ConfigHeader } from "./header";
import { AccessCreator } from "./access-manager";
import { CoverageInput } from "./coverage-input";
import { CompletenessCard } from "../completeness-card";
import { profileCompleteness } from "@/lib/profile-completeness";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reglas del consultorio · Panel" };

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="scroll-mt-20" id={id}>
      <h2 className="font-semibold text-brand-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-brand-900/60">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

const wide = "sm:col-span-2";

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
  const [accesses, completeness, changes] = await Promise.all([admin ? listClinicAccess(clinic.id) : [], profileCompleteness(clinic), recentClinicChanges(clinic.id)]);
  const loginUrl = `${env.appUrl().replace(/\/$/, "")}/panel/login`;

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion" />
      {!admin && <Notice tone="info" className="mb-6">
        <strong>Hola{user.label ? `, ${user.label}` : ""}.</strong> Acá cargás cómo atiende tu consultorio: datos, horarios, coberturas y lo que tiene que responder el agente.
        Cambiá lo que necesites, tocá <strong>Guardar cambios</strong> y probalo desde <strong>Probar el agente</strong>: el agente usa la ficha nueva desde el próximo mensaje.
      </Notice>}
      {/* En el celular primero va qué falta y cómo probar; en la compu, a la derecha del formulario. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr]">
        <div className="space-y-6 xl:col-start-2 xl:row-start-1">
          <CompletenessCard {...completeness} compact />
          <Card id="probar" className="scroll-mt-20">
            <h2 className="font-semibold text-brand-950">Probar el agente</h2>
            <p className="mt-1 text-sm text-brand-900/60">Guardá los cambios y escribile: el agente usa la ficha nueva desde el próximo mensaje.</p>
            {clinic.is_demo && <div className="mt-4 space-y-3">
              <ProfileTest key={clinic.id} clinicId={clinic.id} />
              {!clinic.retained_at && <form action={retainClinic}><input type="hidden" name="clinic_id" value={clinic.id} /><button className={secondaryButtonClass}>Conservar esta demo</button></form>}
            </div>}
            <Link href="/demo" className={`${clinic.is_demo ? "mt-3" : "mt-4"} inline-flex text-sm font-medium text-brand-700 hover:underline`}>Probar por voz o texto en el navegador →</Link>
            {admin && <p className="mt-3 text-sm text-brand-900/70">Las llamadas telefónicas nuevas que Turnia inicia por Twilio se solicitan con grabación. <a href="https://www.twilio.com/console/voice/recordings/recording-logs?x-target-region=us1&__override_layout__=embed" target="_blank" rel="noopener noreferrer" className="underline">Abrir grabaciones en Twilio</a>. No incluye llamadas de navegador o Telegram. Grabación y almacenamiento tienen cargo por uso.</p>}
            <p className="mt-3 text-xs text-brand-900/65">{!clinic.is_demo ? "Clínica principal." : clinic.retained_at ? "Demo conservada: su agenda es de prueba y no se borra sola." : "Demo temporal: se borra sola a los 7 días si no la guardás o conservás."}</p>
          </Card>
        </div>
        <div className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1">
        <ProfileSaveForm key={clinic.id} clinicId={clinic.id} revision={clinic.context_revision}>
          <Section id="datos" title="Datos de la clínica">
            <Field label="Nombre de la clínica"><input name="name" defaultValue={clinic.name} className={inputClass} required /></Field>
            <Field label="Nombre del agente" hint="Cómo se presenta al atender."><input name="agent_name" defaultValue={clinic.agent_name} className={inputClass} required /></Field>
            <Field label="Especialidad / tipo de centro"><input name="specialty" defaultValue={clinic.specialty} className={inputClass} /></Field>
            <Field label="Teléfono"><input name="phone" defaultValue={clinic.phone ?? ""} inputMode="tel" className={inputClass} /></Field>
            <div className={wide}><Field label="Dirección"><input name="address" defaultValue={clinic.address ?? ""} className={inputClass} /></Field></div>
            <Field label="Web del consultorio"><input name="website" defaultValue={clinic.website ?? ""} placeholder="https://miclinica.com.ar" className={inputClass} /></Field>
            <Field label="Zona horaria"><select name="timezone" defaultValue={clinic.timezone} className={inputClass}>{timezones(clinic.timezone).map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}</select></Field>
          </Section>

          <Section id="atencion" title="Atención y pagos" description="Lo que el agente dice cuando preguntan cuándo atienden, con qué cobertura y cómo se paga.">
            <div className={wide}><Field label="Horario de atención" hint="Texto que se le dice al paciente. Los turnos salen de «Equipo y horarios»."><input name="hours_text" defaultValue={clinic.hours_text ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><p className="mb-1 text-sm font-medium text-brand-900">Coberturas aceptadas</p><CoverageInput name="accepted_coverages" defaultValue={clinic.accepted_coverages} /><p className="mt-1 text-xs text-brand-900/65">Agregá «Particular» si atienden sin cobertura.</p></div>
            <div className={wide}><Field label="Formas de pago"><textarea name="payment_methods" rows={2} defaultValue={clinic.payment_methods ?? ""} className={inputClass} /></Field></div>
          </Section>

          <Section id="respuestas" title="Lo que responde el agente" description="Preguntas frecuentes, reglas y forma de atender. Una idea por línea es más fácil de mantener.">
            <div className={wide}><Field label="Preguntas frecuentes" hint="Estacionamiento, precios, qué traer, formas de pago… una por línea."><textarea name="faq" rows={6} defaultValue={clinic.faq ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Políticas" hint="Cancelaciones, tolerancia, coberturas que no se aceptan…"><textarea name="policies" rows={3} defaultValue={clinic.policies ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Instrucciones adicionales del agente" hint="Cómo atender, qué preguntar, qué evitar y cualquier contexto propio de esta clínica."><textarea name="agent_context" rows={5} defaultValue={clinic.agent_context ?? ""} className={inputClass} /></Field></div>
          </Section>

          <Section id="urgencias" title="Urgencias y derivación">
            <div className={wide}><Field label="Protocolo de urgencias"><textarea name="urgency_instructions" rows={3} defaultValue={clinic.urgency_instructions ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Fuera de horario" hint="Qué decir cuando no hay nadie atendiendo: guardia de un profesional, teléfono de emergencias, cuándo se responden los pedidos."><textarea name="after_hours_instructions" rows={2} defaultValue={clinic.after_hours_instructions ?? ""} className={inputClass} /></Field></div>
            <Field label="Teléfono de derivación a recepción"><input name="handoff_phone" defaultValue={clinic.handoff_phone ?? ""} inputMode="tel" className={inputClass} /></Field>
          </Section>
        </ProfileSaveForm>
        </div>

        <div className="space-y-6 xl:col-start-2 xl:row-start-2">

          {admin && <Card>
            <h2 className="font-semibold text-brand-950">Acceso del consultorio</h2>
            <p className="mt-1 text-sm text-brand-900/60">Un código propio para que el consultorio entre al panel. Solo ve y edita esta clínica: no ve otras clínicas, pedidos de demo ni el sistema, y no puede borrar fichas.</p>
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
              <summary className="cursor-pointer font-semibold text-brand-950">Vista previa del contexto</summary>
              <p className="mt-2 text-xs text-brand-900/65">Así le llega la ficha guardada al agente.</p>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-brand-900/70">{clinicInfoText(clinic)}</pre>
            </details>
          </Card>
          {admin && <Link href="/panel/sistema" className={`${buttonClass} w-full`}>Canal, agente y sistema →</Link>}
        </div>
      </div>
    </>
  );
}
