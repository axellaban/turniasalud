import type { Metadata } from "next";
import { Card, smallButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDate } from "@/lib/time";
import { INTENT_LABEL, SITUATION_LABEL, labCoverage, labSavedCases } from "@/lib/lab/panel";
import { isValidCell } from "@/lib/lab/cases";
import { labCoverageCases, labToggleCase } from "../../../lab-actions";
import { LabForm } from "../lab-form";
import { LabHeader, scoreTone } from "../lab-ui";

export const metadata: Metadata = { title: "Cobertura · Laboratorio de Sofi" };
export const maxDuration = 300;

export default async function CoveragePage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const [cov, saved] = await Promise.all([labCoverage(clinic.id), labSavedCases(clinic.id)]);
  const cellOf = (i: string, s: string) => cov.cells.find((c) => c.intent === i && c.situation === s);
  const realByIntent = (i: string) => cov.cells.filter((c) => c.intent === i).reduce((a, c) => a + c.real, 0);
  return (
    <>
      <LabHeader
        current="/panel/laboratorio/cobertura"
        title="Cobertura"
        description="Qué le piden los pacientes a Sofi, cruzado con la situación. Cada celda es un tipo de caso: el número es su puntaje en la última batería. Las grises todavía no tienen casos (se arman solos); «no aplica» son combinaciones que no se dan."
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Cobertura de charlas reales</p>
          <p className="mt-2 font-display text-3xl font-semibold">{cov.coverage === null ? "—" : `${cov.coverage} %`}</p>
          <div className="relative mt-2 h-2 rounded-full bg-[#eef1f8]">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${cov.coverage ?? 0}%` }} />
            <div className="absolute top-[-4px] h-4 w-0.5 bg-brand-950" style={{ left: "90%" }} aria-hidden />
          </div>
          <p className="mt-1.5 text-xs text-brand-900/65">Meta: 90 %. {cov.reviewed} charlas reales revisadas en 30 días.</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Tipos de caso probados</p>
          <p className="mt-2 font-display text-3xl font-semibold">{cov.testedCells} <span className="text-base font-normal text-brand-900/60">de {cov.validCells}</span></p>
          <p className="mt-1.5 text-xs text-brand-900/65">{cov.missingValid ? `Faltan ${cov.missingValid}: se arman solos, de a 2 cada 10 minutos, y entran en la batería siguiente.` : "Todos los tipos de caso tienen al menos uno."} {saved.filter((c) => c.active).length} casos guardados además de los 18 de referencia.</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Sin probar y ya aparecen</p>
          <p className="mt-2 font-display text-3xl font-semibold text-sun-700">{cov.uncoveredWithReal.length}</p>
          <p className="mt-1.5 text-xs text-brand-900/65">Tipos de caso con charlas reales y ningún caso de prueba.</p>
        </Card>
      </div>

      <Card className="mb-5 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Mapa de casos</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-emerald-700">85+</span>
            <span className="rounded-full bg-sun-100 px-2 py-0.5 text-sun-700">70 a 84</span>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">menos de 70</span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700">sin casos</span>
            <span className="rounded-full border border-dashed border-sun-600 px-2 py-0.5 text-sun-700">sin casos y con charlas reales</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-brand-900/70">
                <th scope="col" className="w-44 px-1">Qué quiere \ situación</th>
                {cov.situations.map((s) => <th key={s} scope="col" className="px-1">{SITUATION_LABEL[s] ?? s}</th>)}
                <th scope="col" className="px-1 text-right">Charlas reales</th>
              </tr>
            </thead>
            <tbody>
              {cov.intents.map((i) => (
                <tr key={i}>
                  <th scope="row" className="px-1 text-left text-sm font-medium text-brand-950">{INTENT_LABEL[i] ?? i}</th>
                  {cov.situations.map((s) => {
                    const c = cellOf(i, s);
                    if (!isValidCell(i, s) && !c?.cases && !c?.real) {
                      return <td key={s} className="h-12 text-center align-middle text-[11px] text-brand-900/35">no aplica</td>;
                    }
                    const tested = Boolean(c?.cases);
                    const style = tested
                      ? { background: c?.score === null ? "#eef1f8" : `${scoreTone(c?.score)}26` }
                      : c?.real
                        ? { background: "#fffaf2", border: "1.5px dashed #e67e00" }
                        : { background: "#f1f2f5" };
                    return (
                      <td key={s} className="h-12 rounded-lg text-center align-middle" style={style} title={`${c?.cases ?? 0} casos · ${c?.real ?? 0} charlas reales`}>
                        <span className="font-semibold">{tested ? (c?.score ?? "…") : c?.real ? "!" : "—"}</span>
                        {c?.real ? <span className="block text-[11px] text-brand-900/60">{c.real} reales</span> : null}
                      </td>
                    );
                  })}
                  <td className="px-1 text-right text-brand-900/70">{realByIntent(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-brand-950">Lo que falta probar</h2>
          {cov.missingValid ? (
            <LabForm action={labCoverageCases} submit="Armar 3 ahora" pending="Claude está armando los casos…" className="mt-3 space-y-3">
              <p className="text-sm text-brand-900/75">
                Hay {cov.missingValid} tipo{cov.missingValid === 1 ? "" : "s"} de caso sin ningún caso. El laboratorio los arma solo (primero los que ya aparecen en charlas reales), de a 2 cada 10 minutos. Con el botón, 3 ahora.
              </p>
            </LabForm>
          ) : (
            <p className="mt-2 text-sm text-brand-900/70">Todos los tipos de caso tienen al menos un caso: la batería cubre el mapa completo.</p>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold text-brand-950">Casos guardados</h2>
          {saved.length ? (
            <ul className="mt-3 divide-y divide-brand-900/10 text-sm">
              {saved.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className={c.active ? "" : "text-brand-900/50 line-through"}>
                    {c.title}
                    <span className="block text-xs text-brand-900/60">{INTENT_LABEL[c.intent] ?? c.intent} · {SITUATION_LABEL[c.situation] ?? c.situation} · {c.source.replace("_", " ")} · {formatDate(c.created_at, clinic.timezone)}</span>
                  </span>
                  <LabForm action={labToggleCase} submit={c.active ? "Sacar de la batería" : "Volver a la batería"} button={smallButtonClass}>
                    <input type="hidden" name="caso" value={c.id} />
                  </LabForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-brand-900/70">Los casos que guardes desde Jugar de paciente o Charlas aparecen acá y entran en la batería de cada noche.</p>
          )}
        </Card>
      </div>
    </>
  );
}
