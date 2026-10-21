<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Contexto del proyecto

Antes de trabajar en este repo leé, en este orden:

1. [`TRASPASO_CONFIGURACION.md`](TRASPASO_CONFIGURACION.md): estado real de Vercel, Neon, ElevenLabs y n8n (el bloqueo `jwk not found` ya está resuelto).
2. [`PLAN_WHATSAPP.md`](PLAN_WHATSAPP.md): WhatsApp por WAHA + Custom Channel de ElevenLabs. **Código hecho**; falta conectarlo con el chip y las variables del usuario y probarlo en vivo.
3. [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md): web pública copycat de assorthealth.com (**hecha**, con su key visual). Falta generar los audios de las demos y subir el video del hero.
4. [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md): demo instantánea `/probar-demo` (web del interesado → WhatsApp → llamada, audio o chat). **Código hecho**; se prueba en vivo cuando WAHA esté conectado.
5. [`CONTEXTO_PROYECTO.md`](CONTEXTO_PROYECTO.md): qué es Turnia Salud, decisiones, arquitectura y pendientes priorizados.
