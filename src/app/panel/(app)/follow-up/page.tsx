import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, secondaryButtonClass } from "@/components/ui";
import { requireAdmin } from "@/lib/panel-clinic";
import { followupOverview } from "@/lib/sales/followup";
import { FollowupBoard } from "./board";

export const metadata: Metadata = { title: "Follow-up · Panel" };

/**
 * Una next best action por etapa del embudo (EMBUDO.md), con quienes esperan en cada una y los
 * números de cada versión. Se ejecuta desde acá, a mano o con la extensión. Ver PLAN_PROSPECCION.md.
 */
export default async function FollowupPage() {
  await requireAdmin();
  const stages = await followupOverview();
  return (
    <>
      <PageHeader
        title="Follow-up"
        description="Una next best action por cada etapa del embudo. Cada versión se mide sola: cuántas veces se ejecutó y cuántos avanzaron después."
        actions={
          <Link href="/panel/prospeccion" className={secondaryButtonClass}>
            Prospección
          </Link>
        }
      />
      <FollowupBoard stages={stages} />
    </>
  );
}
