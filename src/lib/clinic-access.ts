import "server-only";
import { createHash, randomInt } from "node:crypto";
import { sql } from "./db";

// Códigos de acceso de un consultorio: 16 caracteres sin letras ambiguas
// (~79 bits), así que alcanza con guardar un SHA-256 y buscarlo por índice.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 16;

export type ClinicAccess = {
  id: string;
  clinic_id: string;
  label: string | null;
  code_hint: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function normalizeAccessCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const hashCode = (code: string) => createHash("sha256").update(`turnia-access:${code}`).digest("hex");

/** Crea un acceso y devuelve el código completo: es la única vez que se puede ver. */
export async function createClinicAccess(clinicId: string, label: string | null): Promise<{ access: ClinicAccess; code: string }> {
  const raw = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const [access] = await sql<ClinicAccess[]>`
    insert into clinic_access (clinic_id, label, code_hash, code_hint)
    values (${clinicId}, ${label}, ${hashCode(raw)}, ${raw.slice(-4)})
    returning id, clinic_id, label, code_hint, created_at, last_used_at, revoked_at`;
  return { access, code: raw.match(/.{4}/g)!.join("-") };
}

/** Acceso vigente para ese código, o null. Registra el último ingreso. */
export async function findClinicAccessByCode(input: string): Promise<ClinicAccess | null> {
  const code = normalizeAccessCode(input);
  if (code.length !== LENGTH) return null;
  const [access] = await sql<ClinicAccess[]>`
    update clinic_access set last_used_at = now()
    where code_hash = ${hashCode(code)} and revoked_at is null
    returning id, clinic_id, label, code_hint, created_at, last_used_at, revoked_at`;
  return access ?? null;
}

export async function activeClinicAccess(id: string): Promise<ClinicAccess | null> {
  const [access] = await sql<ClinicAccess[]>`
    select id, clinic_id, label, code_hint, created_at, last_used_at, revoked_at
    from clinic_access where id = ${id} and revoked_at is null`;
  return access ?? null;
}

export async function listClinicAccess(clinicId: string): Promise<ClinicAccess[]> {
  return sql<ClinicAccess[]>`
    select id, clinic_id, label, code_hint, created_at, last_used_at, revoked_at
    from clinic_access where clinic_id = ${clinicId} order by revoked_at nulls first, created_at desc`;
}

export async function revokeClinicAccess(clinicId: string, id: string): Promise<void> {
  await sql`update clinic_access set revoked_at = now() where id = ${id} and clinic_id = ${clinicId} and revoked_at is null`;
}
