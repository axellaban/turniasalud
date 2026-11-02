import { NextResponse } from "next/server";
import { POST as receiveMessage } from "../route";
import { wahaConnectionById, withWahaConnection } from "@/lib/waha-connections";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ connection: string }> }) {
  const { connection: id } = await context.params;
  const connection = wahaConnectionById(id);
  if (!connection) return NextResponse.json({ error: "Conexión no disponible" }, { status: 404 });
  return withWahaConnection(connection, () => receiveMessage(request));
}
