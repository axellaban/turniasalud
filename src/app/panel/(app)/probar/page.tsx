import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPanelClinic } from "@/lib/panel-clinic";
import { getCatalog } from "@/lib/clinic";
import { DENTAL_TEST_CASES } from "@/lib/agent/modules/odontologia";
import { qrSvg, telegramBot, testChannelsFor, type ChannelOption } from "@/lib/agent-test";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { PanelIcon, type PanelIconName } from "@/components/panel-icons";
import { Qr, TestLink } from "./test-link";

export const metadata: Metadata = { title: "Probar a Sofi · Panel" };

function Channel({ icon, title, children, action }: { icon: PanelIconName; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <li className="grid gap-4 px-5 py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-x-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 max-sm:hidden">
        <PanelIcon name={icon} className="h-[22px] w-[22px]" />
      </span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-semibold text-brand-950">
          <PanelIcon name={icon} className="h-5 w-5 text-brand-700 sm:hidden" />
          {title}
        </h2>
        <div className="mt-1 max-w-prose text-sm leading-relaxed text-brand-900/70">{children}</div>
        <div className="mt-3">{action}</div>
      </div>
    </li>
  );
}

const unavailable = (option: ChannelOption, agent: string) => (
  <p className="text-sm text-brand-900/60">{option.kind === "no" ? `${option.reason} ` : ""}Mientras tanto, probá en esta pantalla: es la misma {agent}.</p>
);

export default async function ProbarPage() {
  const clinic = await getPanelClinic();
  const [channels, catalog] = await Promise.all([testChannelsFor(clinic), getCatalog(clinic.id)]);
  const { whatsapp, telegram } = channels;
  const agent = clinic.agent_name || "Sofi";
  const waQr = whatsapp.kind === "numero" ? await qrSvg(whatsapp.url) : null;
  const coverage = clinic.accepted_coverages.find((c) => !/particular/i.test(c));
  const firstVisit = catalog.appointmentTypes.find((t) => t.is_first_visit && !t.panel_only) ?? catalog.appointmentTypes.find((t) => !t.panel_only);

  // Qué conviene probar: lo que más le preguntan los pacientes, con datos de esta ficha.
  const dental = /odont|dent/i.test(`${clinic.specialty} ${catalog.professionals.map((p) => p.specialty).join(" ")}`);
  const ideas: Array<[string, string]> = [
    ["«Hola, quiero un turno para la semana que viene»", `Te pide los datos que faltan y te ofrece horarios reales${firstVisit ? `, por ejemplo de ${firstVisit.name.charAt(0).toLowerCase()}${firstVisit.name.slice(1)}` : ""}.`],
    ...(dental ? [["«Quiero una consulta de implantes»", "Te da un turno de consulta que en la agenda dice «Consulta de implantes»."] as [string, string]] : []),
    [`«¿Atienden por ${coverage ?? "mi obra social"}? ¿Cuánto sale la consulta?»`, "Contesta con lo que cargaste en Configuración. Si algo no está, lo dice."],
    ["«Necesito cambiar mi turno»", "Busca tu turno y te ofrece otro día."],
    ["Un audio, o «mandámelo en audio»", "Por WhatsApp te contesta con una nota de voz."],
    [dental ? "«Me duele mucho una muela»" : "«Me duele mucho el pecho»", "Sigue tu protocolo de urgencias."],
  ];

  return (
    <>
      <PageHeader
        title={`Probar a ${agent}`}
        description={`Hablale como si fueras un paciente. Usa la ficha y la agenda reales de ${clinic.name}: si sacás un turno de prueba, cancelalo después desde la Agenda.`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="self-start p-0">
          <ul className="divide-y divide-brand-900/10">
            <Channel
              icon="pantalla"
              title="En esta pantalla"
              action={<Link href="/demo" className={buttonClass}>Empezar la prueba</Link>}
            >
              Por voz o por chat, sin usar el celular. Si ponés el celular de un paciente, {agent} lo reconoce: sus turnos, su cobertura y lo que habló antes.
            </Channel>

            <Channel
              icon="whatsapp"
              title="WhatsApp"
              action={
                whatsapp.kind === "numero" ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <a href={whatsapp.url} target="_blank" rel="noreferrer" className={buttonClass}>
                      Abrir WhatsApp
                      <PanelIcon name="externo" className="h-4 w-4" />
                    </a>
                    {waQr && <Qr svg={waQr} />}
                  </div>
                ) : whatsapp.kind === "enlace" ? (
                  <TestLink clinicId={clinic.id} channel="whatsapp" label="Abrir WhatsApp" />
                ) : (
                  unavailable(whatsapp, agent)
                )
              }
            >
              {whatsapp.kind === "numero" ? (
                <>
                  Escribile al <strong className="font-semibold text-brand-950 tabular-nums">{whatsapp.display}</strong> desde otro celular, como lo haría un paciente.
                  Desde el mismo número de la línea no contesta.
                </>
              ) : whatsapp.kind === "enlace" ? (
                <>Abrí la prueba en el WhatsApp de Turnia ({whatsapp.via}): elegís si {agent} te contesta por chat, con audios o si te llama.</>
              ) : (
                <>Como lo va a usar un paciente.</>
              )}
            </Channel>

            <Channel
              icon="telegram"
              title="Telegram"
              action={telegram.kind === "enlace" ? <TestLink clinicId={clinic.id} channel="telegram" label="Abrir Telegram" /> : unavailable(telegram, agent)}
            >
              Con el bot {telegramBot}. Elegís si {agent} te contesta por chat, con audios o si te llama por teléfono.
            </Channel>
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold text-brand-950">Qué probar</h2>
            <ul className="mt-3 space-y-3">
              {ideas.map(([say, what]) => (
                <li key={say} className="text-sm">
                  <p className="font-medium text-brand-950">{say}</p>
                  <p className="mt-0.5 text-brand-900/65">{what}</p>
                </li>
              ))}
            </ul>
          </Card>
          {dental && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold text-brand-950">Casos odontológicos ({DENTAL_TEST_CASES.length})</summary>
                <p className="mt-1 text-sm text-brand-900/65">Para revisar antes de salir y después de cada cambio de reglas: qué decir y qué tiene que hacer {agent}.</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                  {DENTAL_TEST_CASES.map((c) => (
                    <li key={c.message}>
                      <p className="font-medium text-brand-950">«{c.message}»</p>
                      <p className="mt-0.5 text-brand-900/65">{c.expected}</p>
                    </li>
                  ))}
                </ol>
              </details>
            </Card>
          )}
          <Card>
            <h2 className="font-semibold text-brand-950">Después de probar</h2>
            <p className="mt-1 text-sm leading-relaxed text-brand-900/70">
              Cada charla queda en <Link href="/panel/conversaciones" className="font-medium text-brand-700 hover:underline">Conversaciones</Link>, con su resumen, y los turnos en la{" "}
              <Link href="/panel/agenda" className="font-medium text-brand-700 hover:underline">Agenda</Link>. Si algo no te gustó, cambialo en{" "}
              <Link href="/panel/configuracion" className="font-medium text-brand-700 hover:underline">Configuración</Link>: {agent} lo usa desde la próxima charla.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
