<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regla: cada mejora de habita. se lleva a Turnia

Toda mejora en los paneles comerciales de habita. se lleva también a Turnia, en el mismo trabajo y sin que haga falta pedirlo. Así los dos paneles quedan siempre al día.

- **Qué cuenta como mejora de habita.:** lo que se haga en su panel del equipo (amoblaia: `/admin/prospeccion`, `/admin/inmobiliarias` y lo que se sume) o en su panel dentro de Chapa Labs (chapa-labs: `/prospecting/habita`). Vistas, embudos, filtros, acciones rápidas, métricas, textos y diseño.
- **Dónde se lleva:** a `/prospecting/turnia` en chapa-labs y, si es algo del panel de la app, también al panel de Turnia (turniasalud: `/panel/prospeccion`).
- **Cómo:** adaptado a Turnia, no copiado a ciegas. Usar sus etapas, su demo `/p/<código>`, sus datos y su embudo contra la meta, con las mismas definiciones que ya usa Turnia, para que los números de una vista y otra coincidan.
- **Si no aplica a Turnia:** decirlo en el PR y por qué.
- **Si no entra en el mismo PR** (otro repositorio, falta acceso): abrir el PR de Turnia a continuación. Si no se puede, dejarlo anotado en `PENDIENTES.md` de turniasalud y avisarlo al terminar.
- En chapa-labs la lógica compartida está en `prospecting/agencies.js` (`HABITA` y `TURNIA`) y la configuración de cada unidad en `prospecting/units.js`.

Desde este repositorio: antes de trabajar en la prospección, revisá si hay mejoras de habita. sin traer (en `PENDIENTES.md` o en los PRs recientes de amoblaia y chapa-labs).

## Regla: las pruebas de Sofi nunca usan la API con clave

**Estrictamente prohibido** (Axel, 28/11/2026). Las pruebas salieron caras con la API y son simulaciones.

- **Qué no se hace:** usar la API de Anthropic, la de OpenAI u otra con clave (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) para probar, simular, evaluar o mejorar a Sofi. Vale para el Laboratorio de Sofi, `probar-sofi`, el QA y cualquier script nuevo.
- **Qué se paga:** solo ElevenLabs (las simulaciones) y la suscripción de Claude Code o ChatGPT (evaluar, revisar charlas y proponer mejoras).
- **Cómo se corre:** con el skill [`laboratorio-sofi`](.claude/skills/laboratorio-sofi/SKILL.md). En Codex o ChatGPT, leé ese archivo y seguilo igual.
- **El candado:** `labApiAllowed` en `src/lib/lab/policy.ts` es `false` fijo y `src/test/laboratorio-sin-api.integration.test.ts` falla si alguien lo afloja. No lo cambies, ni para «probar rápido», sin una decisión escrita de Axel en `PENDIENTES.md`.
- **Qué no cambia:** Sofi atendiendo pacientes reales y las funciones de producción que ya usan la API (por ejemplo, leer documentos o armar la ficha de una demo). La regla es para las pruebas.

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
8. [`ANALITICA.md`](ANALITICA.md): PostHog (eventos del navegador y del servidor, embudos, tableros). Si sumás un botón, un paso o un evento, actualizá el catálogo.
9. [`EMBUDO.md`](EMBUDO.md): **el embudo comercial que se sigue cada semana** (de los saludos a los clientes pagos), con sus definiciones, el criterio de cuenta activa y la tabla. Se actualiza con `npm run embudo`.
10. [`PLAN_PROTOCOLOS.md`](PLAN_PROTOCOLOS.md): qué es común a todos los consultorios odontológicos y qué configura cada uno (prompt base, módulo odontológico, reglas en el panel), comparado con Assort Health. **Implementado el 4/11** (ver «Estado»); el módulo odontológico va prendido en todos los consultorios odontológicos.
11. [`CONTEXTO_PROYECTO.md`](CONTEXTO_PROYECTO.md): qué es Turnia Salud, decisiones, arquitectura y pendientes priorizados.
12. [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md): **la operación comercial desde Chapa Labs** (la cola de Follow-up traída de habita., su API, sus tablas), el estado de la prospección (listas, anunciantes) y qué sigue. El documento general de los tres repos está en chapa-labs, `docs/CENTRO_COMERCIAL.md`.
13. [`QA_TURNIA.md`](QA_TURNIA.md): **el QA de producción** (igual que el de habita.): observaciones abiertas, propuestas de usabilidad y el registro de cada corrida. El procedimiento está en `.claude/skills/qa-turnia/SKILL.md`.
14. [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md): **configuración que hace una IA con computer use** en Vercel, ElevenLabs, Google Cloud, PostHog y claude.ai, por prioridad y lista para copiar como prompt.
15. [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md): **Smile Connect por API y avisos al consultorio por WhatsApp** (qué ofrece la API, modos, red de seguridad de la escritura y pasos para activarlo). En producción y apagada por defecto; lo que la API no acepta (motivo y prestación) lo cubre el resumen diario de Sofi.
16. [`PLAN_LABORATORIO_SOFI.md`](PLAN_LABORATORIO_SOFI.md): **el Laboratorio de Sofi** (Panel → Turnia): simulaciones nocturnas en ElevenLabs, puntaje de 1 a 100, revisión de las charlas reales, propuestas de mejora con experimento y publicación con un clic. Evaluar y proponer lo hace la suscripción con el skill `laboratorio-sofi`, **nunca la API** (ver la regla de arriba). Si cambiás el prompt, una herramienta o los casos de `probar-sofi`, mirá ahí cómo se mide.
