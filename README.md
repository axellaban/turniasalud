# Turnia Salud

Agentes de IA que atienden el **WhatsApp** (texto y audios) y el **teléfono** de clínicas y consultorios las 24 horas: dan turnos sobre la agenda real, confirman, cancelan, reprograman, toman datos de admisión, derivan urgencias y le escriben a los pacientes para llenar la agenda (recall, lista de espera, recordatorios, ausentes, reactivación).

Inspirado en el core de [Assort Health](https://www.assorthealth.com), adaptado a Argentina: WhatsApp primero, obras sociales y prepagas, voseo.

| Producto | Qué hace | Dónde está |
|---|---|---|
| **Turnia Recepción** (inbound) | Turnos 24/7, confirmación de asistencia, triage, FAQ, fuera de horario, recetas y pedidos → tareas, derivación a una persona | Agente en ElevenLabs + `src/app/api/agent/tools` |
| **Turnia Activa** (outbound) | Recall, lista de espera automática al cancelar, recordatorios, ausentes, reactivación, encuesta post-consulta | `src/lib/campaigns.ts`, panel → Campañas, `n8n/` |
| **Turnia Circuitos** | Admisión (DNI, cobertura, plan, afiliado, foto de credencial), órdenes médicas e indicaciones previas | herramienta `registrar_paciente` + prompt |
| **Turnia Equipo** | Bandeja de tareas con respuesta al paciente por WhatsApp, transcripciones, resúmenes, métricas, memoria del paciente | Panel `/panel` |

## Cómo funciona

```
Paciente (WhatsApp / teléfono / web)
        │
        ▼
ElevenLabs Agent ──(1) webhook de inicio──► /api/elevenlabs/initiation   → memoria del paciente + catálogo
        │        ──(2) herramientas───────► /api/agent/tools/*            → turnos, admisión, tareas (Postgres)
        │        ──(3) post-conversación──► /api/elevenlabs/post-call     → transcripción, resumen, métricas
        ▼
Panel de la clínica (/panel)        n8n ◄── eventos (turno reservado, tarea urgente…)
                                    n8n ──► /api/automations/*  (recordatorios, recall… programados)
```

- **Stack:** Next.js 16 (Vercel) · Postgres (Neon o Supabase, conexión directa con `DATABASE_URL`) · ElevenLabs Agents (voz + WhatsApp) · n8n (automatizaciones).
- La lógica delicada (no dar dos veces el mismo turno, horarios por profesional, feriados, coberturas) vive en el código y en la base (una *constraint* de Postgres impide turnos superpuestos).
- n8n queda para lo que más vas a querer tocar sin código: horarios de las campañas y avisos al equipo.

---

## Puesta en marcha (sin programar)

### 1. Base de datos (Postgres)
La app se conecta directo a Postgres con una sola variable, `DATABASE_URL`, solo desde el servidor.

**Neon (la que usa este deploy, gratis desde Vercel):**
1. En Vercel → tu proyecto → **Storage** → **Create Database** → Neon. La integración carga sola `DATABASE_URL` en Vercel.
2. En Neon → **SQL Editor**, pegá todo [`supabase/schema.sql`](supabase/schema.sql) y tocá **Run**.
3. (Para probar) Nueva query con [`supabase/seed.sql`](supabase/seed.sql) → **Run**. Crea una clínica demo con 4 profesionales, horarios y pacientes ficticios. Si la clínica demo ya existe, no la toca.

**Supabase (alternativa):** corré los mismos dos archivos en Supabase → SQL Editor y cargá en Vercel como `DATABASE_URL` la cadena de **Project Settings → Database → Connection string → Transaction pooler** (puerto 6543).

> **Después de la primera vez no hace falta volver a pegarlo:** cada deploy de producción en Vercel aplica `schema.sql` solo, antes del build (`scripts/migrate-db.mjs`, en una transacción). Crea lo que falta y actualiza bases de versiones anteriores sin borrar datos; nunca corre `seed.sql`. En el log del build aparece `[db] Base actualizada…`. Si la base no responde, el build se corta y queda publicado el deploy anterior (para publicar igual: `SKIP_DB_MIGRATION=1` en Vercel). Los previews no tocan la base. A mano: `DATABASE_URL=… npm run db:migrate`.

### 2. Deploy en Vercel
1. En Vercel: **Add New → Project → Import** este repositorio de GitHub.
2. En **Environment Variables** cargá (ver [`.env.example`](.env.example)):

| Variable | De dónde sale |
|---|---|
| `DATABASE_URL` | La carga la integración de Neon (o la cadena del pooler de Supabase) |
| `ELEVENLABS_API_KEY` | ElevenLabs → Developers → API Keys |
| `AGENT_TOOLS_SECRET` | Inventalo: un texto largo y aleatorio |
| `PANEL_PASSWORD` | La contraseña que quieras para el panel |
| `ELEVENLABS_WEBHOOK_SECRET` | Lo obtenés en el paso 3 (podés agregarlo después) |

3. **Deploy**. Cuando termine, abrí `https://tu-app.vercel.app/panel` e ingresá con `PANEL_PASSWORD`.

### 3. Agente en ElevenLabs
1. En el panel → **Configuración** → **Crear / actualizar agente**. Esto crea en tu cuenta de ElevenLabs el agente "Turnia · …" con sus 9 herramientas, el prompt en rioplatense, una voz argentina y el webhook de inicio. Si cargaste un *teléfono para pasar llamadas*, suma la transferencia a una persona (solo en llamadas).
2. En ElevenLabs → **Agents → Settings → Post-call webhook**: creá un webhook con la URL `https://tu-app.vercel.app/api/elevenlabs/post-call`. Copiá el **secreto** que te muestra, cargalo en Vercel como `ELEVENLABS_WEBHOOK_SECRET` y hacé **Redeploy**.
3. Ingresá al panel y probalo en `https://tu-app.vercel.app/demo` (chat o voz). La demo requiere sesión del panel. Los turnos que reserves aparecen en el panel → Agenda, y la conversación en → Conversaciones.

> Cada vez que cambies datos de la clínica (horarios, feriados, precios, textos) no hace falta tocar nada: el agente los lee al empezar cada conversación. Solo volvé a tocar **Crear / actualizar agente** si cambia la URL de la app, el teléfono para pasar llamadas o actualizás el código.

### 4. WhatsApp
Hay dos formas de conectarlo. Se elige en Panel → Configuración → **Cómo se conecta WhatsApp**:

| | Oficial (Meta) | WAHA (chip común) |
|---|---|---|
| Número | Número dedicado de WhatsApp Business Platform | Cualquier chip, vinculado con QR |
| Riesgo de bloqueo | No | **Sí**: es una API no oficial. Usá un chip de prueba, no el número principal de la clínica |
| Mensajes salientes | Templates aprobados por Meta (pagos) | El mismo texto como mensaje común, con una pausa entre envíos |
| Audios | Sí, con respuesta en voz | Sí: se transcriben y el agente responde por texto |
| Fotos y archivos | Sí (credencial, órdenes) | No: el agente le pide que lo cuente por escrito |

#### 4a. WhatsApp por WAHA (para probar con un chip)
Usa **WAHA** en tu servidor y el **Custom Channel** de ElevenLabs (en alpha), que conecta ese WhatsApp con el mismo agente, sus herramientas y la memoria del paciente.

0. **Base:** se actualiza sola en el deploy de producción (columna `whatsapp_provider`, tablas `channel_conversations` y `channel_events`). No hay que tocar Neon.
1. **Chip y WAHA:** en el dashboard de WAHA creá (o usá) la sesión `default` y escaneá el QR con el WhatsApp del chip nuevo.
2. **ElevenLabs:** abrí el agente "Turnia · …" → **Channels** → **Custom Channel** → **Add trigger**. En *Reply Webhook URL* poné `https://turniasalud.vercel.app/api/elevenlabs/canal` → **Add**. Copiá los tres valores que muestra.
3. **Vercel → Settings → Environment Variables** (como *Secret*, en Production):
   | Variable | Qué va |
   |---|---|
   | `ELEVENLABS_CHANNEL_URL` | *Inbound Webhook URL* del paso 2 |
   | `ELEVENLABS_CHANNEL_SECRET` | *Inbound Secret* del paso 2 |
   | `ELEVENLABS_CHANNEL_SIGNING_SECRET` | *Outbound Signing Secret* del paso 2 |
   | `WAHA_URL` | La dirección pública de tu WAHA, con `https://` |
   | `WAHA_API_KEY` | La API key de WAHA |
   | `WAHA_WEBHOOK_HMAC` | Un texto largo y aleatorio que inventás vos (lo usás en el paso 5) |
   | `WAHA_SESSION` | Opcional: el nombre de la sesión si no es `default` |

   Después, **Deployments → Create Deployment → `main`** para que tome las variables.
4. **Panel → Configuración:** elegí **WAHA** en *Cómo se conecta WhatsApp* y guardá. El recuadro *WhatsApp por WAHA* tiene que mostrar todo en ✅.
5. **Webhook en WAHA:** en la sesión → *Webhooks* → URL `https://turniasalud.vercel.app/api/waha/webhook`, evento **`message`** y, en *HMAC*, la misma clave de `WAHA_WEBHOOK_HMAC`.
6. Mandale un WhatsApp al chip desde otro celular. La respuesta del agente vuelve por el mismo chat y la conversación aparece en Panel → Conversaciones.

> Para transcribir audios, la API key de ElevenLabs necesita el permiso **Speech to Text**. Si WAHA es la versión Core y no descarga archivos, el agente le pide al paciente que escriba el mensaje.

#### 4b. WhatsApp oficial (Meta)
1. Necesitás una cuenta de **WhatsApp Business Platform** (Meta) con un número que **no** esté en uso en la app de WhatsApp ni en otro proveedor.
2. ElevenLabs → **WhatsApp** → **Import account** → autorizá → asigná el agente "Turnia · …".
3. En el menú del número → **Copy phone number ID** y pegalo en el panel → Configuración → *ID del número de WhatsApp*.
4. En WhatsApp Manager creá los templates (categoría **Utility**, salvo reactivación que es **Marketing**; idioma Español (ARG) = `es_AR`). Todos usan `{{1}}` = nombre y `{{2}}` = detalle. Con WAHA no hacen falta: se manda este mismo texto (`src/lib/whatsapp.ts`), y los mensajes que el paciente no pidió suman "Si no querés recibir más mensajes, respondé BAJA.":

| Nombre | Texto sugerido |
|---|---|
| `recordatorio_turno` | ¡Hola {{1}}! Te recordamos tu turno el {{2}}. ¿Nos confirmás si venís? Si no podés, respondé este mensaje y lo reprogramamos. |
| `recall_control` | ¡Hola {{1}}! Ya es momento de tu {{2}}. ¿Querés que te busquemos un turno? |
| `turno_liberado` | ¡Hola {{1}}! Se liberó un turno el {{2}}. Si lo querés, respondé este mensaje y te lo reservamos. |
| `turno_perdido` | Hola {{1}}, te esperamos para tu {{2}} y no pudiste venir. ¿Querés que lo reprogramemos? |
| `reactivacion_paciente` | ¡Hola {{1}}! Hace un tiempo que no te vemos por {{2}}. ¿Querés sacar un turno para un control? |
| `encuesta_visita` | ¡Hola {{1}}! Gracias por venir a {{2}}. Del 0 al 10, ¿qué tan probable es que nos recomiendes? Tu respuesta nos ayuda a mejorar. |
| `respuesta_pedido` | Hola {{1}}, te escribimos por tu pedido: {{2}} Si necesitás algo más, respondé este mensaje. |

Si un paciente escribe "baja" o pide que no le escriban más, el agente lo registra y deja de recibir campañas y encuestas (los recordatorios de sus turnos siguen). También se puede marcar desde la ficha del paciente.

La política de privacidad pública está en `https://tu-app.vercel.app/privacidad` (Meta la pide para verificar el negocio). Hacela revisar por un abogado antes de usarla con pacientes reales.

Cuando el paciente responde, lo atiende el mismo agente con el contexto de la campaña.

> En Argentina el ID de WhatsApp de un celular es `549` + código de área sin 0 + número sin 15. Ej.: 011 15 5555-0001 → `5491155550001`. Turnia lo normaliza solo.

### 5. n8n (automatizaciones)
1. En n8n: **Workflows → Import from file** → [`n8n/turnia-campanas-automaticas.json`](n8n/turnia-campanas-automaticas.json). Editá el nodo **Configuración** (URL de la app y `AGENT_TOOLS_SECRET`) y activalo. Corre:
   - todos los días 10:00 → recordatorios de los turnos de mañana
   - todos los días 18:00 → recupero de ausentes
   - lunes 11:00 → recall de controles vencidos
   - día 1 de cada mes → reactivación de pacientes que no vienen hace +12 meses
   - todos los días 19:00 → encuesta a los atendidos en los últimos 2 días (borrá ese disparador si no la vas a usar)
2. (Opcional) Importá [`n8n/turnia-eventos.json`](n8n/turnia-eventos.json), copiá su **Production URL** y cargala en Vercel como `N8N_WEBHOOK_URL`. Reemplazá los nodos grises por Gmail/Slack/WhatsApp para avisar a recepción cuando hay una tarea urgente, etc. El evento `tarea.creada` trae `fuera_de_horario` y `panel_url` (link a las tareas) para armar la derivación a una persona.

### 6. Teléfono (opcional)
En ElevenLabs → **Phone numbers** importá un número de Twilio o un SIP trunk y asignale el mismo agente. El webhook de inicio funciona igual que en WhatsApp. Para que el agente pueda pasar la llamada a una persona, cargá el teléfono en Configuración (formato +54…) y volvé a tocar **Crear / actualizar agente**.

### 7. Feriados, vacaciones y precios
- **Configuración → Feriados, vacaciones y bloqueos:** toda la clínica o un profesional, por días completos o por horas. El agente deja de ofrecer esos turnos y avisa el motivo. Los turnos ya dados no se cancelan solos: el panel avisa cuántos hay para reprogramar.
- **Precio de referencia** por tipo de turno: alimenta la métrica de ingresos recuperados por campañas en el inicio del panel.

---

### 8. Web pública: audios de las demos y video
- **Audios:** Panel → Configuración → **Audios de la web** → "Generar los que faltan". Usa tus 2 voces favoritas de ElevenLabs (Sofi = la femenina). La clave necesita los permisos **Text to Speech** y **Voices: Read**; si preferís no tocar la del agente, creá otra y cargala en Vercel como `ELEVENLABS_TTS_API_KEY`. Son unos 17.600 caracteres en total.
- **Video del hero:** subí `public/videos/hero.mp4` (opcional `hero.webm` y `hero-mobile.mp4`). Sin video se ve la foto.

### 9. Lead magnet: "Probá la demo con tu web" (`/probar-demo`)
La persona pega la web de su consultorio y toca **PROBAR DEMO**: se abre WhatsApp con «Quiero probar la demo de Turnia. Te paso mi web: …». Turnia lee la web, arma una clínica de prueba con esos datos y le ofrece **1 llamada de voz, 2 audios de WhatsApp o 3 chat**; el agente la atiende como la recepcionista de ese consultorio. Cada interesado aparece una sola vez en Panel → Pedidos de demo (origen `demo-whatsapp`), con lo que probó y sus conversaciones, y dispara `lead.nuevo` a n8n. Requiere WhatsApp por WAHA (paso 4) funcionando: el número del botón sale solo del chip conectado. Estado en Panel → Configuración → "Demo con tu web" y en `/api/health` (`demo`). Detalle en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md).

