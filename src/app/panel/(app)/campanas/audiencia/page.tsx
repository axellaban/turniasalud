import Link from "next/link";
import type { Metadata } from "next";
import { sql } from "@/lib/db";
import { getPanelClinic } from "@/lib/panel-clinic";
import { getSavedAudience } from "@/lib/saved-audiences";
import { isUuid } from "@/lib/clinic";
import { EMPTY_RULES } from "@/lib/audience-rules";
import { PageHeader } from "@/components/ui";
import { AudienceBuilder } from "./audience-builder";

export const metadata: Metadata = { title: "Nueva audiencia · Campañas" };

export default async function NewAudiencePage(props?: PageProps<"/panel/campanas/audiencia">) {
  const params = (await props?.searchParams) ?? {};
  const id = typeof params.id === "string" && isUuid(params.id) ? params.id : null;
  const clinic = await getPanelClinic();
  const [types, professionals, coverages, saved] = await Promise.all([
    sql<Array<{ id: string; name: string }>>`select id, name from appointment_types where clinic_id = ${clinic.id} and active order by name`,
    sql<Array<{ id: string; full_name: string }>>`select id, full_name from professionals where clinic_id = ${clinic.id} and active order by full_name`,
    sql<Array<{ coverage: string }>>`
      select coverage from patients where clinic_id = ${clinic.id} and coverage is not null and coverage <> ''
      group by coverage order by count(*) desc, coverage limit 40`,
    id ? getSavedAudience(clinic.id, id) : Promise.resolve(null),
  ]);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/panel/campanas" className="text-brand-700 hover:underline">
          ← Campañas
        </Link>
      </p>
      <PageHeader title={saved ? saved.name : "Nueva audiencia"} description="Elegí a quién escribirle. El número se actualiza con cada regla." />
      <AudienceBuilder
        clinicId={clinic.id}
        audienceId={saved?.id ?? null}
        initialName={saved?.name ?? ""}
        initialRules={saved?.rules ?? EMPTY_RULES}
        types={types}
        professionals={professionals}
        coverages={coverages.map((c) => c.coverage)}
        cooldownDays={clinic.contact_cooldown_days}
        externalSource={clinic.external_reminders}
      />
    </>
  );
}
