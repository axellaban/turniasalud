import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { patientDocumentsFilter } from "@/lib/documents-panel";

export const dynamic = "force-dynamic";

/** Una foto o PDF que mandó el paciente, para verlo desde su ficha. Solo con sesión del panel y de la misma clínica. */
export async function GET(_request: Request, { params }: RouteContext<"/panel/pacientes/[id]/documentos/[doc]">) {
  const { id, doc } = await params;
  const clinic = await getPanelClinic();
  if (!isUuid(id) || !isUuid(doc)) return new Response(null, { status: 404 });
  const [row] = await sql<Array<{ mimetype: string; file: Buffer }>>`
    select d.mimetype, d.file from patient_documents d
    join patients p on p.id = ${id} and p.clinic_id = ${clinic.id}
    where d.id = ${doc} and ${patientDocumentsFilter(clinic.id, id)}`;
  if (!row) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.file), {
    headers: {
      "Content-Type": row.mimetype,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
