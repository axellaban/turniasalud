import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { IMPORT_FIELDS, profileFields, type ClinicImport } from "@/lib/clinic-imports";
import { formatDateTime } from "@/lib/time";
import { discardImport } from "../../../clinics-actions";
import { ImportReview, ReadWebsite } from "../../clinicas/forms";
import { Badge, Card, Empty, smallButtonClass } from "@/components/ui";
import { ConfigHeader, WEEKDAYS } from "../header";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lectura de la web · Panel" };

const STATUS: Record<ClinicImport["status"], { label: string; tone: "gray" | "green" | "yellow" | "red" | "blue" }> = {
  reading: { label: "Leyendo…", tone: "blue" },
  pending: { label: "Propuesta para revisar", tone: "yellow" },
  applied: { label: "Aplicada", tone: "green" },
  error: { label: "Con error", tone: "red" },
  discarded: { label: "Descartada", tone: "gray" },
};

export default async function WebsitePage() {
  const clinic = await getPanelClinic();
  const imports = await sql<ClinicImport[]>`select * from clinic_imports where clinic_id = ${clinic.id} order by created_at desc limit 20`;
  const reading = imports.some((item) => item.status === "reading");
  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/web" />
      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <h2 className="mb-1 font-semibold text-brand-950">Lecturas de la web</h2>
          {clinic.website && <a href={clinic.website} target="_blank" rel="noreferrer" className="mb-3 block break-all text-sm text-brand-600 underline">{clinic.website}</a>}
          <ReadWebsite key={clinic.id} clinicId={clinic.id} reading={reading} hasWebsite={Boolean(clinic.website)} />
        </Card>
        <div className="space-y-4">
          {!imports.length && <Empty>{clinic.website ? "Todavía no leíste la web. Tocá «Leer web y revisar propuesta» y elegí qué datos usar." : "Cuando guardes la web del consultorio en «Reglas del consultorio», vas a poder leerla y elegir qué datos usar."}</Empty>}
          {imports.map((item) => <Card key={item.id}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-brand-950">Lectura del {formatDateTime(item.created_at, clinic.timezone)}</h3><Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge></div>
            <p className="my-2 break-all text-xs text-brand-900/60">{item.source_url} · {item.pages.length} páginas</p>
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
        </div>
      </div>
    </>
  );
}
