import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/panel-clinic";
import { Card, PageHeader, ghostButtonClass } from "@/components/ui";
import { outreachSettings } from "@/lib/sales/outreach";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_LABEL, TEMPLATE_VARIABLES } from "@/lib/sales/outreach-messages";
import { TemplatesForm } from "./templates-form";

export const metadata: Metadata = { title: "Mensajes · Prospección" };

export default async function MensajesProspeccionPage() {
  await requireAdmin();
  const settings = await outreachSettings();
  return (
    <>
      <Link href="/panel/prospeccion" className={`${ghostButtonClass} -ml-3 mb-2`}>
        ← Prospección
      </Link>
      <PageHeader
        title="Mensajes y metas"
        description="La secuencia de WhatsApp, siempre a la recepción del consultorio: el saludo, el permiso para pasar el link, la demo y el seguimiento. Sin precios ni promesas: el objetivo es que la prueben y se la pasen a los doctores."
      />
      <Card>
        <p className="text-sm text-brand-900/75">
          Variables:{" "}
          {TEMPLATE_VARIABLES.map(([v, d], i) => (
            <span key={v}>
              <code className="rounded bg-brand-50 px-1 text-brand-800">{v}</code> {d}
              {i < TEMPLATE_VARIABLES.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
        <TemplatesForm
          templates={settings.templates}
          defaults={DEFAULT_TEMPLATES}
          keys={[...TEMPLATE_KEYS]}
          labels={TEMPLATE_LABEL}
          dailyGoal={settings.daily_goal}
          weeklyGoal={settings.weekly_goal}
        />
      </Card>
    </>
  );
}