| Variable en Vercel | Para qué |
|---|---|
| `DEMO_WHATSAPP_NUMBER` | Opcional: por defecto se usa el número del chip conectado a WAHA. Cargalo solo para forzar otro (con código de país, ej. `5491122223333`). Sin WAHA, la landing muestra "se habilita en breve" |
| `ANTHROPIC_API_KEY` | Recomendada: Claude ordena la web en profesionales, prestaciones, horarios y coberturas. Sin clave la demo funciona con un perfil básico |
| `ELEVENLABS_PHONE_NUMBER_ID` | Opcional: número de Twilio importado en ElevenLabs para que la opción 1 **llame al celular**. Sin esto, la opción 1 manda un link para hablar desde el navegador |
| `ELEVENLABS_VOICE_ID` | Opcional: voz de los audios. Por defecto, la voz del agente |

## Para desarrolladores

```bash
npm install
cp .env.example .env.local   # completar
npm run dev                  # http://localhost:3000
npm test                     # tests unitarios (turnos, teléfonos, firmas, sesión)
npm run build

# Tests de integración contra un Postgres DESCARTABLE (lo borra y carga schema + seed):
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnia_test npm test
```

Los tests de integración cubren todas las herramientas del agente (incluidas reservas simultáneas), campañas, el webhook firmado, las server actions y el render de cada página del panel. Solo aceptan bases en `localhost` o el servicio `postgres` de CI. GitHub Actions (`.github/workflows/ci.yml`) corre typecheck, lint, tests con Postgres 16 y build en cada push a `main` y en los pull requests.

