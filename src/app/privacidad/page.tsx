import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getClinic } from "@/lib/clinic";
import { isConfigured } from "@/lib/env";
import type { Clinic } from "@/lib/types";

export const metadata: Metadata = { title: "Privacidad" };
export const dynamic = "force-dynamic";

// Política de privacidad pública (Meta la pide para verificar el WhatsApp de la
// clínica). Toma los datos de contacto de la clínica configurada en el panel.
// Antes de usarla con pacientes reales, que la revise un abogado.

async function clinicOrNull(): Promise<Clinic | null> {
  if (!isConfigured().database) return null;
  try {
    return await getClinic();
  } catch {
    return null;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl text-brand-950">{title}</h2>
      <div className="mt-2 space-y-2 leading-relaxed text-brand-900/80">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  const clinic = await clinicOrNull();
  const name = clinic?.name ?? "la clínica que te atiende";
  const contact = [clinic?.address, clinic?.phone].filter(Boolean).join(" · ");

  return (
    <div className="flex-1">
      <header className="border-b border-brand-900/5">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight text-brand-950">Política de privacidad</h1>
        <p className="mt-2 text-sm text-brand-900/60">
          Aplica a la atención por WhatsApp, teléfono y web de {name}, que usa Turnia Salud como asistente virtual.
        </p>

        <Section title="Quién es responsable de tus datos">
          <p>
            El responsable de la base de datos es {name}
            {contact ? ` (${contact})` : ""}. Turnia Salud presta el servicio tecnológico por cuenta de la clínica y solo usa los
            datos para brindar ese servicio.
          </p>
        </Section>

        <Section title="Qué datos usamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>Identificación y contacto: nombre, celular o identificador de WhatsApp, DNI, fecha de nacimiento y email.</li>
            <li>Cobertura: obra social o prepaga, plan y número de afiliado (también si nos mandás una foto de la credencial).</li>
            <li>Turnos: profesional, práctica, fecha, asistencia y cancelaciones.</li>
            <li>
              Conversaciones: los mensajes, audios y llamadas con el asistente, su transcripción y un resumen, y las órdenes o
              documentos que nos envíes.
            </li>
            <li>Pedidos al equipo (recetas, resultados, consultas) y tus respuestas a encuestas de satisfacción.</li>
          </ul>
          <p>
            Algunos de estos datos son de salud y la ley los considera sensibles. Solo los usa el equipo de la clínica, con el deber
            de secreto profesional.
          </p>
        </Section>

        <Section title="Para qué los usamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>Darte, confirmar, cancelar y reprogramar turnos, y completar tu admisión.</li>
            <li>Responder tus consultas y pasarle tus pedidos al equipo de la clínica.</li>
            <li>Recordarte turnos y avisarte de controles pendientes, turnos liberados o cambios en la atención.</li>
            <li>Mejorar la calidad de la atención.</li>
          </ul>
          <p>
            El asistente es una inteligencia artificial: no da diagnósticos ni indicaciones médicas. No vendemos ni cedemos tus datos
            a terceros para publicidad.
          </p>
        </Section>

        <Section title="Con quién se comparten">
          <p>
            Para funcionar, el servicio usa proveedores que procesan los datos por cuenta de la clínica: alojamiento de la aplicación
            y de la base de datos, el servicio de voz y texto del asistente (que incluye un modelo de lenguaje), WhatsApp (Meta) y
            las herramientas de automatización del equipo. Algunos de esos servicios están fuera de la Argentina.
          </p>
        </Section>

        <Section title="Cómo dejar de recibir mensajes">
          <p>
            Escribí &quot;baja&quot; o pedile al asistente que no te escriba más y no vas a recibir más campañas ni encuestas. Los
            recordatorios de los turnos que pidas siguen llegando.
          </p>
        </Section>

        <Section title="Tus derechos">
          <p>
            Podés pedir acceso a tus datos, y que se rectifiquen, actualicen o eliminen, escribiendo por el mismo WhatsApp o
            comunicándote con {name}. El acceso es gratuito en intervalos de al menos seis meses, salvo que acredites un interés
            legítimo (Ley 25.326, art. 14).
          </p>
          <p className="text-sm text-brand-900/70">
            La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la
            atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
            incumplimiento de las normas vigentes en materia de protección de datos personales.
          </p>
        </Section>
      </main>
    </div>
  );
}
