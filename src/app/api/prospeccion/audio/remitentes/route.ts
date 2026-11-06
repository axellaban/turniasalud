import { cookies } from "next/headers";
import { z } from "zod";
import { OutreachError } from "@/lib/sales/outreach";
import { importVoiceSenders } from "@/lib/sales/voice-outreach";
import { isAdminSessionToken, sameOrigin, SESSION_COOKIE } from "@/lib/session";

const input = z.object({
  sender: z.string().regex(/^\d{4}$/),
  contacts: z.array(z.object({
    code: z.string().trim().min(1).max(90),
    phone: z.string().trim().min(10).max(30),
  })).min(1).max(500),
});

export async function POST(request: Request) {
  if (!sameOrigin(request) || !isAdminSessionToken((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Se requiere una sesión administradora de Turnia." }, { status: 401 });
  }
  const result = input.safeParse(await request.json().catch(() => null));
  if (!result.success) return Response.json({ error: "Revisá el emisor y los contactos." }, { status: 400 });
  try {
    return Response.json(await importVoiceSenders(result.data.sender, result.data.contacts));
  } catch (error) {
    if (error instanceof OutreachError) return Response.json({ error: error.message }, { status: 422 });
    console.error("chapa_prospecting_voice_senders", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudieron guardar los remitentes." }, { status: 500 });
  }
}