- `src/lib/db.ts` — conexión a Postgres (`postgres.js`, SQL parametrizado con el tag `sql`).
- `src/lib/slots.ts` — cálculo de turnos libres, feriados y horario de atención (puro, testeado).
- `src/lib/agent/tools.ts` — definición única de las herramientas (validación + config de ElevenLabs).
- `src/lib/agent/prompt.ts` — prompt del agente.
- `src/lib/agent/setup.ts` — crea/actualiza tools y agente vía API de ElevenLabs.
- `src/lib/whatsapp.ts` — único punto para escribirle al paciente (Meta o WAHA) y textos de los templates.
- `src/lib/channel.ts` + `src/lib/waha.ts` — WhatsApp por WAHA: conversaciones del Custom Channel, firma y parseo de WAHA.
- `src/lib/demo/` — lead magnet: lectura de la web (`scraper.ts`), perfil con Claude (`profile.ts`), textos y reglas (`flow.ts`) y sesiones (`session.ts`).
- `src/lib/campaigns.ts` — audiencias y envíos de Turnia Activa.
- `src/lib/tasks.ts` — resolver pedidos y responderle al paciente por WhatsApp.
- `supabase/schema.sql` — tablas con RLS activado y sin políticas: solo el servidor, con el usuario dueño de las tablas, accede.

