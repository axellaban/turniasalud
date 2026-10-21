# Turnia Salud

Agentes de IA que atienden el **WhatsApp** (texto y audios) y el **teléfono** de clínicas y consultorios las 24 horas: dan turnos sobre la agenda real, confirman, cancelan, reprograman, toman datos de admisión, derivan urgencias y le escriben a los pacientes para llenar la agenda (recall, lista de espera, recordatorios, ausentes, reactivación).

Inspirado en el core de [Assort Health](https://www.assorthealth.com), adaptado a Argentina: WhatsApp primero, obras sociales y prepagas, voseo.

| Producto | Qué hace | Dónde está |
|---|---|---|
| **Turnia Recepción** (inbound) | Turnos 24/7, triage, FAQ, recetas y pedidos → tareas | Agente en ElevenLabs + `src/app/api/agent/tools` |
| **Turnia Activa** (outbound) | Recall, lista de espera automática al cancelar, recordatorios, ausentes, reactivación | `src/lib/campaigns.ts`, panel → Campañas, `n8n/` |
| **Turnia Circuitos** | Admisión (DNI, cobertura, plan, afiliado) e indicaciones previas | herramienta `registrar_paciente` |
| **Turnia Equipo** | Bandeja de tareas, transcripciones, resúmenes, métricas, memoria del paciente | Panel `/panel` |

## Cómo funciona

```
Paciente (WhatsApp / teléfono / web)
        │
        ▼
ElevenLabs Agent ──(1) webhook de inicio──► /api/elevenlabs/initiation   → memoria del paciente + catálogo
        │        ──(2) herramientas───────► /api/agent/tools/*            → turnos, admisión, tareas (Supabase)
        │        ──(3) post-conversación──► /api/elevenlabs/post-call     → transcripción, resumen, métricas
        ▼
Panel de la clínica (/panel)        n8n ◄── eventos (turno reservado, tarea urgente…)
                                    n8n ──► /api/automations/*  (recordatorios, recall… programados)
```

- **Stack:** Next.js 16 (Vercel) · Neon o Supabase (Postgres) · ElevenLabs Agents (voz + WhatsApp) · n8n (automatizaciones).
- La lógica delicada (no dar dos veces el mismo turno, horarios por profesional, coberturas) vive en el código y en la base (una *constraint* de Postgres impide turnos superpuestos).
- n8n queda para lo que más vas a querer tocar sin código: horarios de las campañas y avisos al equipo.

---

## Puesta en marcha (sin programar)

### Base gratuita desde Vercel: Neon
El deploy de Turnia usa **Neon Free**, en São Paulo, conectado desde Vercel → Storage.
El panel conserva las mismas consultas PostgREST y también permite usar Supabase.

1. Creá una base Neon Free dedicada desde Vercel → Storage → Create Database.
2. En Neon → SQL Editor, ejecutá `supabase/schema.sql`, `supabase/seed.sql` y `supabase/neon-access.sql`.
   El seed conserva una clínica demo existente; no borra sus turnos ni su configuración.
3. Cargá `NEON_SERVER_PRIVATE_KEY` (clave RSA PKCS8 en base64) como **Secret** en Vercel.
4. Habilitá Data API sin Neon Auth y sin conceder acceso general al esquema público.
5. Agregá un proveedor de autenticación propio con JWKS en `https://tu-app/api/database/jwks`
   y audiencia `turnia-data-api`.
6. Cargá `NEON_DATA_API_URL`, copiando la URL de Data API sin el sufijo `/rest/v1`.

El servidor firma credenciales de cinco minutos para el rol `turnia_server`. La ruta JWKS
publica exclusivamente la clave pública. Las tablas mantienen RLS y solo ese rol accede
mediante las políticas de `neon-access.sql`; el navegador nunca recibe credenciales de la base.

La alternativa Supabase continúa disponible con las variables de la sección siguiente.

### 1. Base de datos (Supabase)
1. Entrá a tu proyecto de Supabase → **SQL Editor** → **New query**.
2. Pegá todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y tocá **Run**.
3. (Recomendado para probar) Nueva query con [`supabase/seed.sql`](supabase/seed.sql) → **Run**. Crea una clínica demo con 4 profesionales, horarios y pacientes de ejemplo.
4. En **Project Settings → API** copiá la *Project URL* y la *service_role key* (la secreta).

### 2. Deploy en Vercel
1. En Vercel: **Add New → Project → Import** este repositorio de GitHub.
2. En **Environment Variables** cargá (ver [`.env.example`](.env.example)):

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role |
| `ELEVENLABS_API_KEY` | ElevenLabs → Developers → API Keys |
| `AGENT_TOOLS_SECRET` | Inventalo: un texto largo y aleatorio |
| `PANEL_PASSWORD` | La contraseña que quieras para el panel |
| `ELEVENLABS_WEBHOOK_SECRET` | Lo obtenés en el paso 3 (podés agregarlo después) |

3. **Deploy**. Cuando termine, abrí `https://tu-app.vercel.app/panel` e ingresá con `PANEL_PASSWORD`.

### 3. Agente en ElevenLabs
1. En el panel → **Configuración** → **Crear / actualizar agente**. Esto crea en tu cuenta de ElevenLabs el agente "Turnia · …" con sus 8 herramientas, el prompt en rioplatense, una voz argentina y el webhook de inicio.
2. En ElevenLabs → **Agents → Settings → Post-call webhook**: creá un webhook con la URL `https://tu-app.vercel.app/api/elevenlabs/post-call`. Copiá el **secreto** que te muestra, cargalo en Vercel como `ELEVENLABS_WEBHOOK_SECRET` y hacé **Redeploy**.
3. Ingresá al panel y probalo en `https://tu-app.vercel.app/demo` (chat o voz). La demo requiere sesión del panel. Los turnos que reserves aparecen en el panel → Agenda, y la conversación en → Conversaciones.

> Cada vez que cambies datos de la clínica no hace falta tocar nada: el agente los lee al empezar cada conversación. Solo volvé a tocar **Crear / actualizar agente** si cambia la URL de la app o actualizás el código.

### 4. WhatsApp
1. Necesitás una cuenta de **WhatsApp Business Platform** (Meta) con un número que **no** esté en uso en la app de WhatsApp ni en otro proveedor.
2. ElevenLabs → **WhatsApp** → **Import account** → autorizá → asigná el agente "Turnia · …".
3. En el menú del número → **Copy phone number ID** y pegalo en el panel → Configuración → *ID del número de WhatsApp*.
4. En WhatsApp Manager creá los templates (categoría **Utility**, salvo reactivación que es **Marketing**; idioma Español (ARG) = `es_AR`). Todos usan `{{1}}` = nombre y `{{2}}` = detalle:

| Nombre | Texto sugerido |
|---|---|
| `recordatorio_turno` | ¡Hola {{1}}! Te recordamos tu turno el {{2}}. ¿Nos confirmás si venís? Si no podés, respondé este mensaje y lo reprogramamos. |
| `recall_control` | ¡Hola {{1}}! Ya es momento de tu {{2}}. ¿Querés que te busquemos un turno? |
| `turno_liberado` | ¡Hola {{1}}! Se liberó un turno el {{2}}. Si lo querés, respondé este mensaje y te lo reservamos. |
| `turno_perdido` | Hola {{1}}, te esperamos para tu {{2}} y no pudiste venir. ¿Querés que lo reprogramemos? |
| `reactivacion_paciente` | ¡Hola {{1}}! Hace un tiempo que no te vemos por {{2}}. ¿Querés sacar un turno para un control? |

Cuando el paciente responde, lo atiende el mismo agente con el contexto de la campaña.

> En Argentina el ID de WhatsApp de un celular es `549` + código de área sin 0 + número sin 15. Ej.: 011 15 5555-0001 → `5491155550001`. Turnia lo normaliza solo.

### 5. n8n (automatizaciones)
1. En n8n: **Workflows → Import from file** → [`n8n/turnia-campanas-automaticas.json`](n8n/turnia-campanas-automaticas.json). Editá el nodo **Configuración** (URL de la app y `AGENT_TOOLS_SECRET`) y activalo. Corre:
   - todos los días 10:00 → recordatorios de los turnos de mañana
   - todos los días 18:00 → recupero de ausentes
   - lunes 11:00 → recall de controles vencidos
   - día 1 de cada mes → reactivación de pacientes que no vienen hace +12 meses
2. (Opcional) Importá [`n8n/turnia-eventos.json`](n8n/turnia-eventos.json), copiá su **Production URL** y cargala en Vercel como `N8N_WEBHOOK_URL`. Reemplazá los nodos grises por Gmail/Slack/WhatsApp para avisar a recepción cuando hay una tarea urgente, etc.

### 6. Teléfono (opcional)
En ElevenLabs → **Phone numbers** importá un número de Twilio o un SIP trunk y asignale el mismo agente. El webhook de inicio funciona igual que en WhatsApp.

---

## Para desarrolladores

```bash
npm install
cp .env.example .env.local   # completar
npm run dev                  # http://localhost:3000
npm test                     # tests unitarios (turnos, teléfonos, firmas, sesión)
npm run build
```

- `src/lib/slots.ts` — cálculo de turnos libres (puro, testeado).
- `src/lib/agent/tools.ts` — definición única de las herramientas (validación + config de ElevenLabs).
- `src/lib/agent/prompt.ts` — prompt del agente.
- `src/lib/agent/setup.ts` — crea/actualiza tools y agente vía API de ElevenLabs.
- `src/lib/campaigns.ts` — audiencias y envíos de Turnia Activa.
- `supabase/schema.sql` — tablas con RLS activado y sin políticas: solo el servidor (service role) accede.

### Endpoints
| Ruta | Quién la llama | Auth |
|---|---|---|
| `POST /api/agent/tools/:nombre` | ElevenLabs (herramientas) | header `x-turnia-secret` |
| `POST /api/elevenlabs/initiation` | ElevenLabs (inicio de conversación) | header `x-turnia-secret` |
| `POST /api/elevenlabs/post-call` | ElevenLabs (fin de conversación) | firma HMAC `ElevenLabs-Signature` |
| `POST /api/automations/:job` | n8n (`recordatorios`, `recall`, `reactivacion`, `ausentes`, `lista-espera`) | header `x-turnia-secret` |
| `POST /api/elevenlabs/token` | Demo web | sesión del panel |
| `GET /api/health` | Monitoreo | público |

### Pendientes conocidos del MVP
- Una sola cuenta de panel (contraseña compartida) y una clínica activa por deploy (el esquema ya es multi-clínica).
- La demo web y la emisión de credenciales requieren sesión del panel; el agente se configura con autenticación habilitada en ElevenLabs.
- Derivación a humano en WhatsApp: hoy se resuelve con tareas (ElevenLabs todavía no tiene *human handoff* nativo en WhatsApp).
- Integraciones con sistemas de gestión locales (historia clínica / agenda existente) no incluidas.
- Datos de salud: revisá con un abogado el cumplimiento de la Ley 25.326 y, para producción, activá *Zero Retention Mode* en ElevenLabs.
