import "server-only";
import { sql } from "./db";
import { normalizePhone } from "./phone";

/** ¿Escribe un tester (Configuración → Turnos y urgencias → Modo prueba)? Lo que pide no le llega al equipo. */
export async function isTesterPhone(clinicId: string, phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(normalized)) return false;
  const [row] = await sql<{ test_phones: string[] | null }[]>`select test_phones from clinics where id = ${clinicId}`;
  return (row?.test_phones ?? []).some((p) => normalizePhone(p) === normalized);
}
