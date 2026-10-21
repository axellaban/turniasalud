# Turnia Salud — contexto del proyecto y pendientes

> Documento de traspaso para la próxima persona o IA que siga el proyecto.
> Última actualización: 21/10/2026. Repo: https://github.com/axellaban/turniasalud (rama `main`).

---

## 1. Qué es y para quién

**Turnia Salud** es un MVP "copycat" de [Assort Health](https://www.assorthealth.com), adaptado a **Argentina / LATAM**. Son agentes de IA que atienden la comunicación con pacientes de clínicas y consultorios:

- **WhatsApp primero.** En LATAM casi nadie atiende el teléfono fijo, y la gente manda audios. El teléfono es un canal secundario.
- Dan turnos sobre la agenda real, confirman, cancelan, reprograman, hacen la admisión (DNI, obra social/prepaga, plan, afiliado), contestan preguntas frecuentes y hacen triage (urgencia → 107 / guardia + tarea urgente).
- **Outbound / recall:** le escriben a los pacientes para llenar la agenda (controles vencidos, recordatorios, ausentes, reactivación, lista de espera).

**Sobre el dueño del proyecto:**
- Es **no-code**: todo lo operativo tiene que poder hacerse desde paneles (Supabase SQL Editor, Vercel, ElevenLabs, n8n, panel de la app).
- Ya tiene **n8n** y **Supabase** (proyecto propio, *no* creado desde Vercel).
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
| **No copiar marca ni textos de Assort** | Se replicaron funcionalidad y arquitectura de información con marca y textos propios, para evitar suplantación y problemas legales. |
| **Una clínica por deploy (por ahora)** | El esquema ya es multi-clínica (`clinic_id` en todo). La app usa `DEFAULT_CLINIC_ID` o la primera clínica. |
| **Panel con contraseña única** | `PANEL_PASSWORD` + cookie firmada con HMAC. Es simple para el MVP. |
| **Cache Components desactivado** | `next.config.ts` → `cacheComponents: false`. La app es casi toda datos en vivo; las páginas del panel usan `dynamic = "force-dynamic"`. |

### Mapeo con los productos de Assort
| Assort | Turnia | Implementación |
|---|---|---|
| Concierge (inbound) | **Recepción** | Agente en ElevenLabs + `src/app/api/agent/tools/[name]` |
| Activate (outbound) | **Activa** | `src/lib/campaigns.ts`, panel → Campañas, `n8n/turnia-campanas-automaticas.json`, `offerFreedSlot` en `service.ts` |
| Orchestrate | **Circuitos** | Herramienta `registrar_paciente` + indicaciones previas por tipo de turno. Faltan formularios digitales y derivaciones/fax. |
| Empower | **Equipo** | Panel: tareas, conversaciones con transcripción y resumen, métricas, memoria del paciente |
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
        │                                    → Supabase (turnos, pacientes, tareas, lista de espera)
        │        ──(3) post-conversación──► POST /api/elevenlabs/post-call     (firma HMAC ElevenLabs-Signature)
        │                                    → guarda conversación, resumen, intent/outcome, memoria; actualiza campañas
        ▼
Panel /panel (Next.js, server components + server actions)
n8n ◄── eventos (N8N_WEBHOOK_URL): turno.reservado/cancelado/reprogramado, tarea.creada, conversacion.finalizada
n8n ──► POST /api/automations/:job  (recordatorios | recall | reactivacion | ausentes | lista-espera)
Demo web /demo ──► POST /api/elevenlabs/token → conversation token (voz, WebRTC) o signed URL (chat, WebSocket) + dynamic variables
```

**Stack:**
- Next.js **16.4** (App Router, React 19.3, Tailwind v4 con loader de turbopack)
- `@supabase/supabase-js` 2.118 (service role, solo server)
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
supabase/schema.sql        Tablas + extensiones + constraint anti-superposición + RLS sin políticas (idempotente)
supabase/seed.sql          Clínica demo id 00000000-0000-4000-8000-000000000001, 4 profesionales, 8 tipos de turno, horarios, 4 pacientes
src/lib/env.ts             Variables de entorno (required/optional), isConfigured()
src/lib/supabase.ts        Cliente service role + unwrap()
src/lib/time.ts            Zona horaria (zonedTimeToUtc, humanSlot "martes 28/10 a las 10:30"), sin depender del TZ del server
src/lib/slots.ts           Cálculo PURO de turnos libres + isSlotFree (testeado)
src/lib/phone.ts           Normaliza a ID de WhatsApp AR: 549 + área sin 0 + número sin 15 (testeado)
src/lib/clinic.ts          getClinic/resolveClinic, catálogo, textos para el prompt, buildDynamicVariables()
src/lib/agent/tools.ts     Definición ÚNICA de las 8 tools (zod + params para ElevenLabs) y CONTEXT_PARAMS (dynamic vars)
src/lib/agent/service.ts   Lógica de cada tool (reservar, cancelar → ofrece hueco a lista de espera, reprogramar, etc.)
src/lib/agent/prompt.ts    System prompt y first message (rioplatense)
src/lib/agent/setup.ts     Crea/actualiza tools + agente vía API de ElevenLabs (botón en panel → Configuración)
src/lib/agent/auth.ts      Verificación del header x-turnia-secret
src/lib/elevenlabs.ts      fetch a la API REST, token/signed URL, envío de templates de WhatsApp, verificación HMAC
src/lib/conversations.ts   Procesa el webhook post-conversación (guardar, memoria, campañas, n8n)
src/lib/campaigns.ts       Audiencias (recall, reactivación, recordatorio, ausentes, lista de espera, personalizada) y envío
src/lib/n8n.ts             notifyN8n() (nunca rompe el flujo principal)
src/lib/session.ts         Cookie de sesión del panel (HMAC)
src/proxy.ts               Protección de /panel
src/app/page.tsx           Landing
src/app/demo/              Demo chat/voz con @elevenlabs/react
src/app/panel/actions.ts   Todas las server actions (todas llaman requireSession())
src/app/panel/(app)/       Inicio, agenda, conversaciones, tareas, pacientes, campañas, configuración
src/app/api/               agent/tools/[name], elevenlabs/{initiation,post-call,token}, automations/[job], health
n8n/                       2 workflows importables (campañas programadas, eventos → avisos)
```

### Tools del agente (`/api/agent/tools/:nombre`)
1. `registrar_paciente`
2. `consultar_disponibilidad`
3. `reservar_turno`
4. `ver_turnos_paciente`
5. `cancelar_turno`
6. `reprogramar_turno`
7. `crear_tarea`
8. `anotar_lista_espera`

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
- **Configuración:** `clinics` (incluye `templates` jsonb con nombres de templates de Meta, `whatsapp_phone_number_id`, `elevenlabs_agent_id`), `professionals`, `appointment_types` (`recall_months`), `schedules` (weekday 0=domingo).
- **Pacientes:** `patients` (único por `clinic_id` + `phone`; `memory_summary`).
- **Turnos:** `appointments`. Estados: `confirmado | pendiente | cancelado | ausente | atendido | reprogramado`. La constraint `appointments_no_overlap` (exclusión GiST) bloquea superposición por profesional entre los estados activos.
- **Operación:** `conversations`, `tasks`, `waitlist`, `campaigns`, `campaign_recipients`.

---

## 5. Estado actual

### Hecho y verificado
- `npm test`: 26 tests OK (turnos/zonas horarias, teléfonos, firma HMAC, sesión, canales, memoria).
- `npx tsc --noEmit`, `npx eslint src` y `npx next build`: sin errores.
- `schema.sql` y `seed.sql` corridos **dos veces** en Postgres 16 local, sin errores. La constraint de superposición probada: rechaza solapados, acepta contiguos, un cancelado libera el horario.
- Smoke test con `next start`:
  - Landing, demo y login responden 200.
  - `/panel` redirige al login sin sesión; el login funciona.
  - Las tools sin secreto devuelven 401.
  - La validación de parámetros funciona.
  - El post-call sin secreto configurado devuelve 500.
- Capturas revisadas: sin scroll horizontal en mobile.

### Hecho pero NO probado contra servicios reales (prioridad 1)
No había claves en el entorno, y no se pudo levantar PostgREST/Supabase local (Docker Hub devolvió 429).
- **Toda la capa Supabase** (`service.ts`, `campaigns.ts`, `conversations.ts`, páginas del panel). Es probable que haya errores menores en selects con relaciones (`patients(full_name)`, `campaigns!inner(clinic_id)`), en filtros `.or()` con `ilike` o en upserts con `onConflict`.
- **`src/lib/agent/setup.ts` contra la API de ElevenLabs.** Se escribió leyendo la documentación (`/v1/convai/tools`, `/v1/convai/agents/create`, PATCH). Puntos a confirmar:
  - Formato de `built_in_tools.end_call`.
  - `platform_settings.workspace_overrides.conversation_initiation_client_data_webhook`.
  - `platform_settings.overrides` (habilitar el webhook de inicio y el override de `text_only` para la demo en modo chat).
  - Formato de `data_collection` y `evaluation.criteria`.
  - Parámetros de búsqueda de voces: `/v1/shared-voices?language=es&locale=es-AR&category=professional`.
  - Agregado de voz: `/v1/voices/add/{public_owner_id}/{voice_id}`.
  - `tts.model_id: "eleven_v4_turbo"` para español.
  - LLM por defecto `claude-sonnet-5-5` (configurable con `AGENT_LLM`).
- **Webhook de inicio:** confirmar la forma exacta de la respuesta. Hoy devuelve `{type, dynamic_variables, user_id}`.
- **Post-call:** cómo detectar el canal (`metadata.whatsapp`, `metadata.phone_call`, `system__channel`) y qué valores reales trae `system__channel`.
- **Envío de templates:** `/v1/convai/whatsapp/outbound-message` con parámetros posicionales `{{1}}`, `{{2}}`.
- **Demo web:** si `startSession` con `signedUrl` + `textOnly` funciona, y si el modo chat duplica mensajes del usuario (hay un dedupe simple).
- **Workflows de n8n:** no se importaron en un n8n real. Las versiones de nodos usadas son `scheduleTrigger` 1.2, `set` 3.4, `httpRequest` 4.2, `webhook` 2, `if` 2 y `switch` 3; validarlas.

**Cómo probarlo:** pedirle al usuario que cargue `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `ELEVENLABS_API_KEY` como secrets del entorno (nunca por chat). Después:
1. Aplicar schema y seed.
2. Llamar a `setupAgent`.
3. Simular llamadas a cada tool con curl (`x-turnia-secret`).
4. Simular un post-call firmado.
5. Abrir el panel.

---

## 6. Pendientes (ordenados por prioridad)

### P1 — Para que funcione en producción
1. **Prueba de punta a punta** con Supabase y ElevenLabs reales (sección 5) y corrección de lo que falle.
2. **Configurar el post-call webhook** en ElevenLabs y `ELEVENLABS_WEBHOOK_SECRET` en Vercel. Es un paso manual del usuario; está en el README.
3. **WhatsApp Business:** el usuario necesita una cuenta de Meta con un número que no esté en la app de WhatsApp ni en otro BSP. Después: importarlo en ElevenLabs, asignar el agente y pegar el phone number ID en panel → Configuración.
4. **Templates de Meta** (`recordatorio_turno`, `recall_control`, `turno_liberado`, `turno_perdido`, `reactivacion_paciente`), con `{{1}}` = nombre y `{{2}}` = detalle e idioma `es_AR`. Los textos sugeridos están en el README. Confirmar el código de idioma que usa Meta para "Español (ARG)".
5. **Proteger `/demo` y `/api/elevenlabs/token`:** hoy son públicos y cualquiera puede gastar minutos de ElevenLabs. Opciones: rate limit, un flag `DEMO_ENABLED`, o pedir sesión del panel.
6. **Validar los workflows de n8n** importándolos y ajustar los JSON si hace falta.

### P2 — Paridad con el core de Assort
7. **Derivación a humano real (warm handoff):** hoy es una tarea con contexto. En WhatsApp, ElevenLabs no tiene handoff nativo. Opciones: avisar a recepción vía n8n con link a la conversación, o `transfer_to_number` en teléfono.
8. **Fuera de horario:** el agente ya atiende 24/7, pero no hay un protocolo de guardia ni escalamiento a un profesional de turno.
9. **Recetas:** hoy son tareas. Falta un flujo con estado y la respuesta al paciente por WhatsApp cuando el profesional la resuelve (template + n8n).
10. **Derivaciones (referrals):** carga de una orden o derivación (foto/PDF por WhatsApp) y contacto proactivo para agendar. ElevenLabs recibe imágenes y documentos por WhatsApp.
11. **Foto de credencial:** leer la imagen de la credencial de la obra social que manda el paciente y completar el número de afiliado (Assort hace algo parecido con el seguro).
12. **Verificación de cobertura/elegibilidad:** hoy solo se comparan nombres con la lista de la clínica y del profesional.
13. **Formularios de admisión previos a la visita** y seguimiento post-visita (encuesta / NPS).
14. **Cobranzas (payment resolution):** recordatorio de saldos y link de pago (por ejemplo, Mercado Pago).
15. **Métricas:** tasa de contención, tiempo de respuesta, turnos recuperados por campaña, ingresos estimados. Hoy hay KPIs básicos en `/panel`.
16. **Reglas de agenda avanzadas:** feriados y bloqueos (vacaciones), sobreturnos, intervalos distintos de la duración, turnos dobles, límite por obra social. Hoy no existe una tabla de bloqueos o excepciones.
17. **Recordatorio y confirmación con estado:** marcar el turno como confirmado cuando el paciente responde que sí (hoy el agente no tiene una tool `confirmar_turno`; considerar agregarla).
18. **Llamadas salientes por WhatsApp** (batch calling con permiso de llamada) para pacientes que no responden texto.

### P3 — Producto / plataforma
19. **Multi-clínica real:** usuarios por clínica (Supabase Auth), roles (recepción / admin), selector de clínica, onboarding de una clínica nueva desde la UI, un agente por clínica (ya soportado vía `resolveClinic`).
20. **Integraciones con sistemas de gestión locales** (agenda / HCE existente): investigar APIs de AgendaPro, Medilink, Doctoralia, etc. Hoy Turnia es la agenda.
21. **Sincronizar con Google Calendar** (vía n8n con los eventos `turno.*`).
22. **Cumplimiento:** Ley 25.326 (datos personales), Ley 27.706 (HCE) y consentimiento informado. En producción, activar Zero Retention Mode en ElevenLabs y revisar con un abogado. Términos y privacidad en la landing.
23. **Observabilidad:** logs estructurados, alertas cuando fallan las tools (ElevenLabs tiene alertas) y la página `/api/health` más completa.
24. **Tests de integración** con una base real (por ejemplo, Supabase CLI local en CI) y tests de las tools.
25. **Expansión LATAM:** el código ya usa zonas horarias IANA. Para México, el ID de WhatsApp es 521…, y `phone.ts` hoy solo normaliza Argentina.
26. **Landing:** sumar casos reales, precios y formulario de contacto. Hoy no hay métricas de clientes (no inventar testimonios).

### Ideas de diferenciación (charladas con el usuario)
- El **recall** como propuesta de valor principal ("te traemos pacientes que ya tenías"), con cobro por resultado: turnos recuperados.
- **Audios en WhatsApp** con voz argentina: el agente responde con nota de voz si el paciente mandó audio; ElevenLabs lo hace por defecto.
- Competencia local a mirar: Órbita (La Plata), XIAgenda y AgendaPro.

---

## 7. Variables de entorno

Ver `.env.example`.

**Obligatorias:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
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

---

## 8. Comandos

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # vitest
npm run typecheck    # tsc --noEmit (antes: npx next typegen si faltan los tipos de rutas)
npx eslint src
npm run build
```

**Notas del entorno de desarrollo en la nube (Claude Code):**
- La red sale por un proxy con allowlist (se agregaron assorthealth.com, elevenlabs.io, supabase y graph.facebook.com).
- WebFetch no resolvía DNS; para leer la documentación de ElevenLabs servía `curl https://elevenlabs.io/docs/<ruta>.md` (índice en `https://elevenlabs.io/docs/llms.txt`).
- Docker Hub limitó las descargas (429), así que no se pudo correr PostgREST.
- Hay un Postgres 16 instalado localmente, útil para probar SQL.

## 9. Convenciones
- **Texto:** español rioplatense, con voseo, en UI, prompt, errores de tools y comentarios.
- **Seguridad:** el navegador nunca habla con Supabase. Todo pasa por el servidor con service role, y las tablas tienen RLS sin políticas.
- **Server actions:** siempre empiezan con `requireSession()`.
- **Tools:** para agregar una, definila en `src/lib/agent/tools.ts`, implementala en `service.ts`, registrala en `HANDLERS` (`src/app/api/agent/tools/[name]/route.ts`), mencioná en el prompt cuándo usarla y volvé a tocar "Crear / actualizar agente".
- **Fechas:** nunca uses la hora local del server. Usá los helpers de `src/lib/time.ts` con `clinic.timezone`.
- **Commits:** autor `a13ilaboratory <a13i.laboratory@gmail.com>`; no incluir identificadores de modelo en commits ni en el código.