### Endpoints
| Ruta | Quién la llama | Auth |
|---|---|---|
| `POST /api/agent/tools/:nombre` | ElevenLabs (herramientas) | header `x-turnia-secret` |
| `POST /api/elevenlabs/initiation` | ElevenLabs (inicio de conversación) | header `x-turnia-secret` |
| `POST /api/elevenlabs/post-call` | ElevenLabs (fin de conversación) | firma HMAC `ElevenLabs-Signature` |
| `POST /api/waha/webhook` | WAHA (mensajes de WhatsApp por chip) | HMAC SHA-512 `X-Webhook-Hmac` |
| `POST /api/elevenlabs/canal` | ElevenLabs Custom Channel (respuestas del agente) | firma HMAC `ElevenLabs-Signature` |
| `POST /api/automations/:job` | n8n (`recordatorios`, `recall`, `reactivacion`, `ausentes`, `lista-espera`, `encuestas`) | header `x-turnia-secret` |
| `POST /api/elevenlabs/token` | Demo web | sesión del panel |
| `POST /api/demo/llamada` | Llamada por la web del lead magnet | token del link enviado por WhatsApp |
| `GET /api/health` | Monitoreo: consulta la base (503 si no responde) y dice qué le falta a la demo con tu web | público |
| `GET /privacidad` | Pacientes y Meta | público |

### Pendientes conocidos del MVP
- Una sola cuenta de panel (contraseña compartida) y una clínica activa por deploy (el esquema ya es multi-clínica).
- La demo web y la emisión de credenciales requieren sesión del panel; el agente se configura con autenticación habilitada en ElevenLabs.
- Derivación a humano en WhatsApp: se resuelve con tareas y el aviso a n8n (ElevenLabs no tiene *human handoff* nativo en WhatsApp). Por teléfono, transferencia a un número.
- Integraciones con sistemas de gestión locales (historia clínica / agenda existente) no incluidas.
- Datos de salud: revisá con un abogado el cumplimiento de la Ley 25.326 y, para producción, activá *Zero Retention Mode* en ElevenLabs.
