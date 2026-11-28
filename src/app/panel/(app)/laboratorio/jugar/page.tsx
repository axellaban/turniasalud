import Link from "next/link";
import type { Metadata } from "next";
import { Card, Field, inputClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { INTENT_LABEL, SITUATION_LABEL, labRuns } from "@/lib/lab/panel";
import { allCases } from "@/lib/lab/runs";
import { labPlay } from "../../../lab-actions";
import { LabForm } from "../lab-form";
import { LabHeader, RUN_STATUS, RunLink, fmtScore } from "../lab-ui";

export const metadata: Metadata = { title: "Jugar de paciente · Laboratorio de Sofi" };
export const maxDuration = 300;

export default async function PlayPage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const [cases, runs] = await Promise.all([allCases(clinic.id), labRuns(clinic.id, "jugar")]);
  return (
    <>
      <LabHeader
        current="/panel/laboratorio/jugar"
        title="Jugar de paciente"
        description={`Describí un paciente y la IA juega ese papel contra ${clinic.agent_name}, todas las veces que quieras. Las herramientas responden con datos simulados: no se toca la agenda ni se avisa a nadie.`}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-brand-950">Que juegue la IA</h2>
          <LabForm action={labPlay} submit="Correr" pending="Armando el caso y la simulación (hasta un minuto)…" className="mt-4 space-y-4">
            <Field label="Un paciente nuevo, en tus palabras" hint="Por regla, el servidor no usa la API: un caso nuevo en palabras no se arma acá. Elegí un caso existente; el resultado se evalúa en la pestaña Evaluar.">
              <textarea
                name="descripcion"
                rows={5}
                className={inputClass}
                placeholder="Ej.: Una paciente nueva quiere turno con una profesional mujer, solo después de las 17. Escribe en mensajes cortos y seguidos. Si le dicen que no hay, insiste una vez."
              />
            </Field>
            <Field label="O un caso que ya existe">
              <select name="caso" className={inputClass} defaultValue="">
                <option value="">Elegí un caso…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.titulo} · {INTENT_LABEL[c.intent] ?? c.intent}</option>
                ))}
              </select>
            </Field>
            <Field label="Repeticiones" hint="Sofi no contesta siempre igual: con 2 o 3 se ve si una falla es de casualidad.">
              <select name="repetir" className={inputClass} defaultValue="2">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </LabForm>
        </Card>

        <Card>
          <h2 className="font-semibold text-brand-950">Escribirle vos, en producción</h2>
          <p className="mt-2 text-sm text-brand-900/75">
            Para probar con la agenda real y el WhatsApp real, cargá tu celular en <Link href="/panel/configuracion/turnos#modo-prueba" className="font-medium text-brand-700 hover:underline">Configuración → Turnos y urgencias → Modo prueba</Link> y escribile al número del consultorio. En modo prueba las reservas, cambios, cancelaciones y la lista de espera se simulan y los pedidos no le llegan al equipo.
          </p>
          <p className="mt-2 text-sm text-brand-900/75">
            Esas charlas quedan marcadas como prueba y se puntúan solas en <Link href="/panel/laboratorio/charlas?filtro=pruebas" className="font-medium text-brand-700 hover:underline">Charlas → Pruebas</Link>. Desde ahí, cualquier charla se convierte en un caso de la batería.
          </p>
          <p className="mt-2 text-sm text-brand-900/75">
            Importante: el modo prueba todavía lee pacientes reales al buscar por DNI y guarda la ficha si la registrás. Usá datos ficticios.
          </p>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 font-semibold text-brand-950">Pruebas anteriores</h2>
      {runs.length ? (
        <Card className="p-0">
          <ul className="divide-y divide-brand-900/10">
            {runs.slice(0, 20).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <RunLink id={r.id}>{r.label}</RunLink>
                  <span className="block text-xs text-brand-900/60">
                    {r.cases[0] ? `${INTENT_LABEL[r.cases[0].intent] ?? r.cases[0].intent} · ${SITUATION_LABEL[r.cases[0].situation] ?? r.cases[0].situation} · ` : ""}
                    {formatDateTime(r.created_at, clinic.timezone)}
                  </span>
                </span>
                <span className="font-semibold">{r.status === "terminada" ? fmtScore(r.score) : RUN_STATUS[r.status]?.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-sm text-brand-900/70">Todavía no hay pruebas.</p>
      )}
    </>
  );
}
