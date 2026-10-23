import Link from "next/link";
import { ProfileSaveForm } from "./profile-save";
import { ProfileTest } from "../clinicas/forms";
import { retainClinic, revokeAccess } from "../../clinics-actions";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { clinicInfoText } from "@/lib/clinic";
import { listClinicAccess } from "@/lib/clinic-access";
import { formatDateTime } from "@/lib/time";
import { env } from "@/lib/env";
import { Badge, Card, Field, buttonClass, inputClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { ConfigHeader } from "./header";
import { AccessCreator } from "./access-manager";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="font-semibold text-brand-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-brand-900/60">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

const wide = "sm:col-span-2";

export default async function SettingsPage() {
  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const admin = user.role === "admin";
  const accesses = admin ? await listClinicAccess(clinic.id) : [];
  const loginUrl = `${env.appUrl().replace(/\/$/, "")}/panel/login`;

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ProfileSaveForm key={clinic.id} clinicId={clinic.id} revision={clinic.context_revision}>
          <Section title="Datos de la clínica">
            <Field label="Nombre de la clínica"><input name="name" defaultValue={clinic.name} className={inputClass} required /></Field>
            <Field label="Nombre del agente" hint="Cómo se presenta al atender."><input name="agent_name" defaultValue={clinic.agent_name} className={inputClass} required /></Field>
            <Field label="Especialidad / tipo de centro"><input name="specialty" defaultValue={clinic.specialty} className={inputClass} /></Field>
            <Field label="Teléfono"><input name="phone" defaultValue={clinic.phone ?? ""} inputMode="tel" className={inputClass} /></Field>
            <div className={wide}><Field label="Dirección"><input name="address" defaultValue={clinic.address ?? ""} className={inputClass} /></Field></div>
            <Field label="Web del consultorio"><input name="website" defaultValue={clinic.website ?? ""} placeholder="https://miclinica.com.ar" className={inputClass} /></Field>
            <Field label="Zona horaria"><input name="timezone" defaultValue={clinic.timezone} placeholder="America/Argentina/Buenos_Aires" className={inputClass} /></Field>
          </Section>

          <Section title="Atención y pagos" description="Lo que el agente dice cuando preguntan cuándo atienden, con qué cobertura y cómo se paga.">
            <div className={wide}><Field label="Horario de atención" hint="Texto que se le dice al paciente. Los turnos salen de «Equipo y horarios»."><input name="hours_text" defaultValue={clinic.hours_text ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Coberturas aceptadas" hint="Separadas por coma. Incluí «Particular» si atienden sin cobertura."><input name="accepted_coverages" defaultValue={clinic.accepted_coverages.join(", ")} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Formas de pago"><textarea name="payment_methods" rows={2} defaultValue={clinic.payment_methods ?? ""} className={inputClass} /></Field></div>
          </Section>

          <Section title="Lo que responde el agente" description="Preguntas frecuentes, reglas y forma de atender. Una idea por línea es más fácil de mantener.">
            <div className={wide}><Field label="Preguntas frecuentes" hint="Estacionamiento, precios, qué traer, formas de pago… una por línea."><textarea name="faq" rows={6} defaultValue={clinic.faq ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Políticas" hint="Cancelaciones, tolerancia, coberturas que no se aceptan…"><textarea name="policies" rows={3} defaultValue={clinic.policies ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Instrucciones adicionales del agente" hint="Cómo atender, qué preguntar, qué evitar y cualquier contexto propio de esta clínica."><textarea name="agent_context" rows={5} defaultValue={clinic.agent_context ?? ""} className={inputClass} /></Field></div>
          </Section>

          <Section title="Urgencias y derivación">
            <div className={wide}><Field label="Protocolo de urgencias"><textarea name="urgency_instructions" rows={3} defaultValue={clinic.urgency_instructions ?? ""} className={inputClass} /></Field></div>
            <div className={wide}><Field label="Fuera de horario" hint="Qué decir cuando no hay nadie atendiendo: guardia de un profesional, teléfono de emergencias, cuándo se responden los pedidos."><textarea name="after_hours_instructions" rows={2} defaultValue={clinic.after_hours_instructions ?? ""} className={inputClass} /></Field></div>
            <Field label="Teléfono de derivación a recepción"><input name="handoff_phone" defaultValue={clinic.handoff_phone ?? ""} inputMode="tel" className={inputClass} /></Field>
          </Section>
        </ProfileSaveForm>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold text-brand-950">Probar el agente</h2>
            <p className="mt-1 text-sm text-brand-900/60">Guardá los cambios y empezá una conversación nueva para que use esta ficha.</p>
            {clinic.is_demo && <div className="mt-4 space-y-3">
              <ProfileTest key={clinic.id} clinicId={clinic.id} />
              {!clinic.retained_at && <form action={retainClinic}><input type="hidden" name="clinic_id" value={clinic.id} /><button className={secondaryButtonClass}>Conservar esta demo</button></form>}
            </div>}
            <Link href="/demo" className={`${clinic.is_demo ? "mt-3" : "mt-4"} inline-flex text-sm font-medium text-brand-700 hover:underline`}>Probar por voz o texto en el navegador →</Link>
            <p className="mt-3 text-xs text-brand-900/50">{!clinic.is_demo ? "Clínica principal." : clinic.retained_at ? "Demo conservada: su agenda es de prueba y no se borra sola." : "Demo temporal: se borra sola a los 7 días si no la guardás o conservás."}</p>
          </Card>

          {admin && <Card>
            <h2 className="font-semibold text-brand-950">Acceso del consultorio</h2>
            <p className="mt-1 text-sm text-brand-900/60">Un código propio para que el consultorio entre al panel. Solo ve y edita esta clínica: no ve otras clínicas, pedidos de demo ni el sistema, y no puede borrar fichas.</p>
            <div className="mt-4"><AccessCreator clinicId={clinic.id} loginUrl={loginUrl} /></div>
            {accesses.length > 0 && <ul className="mt-4 divide-y divide-brand-900/5 text-sm">
              {accesses.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-brand-950">{a.label || "Sin nombre"}</span> <span className="font-mono text-xs text-brand-900/50">····{a.code_hint}</span>
                  <span className="block text-xs text-brand-900/50">{a.revoked_at ? `Revocado ${formatDateTime(a.revoked_at, clinic.timezone)}` : a.last_used_at ? `Último ingreso ${formatDateTime(a.last_used_at, clinic.timezone)}` : `Creado ${formatDateTime(a.created_at, clinic.timezone)} · sin ingresos`}</span>
                </span>
                {a.revoked_at ? <Badge>Revocado</Badge> : <form action={revokeAccess}><input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="access_id" value={a.id} /><button className={smallButtonClass}>Revocar</button></form>}
              </li>)}
            </ul>}
          </Card>}

          <Card>
            <details>
              <summary className="cursor-pointer font-semibold text-brand-950">Vista previa del contexto</summary>
              <p className="mt-2 text-xs text-brand-900/50">Así le llega la ficha guardada al agente.</p>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-brand-900/70">{clinicInfoText(clinic)}</pre>
            </details>
          </Card>
          {admin && <Link href="/panel/sistema" className={`${buttonClass} w-full`}>Canal, agente y sistema →</Link>}
        </div>
      </div>
    </>
  );
}
