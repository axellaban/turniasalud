import { NextResponse } from "next/server";
import { labTokenAuthorized } from "@/lib/lab/access";
import { applyExternal, pendingWork } from "@/lib/lab/external";

// La parte del Laboratorio de Sofi que hace la suscripción de Claude Code o ChatGPT (regla de
// src/lib/lab/policy.ts: el servidor no usa la API de un modelo). Clave con permiso «evaluar» (header
// x-lab-token), creada en Panel → Laboratorio → Criterios.
//   GET  /api/lab/evaluaciones → lo pendiente (charlas simuladas, charlas reales, propuestas) con la rúbrica
//   POST /api/lab/evaluaciones → las evaluaciones y propuestas, en el formato que da el GET
// El procedimiento está en .claude/skills/laboratorio-sofi/SKILL.md.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const unauthorized = () => NextResponse.json({ ok: false, error: "No autorizado: hace falta una clave con permiso para evaluar." }, { status: 401 });

export async function GET(request: Request) {
  if (!(await labTokenAuthorized(request, "evaluar"))) return unauthorized();
  return NextResponse.json(await pendingWork());
}

export async function POST(request: Request) {
  if (!(await labTokenAuthorized(request, "evaluar"))) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "El cuerpo no es JSON." }, { status: 400 });
  }
  const result = await applyExternal(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
