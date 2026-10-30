import "server-only";
import { sql } from "./db";

/**
 * Las fotos de un paciente: las que quedaron atadas a su ficha y las que mandó desde
 * su número (o desde otro número suyo) antes de tener ficha. Para usar dentro de un where sobre `d`.
 */
export function patientDocumentsFilter(clinicId: string, patientId: string) {
  return sql`d.clinic_id = ${clinicId} and (
    d.patient_id = ${patientId}
    or d.phone = (select phone from patients where id = ${patientId})
    or d.phone in (select phone from patient_phones where clinic_id = ${clinicId} and patient_id = ${patientId}))`;
}

export type PatientDocument = { id: string; kind: string; summary: string | null; mimetype: string; channel: string; created_at: string };

export async function patientDocuments(clinicId: string, patientId: string): Promise<PatientDocument[]> {
  return sql<PatientDocument[]>`
    select d.id, d.kind, d.summary, d.mimetype, d.channel, d.created_at from patient_documents d
    where ${patientDocumentsFilter(clinicId, patientId)}
    order by d.created_at desc limit 20`;
}
