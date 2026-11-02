import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getClinic, isUuid } from "@/lib/clinic";
import { activeClinicAccess } from "@/lib/clinic-access";
import { sql } from "@/lib/db";
import { CLINIC_COOKIE } from "@/lib/panel-clinic";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { findClinicBySmileConnectToken, syncSmileConnect } from "@/lib/smile-connect";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://app.smileconnect.pro",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

function bearerToken(request: Request, body: Record<string, unknown>): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (match?.[1]) return match[1].trim();
  if (typeof body.secret === "string" && body.secret.trim()) return body.secret.trim();
  return null;
}

async function resolveSessionClinic(requestedClinicId: string | null): Promise<{ clinicId: string; actor: string } | null> {
  const store = await cookies();
  const claims = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  if (claims.role === "clinic") {
    const access = await activeClinicAccess(claims.accessId);
    if (!access) return null;
    if (requestedClinicId && requestedClinicId !== access.clinic_id) {
      throw new Error("La clínica seleccionada cambió. Recargá la pantalla.");
    }
    return { clinicId: access.clinic_id, actor: access.label || "El consultorio" };
  }

  const cookieId = store.get(CLINIC_COOKIE)?.value;
  let targetId = isUuid(requestedClinicId) ? requestedClinicId : isUuid(cookieId) ? cookieId : null;
  if (targetId) {
    const [exists] = await sql<Array<{ id: string }>>`select id from clinics where id = ${targetId}`;
    if (!exists) targetId = null;
  }
  const clinicId = targetId ?? (await getClinic()).id;
  return { clinicId, actor: "Turnia" };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object") {
      return withCors(NextResponse.json({ ok: false, error: "Cuerpo JSON inválido." }, { status: 400 }));
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return withCors(NextResponse.json({ ok: false, error: "No se pudo leer el JSON enviado." }, { status: 400 }));
  }

  try {
    const token = bearerToken(request, body);
    let clinicId: string | null = null;
    let mode: "live" | "import" = "live";
    let actor = "Smile Connect";

    if (token) {
      clinicId = await findClinicBySmileConnectToken(token);
      if (!clinicId) {
        return withCors(NextResponse.json({ ok: false, error: "Clave secreta inválida o vencida." }, { status: 401 }));
      }
    } else {
      const requested = typeof body.clinic_id === "string" ? body.clinic_id : null;
      const sessionAuth = await resolveSessionClinic(requested);
      if (!sessionAuth) {
        return withCors(NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 }));
      }
      clinicId = sessionAuth.clinicId;
      actor = sessionAuth.actor;
      mode = "import";
    }

    const payload = body.payload ?? body;
    const recordImport = mode === "import" ? Boolean(body.recordImport) : false;
    const { summary } = await syncSmileConnect(clinicId, payload, { mode, actor, recordImport });

    revalidatePath("/panel/agenda");
    revalidatePath("/panel/pacientes");
    revalidatePath("/panel/campanas");
    revalidatePath("/panel/configuracion/calendario");

    return withCors(NextResponse.json({ ok: true, summary }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al sincronizar con Smile Connect.";
    return withCors(NextResponse.json({ ok: false, error: message }, { status: 400 }));
  }
}
