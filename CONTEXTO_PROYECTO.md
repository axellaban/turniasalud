# Turnia Salud — contexto del proyecto y pendientes

> Documento de traspaso para la próxima persona o IA que siga el proyecto.
> Última actualización: 21/10/2026. Repo: https://github.com/axellaban/turniasalud (rama `main`).

> **Actualización operativa:** leer primero [`TRASPASO_CONFIGURACION.md`](TRASPASO_CONFIGURACION.md). Ya se crearon Vercel, Neon Free, el agente privado de ElevenLabs, su webhook HMAC y los workflows de n8n. El bloqueo `jwk not found` de Neon Data API se resolvió pasando a **conexión directa con `DATABASE_URL`**: está en `main`, desplegado, con `schema.sql` aplicado en Neon, `/api/health` en `database: "ok"`, el agente actualizado con 9 herramientas y una reserva de prueba hecha desde la demo. Todavía no está listo para pacientes reales: faltan WhatsApp, la prueba por voz y la revisión legal.

---

## 1. Qué es y para quién

**Turnia Salud** es un MVP "copycat" de [Assort Health](https://www.assorthealth.com), adaptado a **Argentina / LATAM**. Son agentes de IA que atienden la comunicación con pacientes de clínicas y consultorios:

- **WhatsApp primero.** En LATAM casi nadie atiende el teléfono fijo, y la gente manda audios. El teléfono es un canal secundario.
- Dan turnos sobre la agenda real, confirman, cancelan, reprograman, hacen la admisión (DNI, obra social/prepaga, plan, afiliado), contestan preguntas frecuentes y hacen triage (urgencia → 107 / guardia + tarea urgente).
- **Outbound / recall:** le escriben a los pacientes para llenar la agenda (controles vencidos, recordatorios, ausentes, reactivación, lista de espera).

**Sobre el dueño del proyecto:**
- Es **no-code**: todo lo operativo tiene que poder hacerse desde paneles (SQL Editor de Neon, Vercel, ElevenLabs, n8n, panel de la app).
- Ya tiene **n8n** y **Supabase** (proyecto propio), pero el cupo gratis de Supabase no dejó crear otro proyecto: Turnia usa **Neon Free** desde Vercel.
- Deploya él mismo en **Vercel**, importando el repo de GitHub.
- Quiere **lo más parecido posible al core de Assort**.
- Autor de los commits: `a13ilaboratory <a13i.laboratory@gmail.com>`. El repo vive en la cuenta `axellaban`.

**Idioma:** toda la UI, los textos y el prompt están en **español rioplatense con voseo**. Mantenerlo así.

---

## 2. Decisiones tomadas (no re-discutir sin motivo)

| Decisión | Motivo |
|---|---|
| **Solo ElevenLabs Agents, sin Retell** | Retell orquesta terceros. Usar voces de ElevenLabs desde Retell cuesta ~+US$0,04/min y no trae ventajas. ElevenLabs tiene WhatsApp nativo (texto, audios, llamadas), Twilio/SIP, herramientas webhook, webhooks de inicio y post-conversación, y BAA/HIPAA con Zero Retention. |
| **Híbrido código + n8n** | La lógica delicada vive en la API de Next.js y en Postgres: disponibilidad, reservas, constraint anti-superposición. n8n queda para lo que el dueño va a querer tocar: horarios de campañas y avisos al equipo. Tools en n8n agregarían latencia y fragilidad. |
| **Nombre: Turnia Salud** | Elegido por el usuario. El nombre por defecto del agente es "Sofi". |
| **Multi-especialidad** | Assort es multi-especialidad. La demo es un centro multiespecialidad ficticio en Palermo (CABA). El usuario dijo "especialidad argentina" y no quedó claro si se refería a una especialidad concreta. **Preguntar si quiere enfocar una especialidad** (sugerencia previa: odontología, por lo natural que es el recall). |
| **Web copycat de Assort con marca propia** | Se replicaron estructura, páginas, interacciones y el key visual (paleta azul cobalto/navy/aqua y Geist, pedido del usuario), con nombre, logo, textos, fotos y guiones propios. No se copian videos, logos, testimonios, métricas ni sellos de Assort. Ver `PLAN_WEB_ASSORT.md`. |
| **Una clínica por deploy (por ahora)** | El esquema ya es multi-clínica (`clinic_id` en todo). La app usa `DEFAULT_CLINIC_ID` o la primera clínica. |
| **Panel con contraseña única** | `PANEL_PASSWORD` + cookie firmada con HMAC. Es simple para el MVP. |
| **Cache Components desactivado** | `next.config.ts` → `cacheComponents: false`. La app es casi toda datos en vivo; las páginas del panel usan `dynamic = "force-dynamic"`. |
| **Postgres directo (`DATABASE_URL`), sin Data API ni supabase-js** | Neon Data API fallaba de forma intermitente con `jwk not found` al leer JWKS en `*.vercel.app`. Con `postgres.js` y SQL parametrizado funciona igual con Neon, Supabase o un Postgres local, y permite transacciones y tests reales. |
| **Lock por profesional al reservar** | Con la constraint de exclusión sola, dos reservas simultáneas podían terminar en `deadlock detected`. `pg_advisory_xact_lock` por profesional (en orden fijo, antes de tocar filas) hace que la segunda reciba "se acaba de ocupar". |

### Mapeo con los productos de Assort
| Assort | Turnia | Implementación |
|---|---|---|
| Concierge (inbound) | **Recepción** | Agente en ElevenLabs + `src/app/api/agent/tools/[name]` |
| Activate (outbound) | **Activa** | `src/lib/campaigns.ts`, panel → Campañas, `n8n/turnia-campanas-automaticas.json`, `offerFreedSlot` en `service.ts` |
| Orchestrate | **Circuitos** | `registrar_paciente` (también desde foto de la credencial), órdenes médicas por WhatsApp → turno o tarea `orden_medica`, indicaciones previas. Faltan formularios digitales previos a la visita. |
| Empower | **Equipo** | Panel: tareas con respuesta al paciente por WhatsApp, conversaciones con transcripción, resumen y encuesta, métricas, memoria del paciente |
| Patient Journey Memory | Memoria del paciente | `patients.memory_summary` + webhook de inicio (`patient_context`) + `data_collection.memoria` post-llamada |
| Synapse (auto-config) | — | No implementado |

---

## 3. Arquitectura

```
Paciente (WhatsApp / teléfono / web)
        │
        ▼
ElevenLabs Agent ──(1) webhook de inicio──► POST /api/elevenlabs/initiation   (header x-turnia-secret)
        │                                    → devuelve dynamic_variables: clínica, catálogo con IDs, memoria del paciente
        │        ──(2) herramientas───────► POST /api/agent/tools/:nombre      (header x-turnia-secret)
        │                                    → Postgres (turnos, pacientes, tareas, lista de espera, bloqueos)
        │        ──(3) post-conversación──► POST /api/elevenlabs/post-call     (firma HMAC ElevenLabs-Signature)
        │                                    → guarda conversación, resumen, intent/outcome, memoria; actualiza campañas
        ▼
Panel /panel (Next.js, server components + server actions)
n8n ◄── eventos (N8N_WEBHOOK_URL): turno.reservado/confirmado/cancelado/reprogramado, tarea.creada/resuelta, conversacion.finalizada
n8n ──► POST /api/automations/:job  (recordatorios | recall | reactivacion | ausentes | lista-espera | encuestas)
Demo web /demo ──► POST /api/elevenlabs/token → conversation token (voz, WebRTC) o signed URL (chat, WebSocket) + dynamic variables
```

**Stack:**
- Next.js **16.4** (App Router, React 19.3, Tailwind v4 con loader de turbopack)
- `postgres` (postgres.js) 3.4: conexión directa con `DATABASE_URL`, solo server
- `@elevenlabs/react` 1.19 (demo)
- `zod` 4
- `vitest` 5

### Cosas de Next 16 a tener en cuenta
- El middleware ahora se llama **`src/proxy.ts`** (export `proxy`) y corre en Node.js. Protege `/panel/*` salvo `/panel/login`.
- `params` y `searchParams` son Promises. Los tipos `PageProps<"/ruta">` y `LayoutProps<"/ruta">` se generan con `npx next typegen` (o `next build` / `next dev`).
- Leer `node_modules/next/dist/docs/` antes de usar APIs nuevas (ver `AGENTS.md`).

---

## 4. Mapa de archivos

```
supabase/schema.sql        Tablas + extensiones + constraint anti-superposición + RLS sin políticas (idempotente; al final actualiza bases viejas)
supabase/seed.sql          Clínica demo id 00000000-0000-4000-8000-000000000001, 4 profesionales, 8 tipos de turno con precio, horarios, 4 pacientes
src/lib/env.ts             Variables de entorno (required/optional), isConfigured()
src/lib/db.ts              Cliente postgres.js perezoso (tag `sql`), fechas ISO, json(), pgErrorCode(), closeDb()
src/lib/time.ts            Zona horaria (zonedTimeToUtc, humanSlot "martes 28/10 a las 10:30"), sin depender del TZ del server
src/lib/slots.ts           Cálculo PURO de turnos libres, isSlotFree, expandBlocks (feriados) e isOpenAt (horario) (testeado)
src/lib/phone.ts           Normaliza a ID de WhatsApp AR: 549 + área sin 0 + número sin 15 (testeado)
src/lib/clinic.ts          getClinic/resolveClinic, catálogo, bloqueos, textos para el prompt, buildDynamicVariables()
src/lib/agent/tools.ts     Definición ÚNICA de las 9 tools (zod + params para ElevenLabs) y CONTEXT_PARAMS (dynamic vars)
src/lib/agent/service.ts   Lógica de cada tool (reservar con lock por profesional, confirmar, cancelar → ofrece hueco a lista de espera, reprogramar en transacción, etc.)
src/lib/agent/prompt.ts    System prompt y first message (rioplatense)
src/lib/agent/setup.ts     Crea/actualiza tools + agente vía API de ElevenLabs (botón en panel → Configuración); transfer_to_number si hay handoff_phone
src/lib/agent/auth.ts      Verificación del header x-turnia-secret
src/lib/elevenlabs.ts      fetch a la API REST, token/signed URL, envío de templates de WhatsApp, verificación HMAC
src/lib/conversations.ts   Procesa el webhook post-conversación (guardar, memoria, campañas, n8n)
src/lib/campaigns.ts       Audiencias (recall, reactivación, recordatorio, ausentes, lista de espera, encuesta, personalizada; respeta contact_opt_out) y envío
src/lib/tasks.ts           resolveTask(): resuelve un pedido y le manda la respuesta al paciente (template "respuesta")
src/lib/n8n.ts             notifyN8n() (nunca rompe el flujo principal)
src/lib/session.ts         Cookie de sesión del panel (HMAC)
src/proxy.ts               Protección de /panel
src/app/page.tsx           Landing
src/app/privacidad/        Política de privacidad pública con los datos de la clínica (borrador para revisar con un abogado)
src/app/demo/              Demo chat/voz con @elevenlabs/react
src/app/panel/actions.ts   Todas las server actions (todas llaman requireSession())
src/app/panel/(app)/       Inicio, agenda, conversaciones, tareas, pacientes, campañas, configuración
src/app/api/               agent/tools/[name], elevenlabs/{initiation,post-call,token}, automations/[job], health (consulta la base)
src/test/                  db.integration.test.ts (Postgres descartable vía TEST_DATABASE_URL) + db-setup.ts
.github/workflows/ci.yml   typecheck, lint, tests con Postgres 16 y build
n8n/                       2 workflows importables (campañas programadas, eventos → avisos)
```

### Tools del agente (`/api/agent/tools/:nombre`)
1. `registrar_paciente`
2. `consultar_disponibilidad`
3. `reservar_turno`
4. `ver_turnos_paciente`
5. `confirmar_turno` (asistencia confirmada → `appointments.confirmed_at`)
6. `cancelar_turno`
7. `reprogramar_turno`
8. `crear_tarea`
9. `anotar_lista_espera`

Además, si la clínica tiene `handoff_phone`, el agente suma la herramienta de sistema `transfer_to_number` (solo llamadas).

Cada una recibe además, vía variables dinámicas de ElevenLabs:
- `clinic_id` ← `{{clinic_id}}`
- `patient_phone` ← `{{patient_phone}}`
- `conversation_id` ← `{{system__conversation_id}}`
- `canal` ← `{{system__channel}}`

Las respuestas son JSON en español, pensado para el LLM. Los errores de negocio vuelven con `ok:false` y HTTP 200, para que el agente los explique.

### Variables dinámicas obligatorias (todas las devuelve `buildDynamicVariables`)
- `clinic_id`, `clinic_name`, `agent_name`, `clinic_info`, `clinic_catalog`
- `urgency_instructions`
- `patient_phone`, `patient_name`, `patient_context`
- `conversation_context`, `campaign_id`

**Si agregás una variable al prompt, tiene que salir de `buildDynamicVariables`**: ElevenLabs falla la conversación si falta alguna. Esto aplica a inbound (webhook), outbound (templates) y demo web.

### Modelo de datos (resumen)
- **Configuración:** `clinics` (incluye `templates` jsonb con nombres de templates de Meta —claves recordatorio, recall, lista_espera, reactivacion, no_show, encuesta, respuesta, idioma—, `whatsapp_phone_number_id`, `elevenlabs_agent_id`, `handoff_phone`, `after_hours_instructions`), `professionals`, `appointment_types` (`recall_months`, `price`), `schedules` (weekday 0=domingo), `schedule_blocks` (feriados/vacaciones; sin profesional = toda la clínica).
- **Pacientes:** `patients` (único por `clinic_id` + `phone`; `memory_summary`; `contact_opt_out` = pidió la baja de campañas).
- **Turnos:** `appointments` (`reminder_sent_at`, `confirmed_at`, `survey_sent_at`). Estados: `confirmado | pendiente | cancelado | ausente | atendido | reprogramado`. La constraint `appointments_no_overlap` (exclusión GiST) bloquea superposición por profesional entre los estados activos.
- **Operación:** `conversations` (`satisfaction` 0-10), `tasks` (tipos incluyen `orden_medica`; `response`, `responded_at`), `waitlist`, `campaigns` (tipo `encuesta`), `campaign_recipients`.

---

## 5. Estado actual

### Hecho y verificado (21/10/2026, contra Postgres 16 local)
- `npm test` con `TEST_DATABASE_URL`: 56 tests OK (sin esa variable corren 36 y se omiten los 20 de integración). Unitarios (turnos, feriados, horario de atención, zonas horarias, teléfonos, firma HMAC, sesión, canales, memoria, token de la demo) y de integración contra una base real descartable: schema + seed aplicados dos veces, todas las herramientas, reservas simultáneas (4 a la vez y reprogramar mientras otro toma el horario: 30 corridas sin fallas), campañas y envíos (WhatsApp simulado), webhook post-conversación firmado e idempotente, server actions y render de todas las páginas del panel.
- `npx tsc --noEmit`, `npx eslint src` y `npm run build`: sin errores.
- `schema.sql` actualiza una base creada con la versión anterior sin perder datos.
- En producción (21/10/2026, después del merge del PR #1): `/api/health` responde `database: "ok"`; el panel carga; "Crear / actualizar agente" sube las 9 herramientas; una reserva desde la demo en modo chat aparece en la Agenda y se cancela bien. El agente, el webhook HMAC y los workflows de n8n ya existían de la sesión anterior.

### Hecho pero NO probado contra servicios reales
El entorno de la última sesión no tenía credenciales. Falta confirmar en producción:
- `transfer_to_number` (solo se sube si hay `handoff_phone`; todavía no se cargó) y que el dato `satisfaccion` (tipo `integer`) llegue bien en el post-call.
- **Webhook de inicio:** la forma exacta de la respuesta (`{type, dynamic_variables, user_id}`).
- **Post-call:** cómo viene el canal (`metadata.whatsapp`, `metadata.phone_call`, `system__channel`).
- **Envío de templates:** `/v1/convai/whatsapp/outbound-message` con parámetros posicionales `{{1}}`, `{{2}}`.
- **Demo web** en modo chat y voz; lectura de fotos y PDF por WhatsApp (credencial, órdenes).

---

## 6. Pendientes (ordenados por prioridad)

### P1 — Para que funcione en producción
1. ~~Desplegar la conexión directa~~: hecho (PR #1). Falta la prueba por voz y revisar que las conversaciones de la demo lleguen al panel por el webhook post-call.
2. ~~Post-call webhook~~: creado en la sesión anterior; verificar que llegan las conversaciones al panel.
3. **WhatsApp:** el usuario eligió **WAHA** (chip nuevo en su VPS) conectado al mismo agente con el **Custom Channel** de ElevenLabs. **El código está hecho y probado con WAHA y ElevenLabs simulados** (`src/lib/whatsapp.ts`, `channel.ts`, `waha.ts`, `/api/waha/webhook`, `/api/elevenlabs/canal`). Falta: volver a correr `schema.sql` en Neon, crear el Custom Channel, cargar las variables `WAHA_*` y `ELEVENLABS_CHANNEL_*` en Vercel, elegir WAHA en Configuración, configurar el webhook de la sesión de WAHA y probar con el chip. Pasos en el README (4a) y verificaciones pendientes en [`PLAN_WHATSAPP.md`](PLAN_WHATSAPP.md). La vía oficial (Meta) sigue disponible con el mismo código.
4. **Templates** (solo con la opción oficial de Meta; con WAHA se manda el mismo texto como mensaje común): (`recordatorio_turno`, `recall_control`, `turno_liberado`, `turno_perdido`, `reactivacion_paciente`, `encuesta_visita`, `respuesta_pedido`), con `{{1}}` = nombre y `{{2}}` = detalle e idioma `es_AR`. Textos en el README. Confirmar el código de idioma de "Español (ARG)".
5. ~~Proteger `/demo` y `/api/elevenlabs/token`~~: hecho, piden sesión del panel.
6. ~~Validar los workflows de n8n~~: actualizados por API en la instancia real y probados con eventos sintéticos. Las campañas siguen sin activar hasta que haya WhatsApp.

### P2 — Paridad con el core de Assort
7. **Derivación a humano:** hecho en parte. Por teléfono, `transfer_to_number` con `handoff_phone`. En WhatsApp, tarea `derivacion_humana` + evento `tarea.creada` con `panel_url` y `fuera_de_horario`; falta armar el aviso real en n8n cuando el usuario diga a quién.
8. ~~Fuera de horario~~: hecho. El agente sabe si la clínica está atendiendo (según agenda y feriados) y recibe `after_hours_instructions`. Falta, si se quiere, una guardia rotativa por profesional.
9. ~~Recetas con respuesta al paciente~~: hecho. El equipo resuelve la tarea con una respuesta que llega por WhatsApp (template `respuesta`) y el agente ve el estado de los pedidos.
10. **Derivaciones (referrals):** hecho por prompt (orden por WhatsApp → turno o tarea `orden_medica`). Falta guardar el archivo y el contacto proactivo para agendar órdenes pendientes.
11. **Foto de credencial:** hecho por prompt (el agente lee y guarda con `registrar_paciente`). Sin probar con ElevenLabs.
12. **Verificación de cobertura/elegibilidad:** hoy solo se comparan nombres con la lista de la clínica y del profesional.
13. **Formularios de admisión previos a la visita.** La encuesta post-visita con puntaje 0-10 ya está (campaña `encuesta`).
14. **Cobranzas (payment resolution):** recordatorio de saldos y link de pago (por ejemplo, Mercado Pago). Necesita un modelo de saldos y credenciales.
15. **Métricas:** hecho lo básico (contención, turnos por IA, recuperados, satisfacción, confirmación, ausentismo, ingresos recuperados con precio de referencia). Faltan series históricas y métricas por campaña en detalle.
16. **Reglas de agenda avanzadas:** feriados y bloqueos hechos (`schedule_blocks`). Faltan sobreturnos, intervalos distintos de la duración, turnos dobles y límite por obra social.
17. ~~`confirmar_turno`~~: hecho.
18. **Llamadas salientes por WhatsApp** (batch calling con permiso de llamada) para pacientes que no responden texto.

### P3 — Producto / plataforma
19. **Multi-clínica real:** usuarios por clínica, roles (recepción / admin), selector de clínica, onboarding desde la UI, un agente por clínica (ya soportado vía `resolveClinic`).
20. **Integraciones con sistemas de gestión locales** (agenda / HCE existente): investigar APIs de AgendaPro, Medilink, Doctoralia, etc. Hoy Turnia es la agenda.
21. **Sincronizar con Google Calendar** (vía n8n con los eventos `turno.*`).
22. **Cumplimiento:** hecho en parte (borrador de `/privacidad` con la leyenda de la AAIP, baja de mensajes). Falta revisión de un abogado (Ley 25.326, Ley 26.529, Ley 27.706, consentimiento), términos y activar Zero Retention Mode en ElevenLabs.
23. **Observabilidad:** hecho en parte (log JSON por herramienta, `/api/health` consulta la base). Faltan alertas (ElevenLabs y Vercel las ofrecen).
24. ~~Tests de integración con base real y CI~~: hecho.
25. **Expansión LATAM:** el código ya usa zonas horarias IANA. Para México, el ID de WhatsApp es 521…, y `phone.ts` hoy solo normaliza Argentina.
26. **Web pública:** hecha como copycat de Assort (ver `PLAN_WEB_ASSORT.md`), con formulario de demo (`leads`). Faltan los audios generados, el video del hero, casos reales y precios. No inventar testimonios ni métricas.

### Ideas de diferenciación (charladas con el usuario)
- El **recall** como propuesta de valor principal ("te traemos pacientes que ya tenías"), con cobro por resultado: turnos recuperados.
- **Audios en WhatsApp** con voz argentina: el agente responde con nota de voz si el paciente mandó audio; ElevenLabs lo hace por defecto.
- Competencia local a mirar: Órbita (La Plata), XIAgenda y AgendaPro.

---

## 7. Variables de entorno

Ver `.env.example`.

**Obligatorias:**
- `DATABASE_URL` (en Vercel la carga la integración de Neon; también acepta `POSTGRES_URL`)
- `ELEVENLABS_API_KEY`
- `AGENT_TOOLS_SECRET`
- `PANEL_PASSWORD`
- `ELEVENLABS_WEBHOOK_SECRET` (para el post-call)

**Opcionales:**
- `APP_URL` (si no, usa `VERCEL_PROJECT_PRODUCTION_URL`)
- `N8N_WEBHOOK_URL`
- `AGENT_LLM`
- `ELEVENLABS_VOICE_ID`
- `DEFAULT_CLINIC_ID`
- `SESSION_SECRET`

`NEON_DATA_API_URL` y `NEON_SERVER_PRIVATE_KEY` ya no se usan.

---

## 8. Comandos

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # vitest (unitarios; integración si hay TEST_DATABASE_URL)
npm run typecheck    # tsc --noEmit (antes: npx next typegen si faltan los tipos de rutas)
npx eslint src
npm run build

# Integración contra un Postgres descartable (lo borra y carga schema + seed):
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnia_test npm test
```

**Notas del entorno de desarrollo en la nube (Claude Code):**
- La red sale por un proxy con allowlist. Para leer la documentación de ElevenLabs sirve `curl https://elevenlabs.io/docs/<ruta>.md` (índice en `https://elevenlabs.io/docs/llms.txt`).
- Hay un Postgres 16 instalado: `pg_ctlcluster 16 main start`, después `su postgres -c "psql -c \"alter user postgres password 'postgres'\" -c 'create database turnia_test'"`.
- El entorno no tiene credenciales de Vercel, Neon, ElevenLabs ni n8n: lo que necesite esos servicios lo hace el usuario o una sesión local con `.env.local`.

## 9. Convenciones
- **Texto:** español rioplatense, con voseo, en UI, prompt, errores de tools y comentarios.
- **Base de datos:** SQL parametrizado con el tag `sql` de `src/lib/db.ts` (nunca concatenar strings). Fragmentos con ``sql`…` ``, inserts/updates dinámicos con `sql(objeto)`, jsonb con `json()`, listas con `= any(${ids}::uuid[])`. Validá IDs con `isUuid` antes de consultar. Cambios de esquema: agregarlos a `schema.sql` en forma idempotente (y en la sección de actualización del final) y avisar que hay que volver a correrlo.
- **Seguridad:** el navegador nunca habla con la base. Todo pasa por el servidor con `DATABASE_URL`, y las tablas tienen RLS sin políticas.
- **Server actions:** siempre empiezan con `requireSession()` y filtran por `clinic_id`.
- **Tools:** para agregar una, definila en `src/lib/agent/tools.ts`, implementala en `service.ts`, registrala en `HANDLERS` (`src/app/api/agent/tools/[name]/route.ts`), mencioná en el prompt cuándo usarla, sumá un test de integración y volvé a tocar "Crear / actualizar agente".
- **Variables dinámicas:** si agregás una al prompt, tiene que salir de `buildDynamicVariables`.
- **Fechas:** nunca uses la hora local del server. Usá los helpers de `src/lib/time.ts` con `clinic.timezone`. La conexión a Postgres corre en UTC y devuelve instantes en ISO.
- **Commits:** autor `a13ilaboratory <a13i.laboratory@gmail.com>`; no incluir identificadores de modelo en commits ni en el código.
