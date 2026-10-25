<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Contexto del proyecto

Antes de trabajar en este repo leé, en este orden:

0. [`PENDIENTES.md`](PENDIENTES.md): **todo lo que falta, por prioridad, y las reglas que no se rompen.** Empezá por acá.
1. [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md): cierre operativo más reciente, pruebas en producción y próximos pasos; prevalece sobre el registro histórico.
2. [`TRASPASO_CONFIGURACION.md`](TRASPASO_CONFIGURACION.md): estado real de Vercel, Neon, ElevenLabs y n8n (el bloqueo `jwk not found` ya está resuelto).
3. [`PLAN_WHATSAPP.md`](PLAN_WHATSAPP.md): WhatsApp por WAHA + Custom Channel de ElevenLabs. **Código hecho**; falta conectarlo con el chip y las variables del usuario y probarlo en vivo.
4. [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md): web pública copycat de assorthealth.com (**hecha**, con su key visual). Los siete audios ya están generados y el video del hero está publicado (clips de stock con licencia).
5. [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md): demo instantánea `/probar-demo` (web del interesado → WhatsApp → llamada, audio o chat). **Código hecho**; se prueba en vivo cuando WAHA esté conectado.
6. [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md): Panel → Campañas e importación de pacientes (versión 1 hecha), decisión sobre el CRM y lo que sigue.
7. [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md): cómo conseguir clientes (odontólogos de Mar del Plata y Miramar), Panel → Prospección y la demo personal de cada uno (`/p/<código>`).
8. [`CONTEXTO_PROYECTO.md`](CONTEXTO_PROYECTO.md): qué es Turnia Salud, decisiones, arquitectura y pendientes priorizados.
