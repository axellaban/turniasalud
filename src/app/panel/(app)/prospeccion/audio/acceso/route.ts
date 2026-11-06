import { randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/panel-clinic";
import { CHAPA_PROSPECTING_ORIGIN } from "@/lib/sales/chapa-voice";
import { createProspectingVoiceToken } from "@/lib/session";

export async function GET() {
  await requireAdmin();
  const nonce = randomBytes(16).toString("base64url");
  const result = { type: "turnia-prospecting-voice", token: createProspectingVoiceToken() };
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><title>Audios de Turnia</title>
      <p>Acceso autorizado. Ya podés volver al panel de Chapa Labs.</p>
      <script nonce="${nonce}">if (window.opener) { window.opener.postMessage(${JSON.stringify(result)}, ${JSON.stringify(CHAPA_PROSPECTING_ORIGIN)}); window.close(); }</script></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
