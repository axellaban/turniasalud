import Link from "next/link";
import { sql } from "@/lib/db";
import { getClinic } from "@/lib/clinic";
import { formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { setTaskStatus } from "../../actions";
import { Badge, Card, Empty, PageHeader, StatusBadge, smallButtonClass } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = {
  receta: "💊 Receta",
  consulta_clinica: "🩺 Consulta clínica",
  resultados: "🧪 Resultados",
  administrativo: "🗂️ Administrativo",
  derivacion_humana: "🙋 Hablar con una persona",
  urgencia: "🚨 Urgencia",
  facturacion: "💳 Facturación",
  otro: "📌 Otro",
};

const PRIORITY_ORDER: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baja: 3 };

type Row = {
  id: string;
  type: string;
  priority: string;
  status: string;
  title: string;
  details: string | null;
  created_at: string;
  conversation_id: string | null;
  patients: { id: string; full_name: string | null; phone: string } | null;
};

export default async function TasksPage({ searchParams }: PageProps<"/panel/tareas">) {
  const clinic = await getClinic();
  const { ver } = await searchParams;
  const showResolved = ver === "resueltas";
  const result = await sql<Row[]>`
    select t.id, t.type, t.priority, t.status, t.title, t.details, t.created_at, t.conversation_id,
      case when p.id is null then null
           else json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) end as patients
    from tasks t left join patients p on p.id = t.patient_id
    where t.clinic_id = ${clinic.id} and ${showResolved ? sql`t.status = 'resuelta'` : sql`t.status <> 'resuelta'`}
    order by t.created_at desc
    limit 200`;
  const rows = [...result].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  );

  return (
    <>
      <PageHeader
        title="Tareas"
        description="Lo que el agente no puede resolver solo llega acá, con todo el contexto para no volver a preguntar."
        actions={
          <Link href={showResolved ? "/panel/tareas" : "/panel/tareas?ver=resueltas"} className={smallButtonClass}>
            {showResolved ? "Ver abiertas" : "Ver resueltas"}
          </Link>
        }
      />
      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((t) => (
            <Card key={t.id} className={t.priority === "urgente" ? "border-red-300" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-brand-900/55">{TYPE_LABEL[t.type] ?? t.type}</p>
                  <h2 className="mt-1 font-semibold text-brand-950">{t.title}</h2>
                </div>
                <div className="flex shrink-0 gap-1">
                  <StatusBadge value={t.priority} />
                  <StatusBadge value={t.status} />
                </div>
              </div>
              {t.details && <p className="mt-2 whitespace-pre-wrap text-sm text-brand-900/70">{t.details}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-brand-900/55">
                <span>
                  {t.patients ? (
                    <Link href={`/panel/pacientes/${t.patients.id}`} className="font-medium text-brand-800 hover:underline">
                      {t.patients.full_name ?? displayPhone(t.patients.phone)}
                    </Link>
                  ) : (
                    "Sin paciente"
                  )}{" "}
                  · {formatDateTime(t.created_at, clinic.timezone)}
                </span>
                {t.status !== "resuelta" ? (
                  <form action={setTaskStatus} className="flex gap-1">
                    <input type="hidden" name="id" value={t.id} />
                    {t.status === "abierta" && (
                      <button name="status" value="en_curso" className={smallButtonClass}>
                        Tomar
                      </button>
                    )}
                    <button name="status" value="resuelta" className={smallButtonClass}>
                      Resolver
                    </button>
                  </form>
                ) : (
                  <form action={setTaskStatus}>
                    <input type="hidden" name="id" value={t.id} />
                    <button name="status" value="abierta" className={smallButtonClass}>
                      Reabrir
                    </button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty>{showResolved ? "No hay tareas resueltas." : <>No hay tareas pendientes. <Badge tone="green">Todo al día</Badge></>}</Empty>
      )}
    </>
  );
}
