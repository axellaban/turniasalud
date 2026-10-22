# Turnia Salud — traspaso de configuración

Actualizado el 21/10/2026. **Antes del registro histórico, leer [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md)**: audios generados, prueba de voz y webhook confirmados, avisos de demo y bandeja comercial. Luego continuar con `CONTEXTO_PROYECTO.md`.

## 22/10/2026: la base se actualiza sola en cada deploy

- `npm run build` corre primero `scripts/migrate-db.mjs`: en los builds de **producción** de Vercel aplica `supabase/schema.sql` (idempotente, en una transacción, con lock) usando `DATABASE_URL`. Los previews, CI y builds locales no tocan la base. Nunca corre `seed.sql`. `vercel.json` fija `buildCommand: "npm run build"` para que el dashboard no lo pise.
- Ya no hay que pegar `schema.sql` en el SQL Editor de Neon después de cada cambio. Verificación: log del build (`[db] Base actualizada…`) o `/api/health` → `demo.base: true`.
- Si la base no responde durante el build, el build falla y queda publicado el deploy anterior. Para publicar igual: `SKIP_DB_MIGRATION=1` en Vercel (y sacarla después).
- Probado contra una base con el esquema anterior (`35840bd`) y datos: actualiza sin perder filas y se puede repetir.

## Estado actual: desplegado y funcionando con Postgres directo (21/10/2026)

El usuario completó los pasos de despliegue con Claude computer use. Todo salió como se esperaba:

- `DATABASE_URL` existe en Vercel para Production y Preview (cargada por la integración de Neon).
- `schema.sql` se volvió a correr en Neon (rama `br-cold-wildflower-b6ubnhi1`, base `neondb`, rol `neondb_owner`): 46 sentencias sin errores. Verificación: 1 clínica, tabla `schedule_blocks` creada y columna `patients.contact_opt_out` presente. No se volvió a correr `seed.sql`.
- PR https://github.com/axellaban/turniasalud/pull/1 mergeado en `main` con el CI en verde. El deployment del merge (`2edbabd`) quedó Ready · Production · Current y se publicó solo, sin "Create Deployment".
- `https://turniasalud.vercel.app/api/health` → `"ok":true, "database":"ok", "clinics":1`. **El error `jwk not found` quedó resuelto.**
- Panel → Configuración → "Crear / actualizar agente" → "Agente actualizado (agent_1101m5fg08ezfzrtbvw1rkmvn1df) con 9 herramientas".
- Demo en modo chat: se reservó un turno de Limpieza dental para "Prueba técnica" (Particular), apareció en la Agenda y se canceló desde el panel. Quedó ese paciente sintético (teléfono `web-…`) con el turno cancelado. Se puede borrar o dejar; no es un paciente real.

Sin tocar, a decisión del usuario: `NEON_DATA_API_URL`, `NEON_SERVER_PRIVATE_KEY` y Data API en Neon (ya no se usan; se pueden borrar o deshabilitar cuando quiera).

**n8n actualizado por API (21/10/2026, 17:17 UTC).** La sesión en la nube tiene `N8N_API_KEY` como variable de entorno (la cargó el usuario; nunca se imprime). Se editaron los workflows existentes sobre su versión actual, sin pisar la URL ni el secreto que ya tenían:
- **Campañas automáticas** (`g0H8xbQvRNv5FxQj`): suma "Todos los días 19:00 · Encuestas post-consulta" → job `encuestas`. Además se le cargó la zona horaria `America/Argentina/Buenos_Aires`, que no tenía: sin ella, los horarios corrían con la hora por defecto del servidor. **Sigue sin activar.**
- **Eventos** (`PEaOkLPBrLIfFE0Q`): suma las ramas `turno.confirmado` y `tarea.resuelta`, que terminan en NoOp (no mandan nada). n8n publicó la versión nueva sola. Prueba sintética sin pacientes: ejecuciones 50198 y 50199, `success`, cada evento cayó en su rama.

**WhatsApp por WAHA: código listo (21/10/2026, noche), sin conectar todavía.** Se construyó la opción B de [`PLAN_WHATSAPP.md`](PLAN_WHATSAPP.md) sin credenciales reales (WAHA y ElevenLabs simulados en los tests). Para activarla (la base ya no se toca a mano: cada deploy de producción aplica `schema.sql` solo, ver más abajo): crear el Custom Channel en el agente con Reply URL `https://turniasalud.vercel.app/api/elevenlabs/canal`, cargar en Vercel `WAHA_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC`, `ELEVENLABS_CHANNEL_URL`, `ELEVENLABS_CHANNEL_SECRET` y `ELEVENLABS_CHANNEL_SIGNING_SECRET` (y `WAHA_SESSION` si no es `default`), elegir WAHA en Configuración y apuntar el webhook de la sesión de WAHA a `/api/waha/webhook` con evento `message` y la clave HMAC. Para los audios, la clave de ElevenLabs necesita el permiso Speech to Text. No activar campañas hasta probar con el chip.

Plan original: ** El usuario tiene WAHA en su VPS y prefiere usarlo para el MVP con un chip nuevo, conectado al mismo agente con el Custom Channel de ElevenLabs. Ya se le explicaron los riesgos (API no oficial, posible bloqueo, solo texto, Custom Channel en alpha). Falta que confirme el plan y cargue las variables `WAHA_*` y `ELEVENLABS_CHANNEL_*`. La alternativa oficial (Meta Cloud API conectada a ElevenLabs) también está descripta ahí.

Otros próximos pasos:
- Probar la demo por voz.
- Verificar que la conversación de la demo aparece en Panel → Conversaciones; eso confirma el webhook post-call.
- Después de WhatsApp: activar el workflow de campañas en n8n y definir a dónde van los avisos al equipo.

La página `/privacidad` no es prioridad para el usuario. Los pendientes de producto están en `CONTEXTO_PROYECTO.md`.

## Sesión del 21/10/2026 (tarde): Neon resuelto en el código y pendientes P2

Trabajo hecho en la rama `claude/quirky-faraday-xsqbc4`, ya integrada en `main` y desplegada (ver arriba). Se hizo desde un entorno en la nube **sin credenciales**: no se tocó Vercel, Neon, ElevenLabs ni n8n, y nada se probó contra esos servicios reales. Todo se verificó contra un Postgres 16 local con `schema.sql` + `seed.sql`.

### Qué cambió

- **`jwk not found`: se dejó de usar Neon Data API.** Coincide con reportes de otros usuarios en el Discord de Neon: JWKS publicadas en `*.vercel.app`, fallas intermitentes que dependen del compute y se arreglan reiniciándolo, sin que la URL falle. No hay arreglo desde la app. El servidor ahora se conecta **directo a Postgres con `DATABASE_URL`** (`postgres.js`, SQL parametrizado, compatible con el pooler de Neon y de Supabase). Se quitaron `supabase-js`, la firma JWT, los endpoints JWKS y `neon-access.sql`.
- **Tests de integración reales** (`src/test/db.integration.test.ts`) contra un Postgres descartable: todas las herramientas, reservas simultáneas, campañas, webhook firmado, server actions y render de cada página del panel. CI en `.github/workflows/ci.yml`.
- **Bug encontrado por los tests y corregido:** con reservas simultáneas del mismo horario, Postgres podía cortar una con `deadlock detected` y el paciente recibía un error técnico. Ahora cada reserva toma un lock por profesional.
- **Pendientes P2 implementados:** `confirmar_turno`, feriados/vacaciones/bloqueos, estado de horario de atención y protocolo fuera de horario, transferencia telefónica a una persona, respuesta a recetas/pedidos por WhatsApp, encuesta post-consulta con puntaje, métricas de 30 días, fotos de credencial y órdenes médicas (prompt), baja de mensajes y página `/privacidad`.
- `/api/health` ahora consulta la base: devuelve `database: "ok"` o 503.

### Pasos para el dueño (1 a 6 y 8 ya hechos; quedan 7 y 9)

1. **Vercel → Settings → Environment Variables:** confirmar que existe `DATABASE_URL` (la cargó la integración de Neon) en Production, y también en Preview si se va a probar un preview. No hace falta crear nada nuevo.
2. **Neon → SQL Editor:** volver a correr `supabase/schema.sql` completo. Solo agrega columnas y la tabla `schedule_blocks`; no borra datos. No volver a correr `seed.sql`.
3. **Integrar la rama en `main`** y publicar desde Vercel → Deployments → Create Deployment → `main` (la publicación automática por push no se vio funcionar en la sesión anterior).
4. Abrir `https://turniasalud.vercel.app/api/health`: tiene que decir `"database":"ok"` y `"clinics":1`.
5. Panel → **Configuración** → **Crear / actualizar agente**, para subir la herramienta nueva (`confirmar_turno`, son 9), el prompt nuevo, el dato `satisfaccion` y, si se cargó teléfono, la transferencia.
6. Probar la demo (chat) logueado en el panel: pedir un turno y verificar que aparece en la Agenda.
7. Opcional y sin apuro: borrar en Vercel `NEON_DATA_API_URL` y `NEON_SERVER_PRIVATE_KEY`, y deshabilitar Data API en Neon. Ya no se usan; dejarlos no rompe nada.
8. ~~n8n: sumar la encuesta diaria y los eventos nuevos~~: hecho por API (ver arriba). Los avisos siguen sin envío y las campañas sin activar, como decidió el usuario.
9. Cuando haya WhatsApp: además de los templates anteriores, crear `encuesta_visita` y `respuesta_pedido` (textos en el README).

### A confirmar contra los servicios reales

- ~~Conexión al pooler de Neon y rol dueño de las tablas~~: confirmado en producción (`/api/health` con `"clinics":1`). Si alguna vez responde `"clinics":0` con datos cargados, la `DATABASE_URL` está usando otro rol: las tablas tienen RLS sin políticas para otros roles.
- ElevenLabs aceptó la configuración del agente con 9 herramientas y el dato `integer`. `transfer_to_number` todavía no se subió, porque no hay `handoff_phone` cargado.
- La política `/privacidad` es un borrador: revisarla con un abogado antes de usarla con pacientes reales.

> Lo que sigue es el registro histórico de la sesión anterior. El "Bloqueo principal" quedó **reemplazado** por la conexión directa: no hace falta seguir diagnosticando Data API.

## Continuación y cierre posterior (21/10/2026, aproximadamente 12:36 Argentina)

El usuario pidió continuar exclusivamente el diagnóstico de Neon y luego ordenó detenerlo por el saldo de créditos. **Se detuvieron las pruebas; el error sigue sin resolverse.** No hubo cambios funcionales de código en esta continuación.

- Se deshabilitó y volvió a habilitar **Data API de la base dedicada de Turnia**, para reinicializar su interfaz. Se verificó en la consola que quedó habilitada, con el mismo proveedor `https://turniasalud.vercel.app/.well-known/jwks.json`. No se borraron tablas, se cambiaron planes ni se relajó RLS. Esto actualiza la nota histórica de más abajo que decía que no se había deshabilitado Data API.
- Tras la reinicialización, las pruebas reales siguieron fallando con `jwk not found`. La última falló en la primera lectura de clínica, antes de crear un paciente sintético.
- Lecturas HTTP directas devolvieron 200 en series consecutivas, tanto sin `iss` como con dos variantes del issuer. Eso no resolvió el fallo del cliente: consultas equivalentes mediante `supabase-js` alternaron 3 éxitos y 3 errores en series de 6, incluso seleccionando solo `id`. No atribuir el problema a `iss` ni darlo por arreglado.
- Se revisó el código instalado de `supabase-js` y `postgrest-js`: el cliente agrega `apikey` y `Authorization`, y su wrapper transforma los headers en una instancia de `Headers`. Una siguiente comparación útil, **todavía no realizada**, es capturar de forma segura la petición final del SDK y contrastarla con HTTP directo, o probar un adaptador de transporte que serialice headers como objeto. Es una hipótesis de diagnóstico, no una corrección validada. Nunca enviar tokens a servicios de eco externos ni imprimirlos.
- No se agregó un retry ni se modificaron JWT, secretos, roles o permisos en esta continuación. No quedaron cambios funcionales por integrar. El código desplegado sigue siendo `4a51576`; los commits posteriores contienen documentación.
- Pedido final del usuario: **parar, integrar en `main` y dejar anotado**. Continuar solo cuando lo vuelva a pedir.

## Estado de entrega

Los cambios funcionales están en `main`, subidos a GitHub y desplegados en Vercel. **La aplicación todavía no está lista para uso real: la conexión con Neon Data API falla de forma intermitente con `jwk not found`.** El panel llegó a cargar datos, pero también falla al recargar; la demo no consiguió iniciar una conversación. No presentar el estado de Vercel `Ready` como una prueba de funcionamiento completo.

- Repositorio: https://github.com/axellaban/turniasalud
- Aplicación: https://turniasalud.vercel.app
- Código desplegado: `4a51576d85bf339bc703b5bd8d633597db593f78`.
- Despliegue verificado `Ready`, Production / Current: https://vercel.com/labans-projects-c5c64fdc/turniasalud/Fvn1YM6V511zGJv8ZScmpkrpveNH
- El commit posterior de documentación no cambia el código desplegado.

## Decisiones y autorización del usuario

- Se eligió **Neon Free, desde Vercel Marketplace**, porque Supabase impidió crear o reactivar proyectos por el cupo gratuito. El usuario autorizó expresamente los términos de Neon/Marketplace y el plan Free, US$0. No se contrató un plan pago.
- No pausar, borrar ni modificar `amoblaia`, ni los otros proyectos de Supabase. El antiguo proyecto `n8n` de Supabase sigue pausado y conserva sus datos.
- El usuario autorizó crear la clave restringida de ElevenLabs y guardar las credenciales de Turnia en Vercel y `.env.local`; el secreto de herramientas también en ElevenLabs y n8n. Ningún secreto va a GitHub.
- El usuario completó personalmente la verificación por email de Vercel.
- **Avisos al equipo: dejarlos preparados, sin enviar mensajes**, decisión explícita del usuario.
- Para WhatsApp se explicó la integración nativa de ElevenLabs con Meta. El usuario todavía no eligió un número. No importar ni migrar un número de otra aplicación sin su elección y autorización.
- Último pedido: integrar los cambios en `main` y dejar el traspaso para otra IA.

## Servicios configurados

### Vercel

- Equipo Hobby: `labans-projects-c5c64fdc`; proyecto `turniasalud`, conectado a `axellaban/turniasalud`, rama `main`.
- Región de funciones: São Paulo `gru1`, en `vercel.json`. Node.js 24.
- Variables propias guardadas como **Secret**: `ELEVENLABS_API_KEY`, `AGENT_TOOLS_SECRET`, `PANEL_PASSWORD`, `SESSION_SECRET`, `NEON_SERVER_PRIVATE_KEY`, `NEON_DATA_API_URL`, `N8N_WEBHOOK_URL`, `ELEVENLABS_WEBHOOK_SECRET`.
- `APP_URL` es Config. La integración Neon agregó además sus variables PostgreSQL cifradas.
- Los cinco secretos iniciales tienen Production y Preview. Las tres variables agregadas después (`NEON_DATA_API_URL`, `N8N_WEBHOOK_URL`, `ELEVENLABS_WEBHOOK_SECRET`) están en Production. Antes de probar un Preview, revisar su configuración; no habilitar campañas de prueba contra pacientes reales.
- Los pushes no produjeron automáticamente un despliegue observable durante esta sesión. Se publicó desde Deployments → Create Deployment → `main`. Investigar la automatización Git sin asumir que quedó arreglada.
- No usar Redeploy sobre un despliegue viejo: una republicación del commit `91917c8` dejó temporalmente sin endpoint JWKS a producción. La versión actual sí incluye ambos endpoints.
- Variables: https://vercel.com/labans-projects-c5c64fdc/turniasalud/settings/environment-variables
- Logs: https://vercel.com/labans-projects-c5c64fdc/turniasalud/logs

### Neon Free

- Base dedicada nueva `turniasalud`, región São Paulo. Neon Auth y Realtime desactivados.
- Proyecto `mute-queen-25152948`, rama principal `br-cold-wildflower-b6ubnhi1`, base `neondb`, compute `ep-misty-credit-b6rfwmsu`.
- Consola: https://console.neon.tech/app/projects/mute-queen-25152948/branches/br-cold-wildflower-b6ubnhi1
- Se ejecutaron `schema.sql`, `seed.sql` y `neon-access.sql` en transacción. Hay 11 tablas con RLS, la exclusión de superposición de turnos, una clínica ficticia, 4 profesionales y 8 tipos de turno.
- `seed.sql` ahora evita sobrescribir una clínica existente. **No volver a cargar datos ni borrar la base para resolver el error de autenticación.**
- Data API está habilitada sin conceder acceso general al esquema público. URL base en `.env.local` y Vercel, sin `/rest/v1`.
- Rol servidor `turnia_server NOLOGIN`; permisos DML y políticas exclusivamente para ese rol. Se agregó `GRANT turnia_server TO authenticator` al SQL reproducible.
- Proveedor personalizado actual: `https://turniasalud.vercel.app/.well-known/jwks.json`, audience `turnia-data-api`. Solo hay un proveedor configurado.
- JWT del servidor: RS256, `kid=turnia-server-v1`, `sub=turnia-server`, `role=turnia_server`, audience anterior, vence a los cinco minutos. La clave privada vive únicamente en los entornos privados.
- También sigue disponible el endpoint anterior `/api/database/jwks`.

### ElevenLabs

- Clave restringida `Turnia Salud · Vercel`, ElevenAgents Write, Voices Write y Webhooks Access, límite configurado de 10.000 créditos por período. Sin cambios de plan.
- Agente privado creado: `agent_1101m5fg08ezfzrtbvw1rkmvn1df`, **Turnia · Centro Médico Plaza (demo)**.
- Agente: https://elevenlabs.io/app/agents/agents/agent_1101m5fg08ezfzrtbvw1rkmvn1df
- Sus 8 herramientas webhook se crearon correctamente por la API. `setupAgent` también logró actualizarlo y persistir su ID en algunas ejecuciones; otras fallaron al guardar por el error de Neon.
- Webhook de inicio apunta a `/api/elevenlabs/initiation`, con el secreto compartido.
- Webhook de cierre **Turnia Salud · Post-conversación** creado en Workspace Settings: `https://turniasalud.vercel.app/api/elevenlabs/post-call`, HMAC y evento Transcript. Su secreto está en `.env.local` y Vercel como `ELEVENLABS_WEBHOOK_SECRET`.
- La API de ElevenLabs devuelve 200 y un signed URL válido para este agente. No se consiguió completar la conversación desde la demo porque falló antes la consulta a Neon.
- **No hay ninguna cuenta de WhatsApp importada.** Faltan número dedicado, autorización Meta, asignación al agente y templates aprobados. Documentación: https://elevenlabs.io/docs/eleven-agents/whatsapp
- Zero Retention Mode sigue desactivado y el audio se almacena por defecto. Revisar la configuración de privacidad antes de usar datos reales; no se habilitó ni verificó el modo de producción con pacientes.

### n8n

- Instancia: https://n8n-n8n.b6mgbu.easypanel.host
- Proyecto personal `J8PWrxWwoia6Q4fS`. No se modificaron workflows ajenos a Turnia.
- Eventos **publicado**: https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q
- Endpoint: `https://n8n-n8n.b6mgbu.easypanel.host/webhook/turnia-eventos`, guardado en los entornos privados de Turnia.
- Verifica `x-turnia-secret`, separa cinco eventos y termina en nodos NoOp. **No manda correos ni mensajes.**
- Prueba sintética sin pacientes reales: ejecución `50186`, `Succeeded in 37ms`, 21/10/2026 11:58:45.
- Campañas importadas y configuradas con URL de Turnia y secreto: https://n8n-n8n.b6mgbu.easypanel.host/workflow/g0H8xbQvRNv5FxQj
- Campañas **sin publicar/activar**, porque todavía no hay WhatsApp ni templates aprobados. No activar cron ni enviar a teléfonos ficticios del seed.
- `codex mcp add n8n --url "https://n8n-n8n.b6mgbu.easypanel.host/mcp-server/http"` completó login en la CLI. El conector de la app en esta sesión seguía devolviendo UNAUTHORIZED; se usó el navegador autenticado.

## Bloqueo principal: `jwk not found` (histórico, reemplazado por `DATABASE_URL`)

Ya no aplica: la app dejó de usar Data API (ver la sección de la tarde). Registro de lo que se probó:

- Vercel registró `POST /api/elevenlabs/token` 500: `profesionales: jwk not found` (por ejemplo 12:21:30, hora Argentina).
- El panel cargó correctamente en una oportunidad y luego mostró su pantalla de error al recargar.
- La misma credencial firmada y válida produjo respuestas 200 y 400 en distintas peticiones. Hubo secuencias de 8 lecturas exitosas; eso **no** demostró estabilidad.
- Se verificó criptográficamente la firma del JWT contra la clave pública publicada; el módulo público coincidió con la clave privada local. No parece un simple desajuste de claves, pero la causa no se determinó.
- Se agregó la membresía faltante del rol `authenticator`, que resolvió el error inicial `permission denied to set role "turnia_server"`.
- Se reemplazó el proveedor original por la URL estándar ya desplegada y verificada con HTTP 200. La inconsistencia continuó.
- Se reinició **solo el compute dedicado de Turnia**, y volvió a ACTIVE; el error siguió apareciendo. No se deshabilitó Data API ni se relajó RLS.
- No se agregó un retry a la aplicación para ocultar el fallo, ni se dejó acceso anónimo a tablas.

Próximo paso: diagnosticar configuración/propagación/verificación de JWKS en Neon Data API y confirmar estabilidad real. Si esa vía no resulta fiable, evaluar la conexión PostgreSQL directa con el driver oficial de Neon y sus variables de Vercel, conservando consultas parametrizadas y acceso solo desde el servidor. No rehacer la integración ni cambiar permisos amplios sin revisar primero lo que ya existe.

## Verificación realizada

- `npm test`: **35 tests pasan**, 2 pruebas optativas de integración se omiten por defecto.
- `npx eslint src`: sin errores.
- `npm run build`: sin errores, incluido TypeScript y el endpoint `/.well-known/jwks.json`.
- `git diff --check`: limpio antes de entregar.
- Las pruebas reales **NO pasan de manera estable**. Archivo: `src/test/live.integration.test.ts`. Se activan con `RUN_LIVE_INTEGRATION=true`; `SETUP_ELEVENLABS=true` además crea/actualiza el agente y consume llamadas a su API.
- Una ejecución real completó registro de paciente sintético, catálogo/memoria, disponibilidad, reserva, listado, reprogramación, tarea, lista de espera y cancelación. Luego falló la limpieza por el mismo error de autenticación. No afirmar que todo el circuito está aprobado.
- Se limpiaron al cerrar los **3 pacientes sintéticos residuales** con nombre `Prueba técnica de integración` y teléfono `web-integracion-*`, junto con sus tareas. Se verificó que no quedara ninguno. No se tocaron los cuatro pacientes ficticios del seed ni datos de otros proyectos.
- Sin sesión, `/api/elevenlabs/token` devuelve 401. Tools sin secreto y post-call sin firma también devuelven 401 en producción.
- Neon sin token o con token inválido no devuelve filas de pacientes (400). La autenticación y RLS siguen activas.
- `/api/health` devuelve 200 con flags de configuración. **Solo comprueba presencia de variables; no acredita una consulta exitosa a la base.**

## Seguridad y entorno local

- Las credenciales están en `.env.local`, ignorado por Git y con permisos `600`. No pegar su contenido en chat, logs, commits ni archivos de traspaso.
- Se eliminaron los archivos temporales con el enlace de activación de Neon, el JWT de diagnóstico y el workflow importable que contenía el secreto real. El test temporal de diagnóstico también se eliminó.
- Capturas de evidencia sin secretos: `/tmp/turnia-evidencia/`. Pueden desaparecer; el estado de los servicios y este documento son el traspaso permanente.
- El Node global de la máquina es demasiado viejo. Usar el runtime disponible:

```bash
export PATH=/Users/axellabanarzubi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm test
npx eslint src
npm run build
# La prueba "live" contra Neon se reemplazó por tests contra un Postgres local descartable:
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnia_test npm test
```

## Orden para seguir

1. Leer `AGENTS.md`, este traspaso y `CONTEXTO_PROYECTO.md`; inspeccionar `git status` y `main` antes de modificar nada.
2. Resolver Neon y pasar la prueba real completa, incluida la limpieza sintética, sin pacientes ni avisos reales.
3. Probar la demo chat autenticada, una herramienta desde el agente y la llegada real del webhook firmado al panel. La voz y el micrófono todavía no se probaron.
4. Verificar persistencia, memoria, relaciones del panel, campañas y post-conversación contra la base real. El listado original de P1 no está totalmente cerrado.
5. Pedir al usuario que elija un número disponible cuando quiera habilitar WhatsApp. Autorizar ElevenLabs en Meta, importar, asignar agente y crear/aprobar templates. No contratar servicios ni migrar números por suposición.
6. Mantener los avisos n8n sin envío hasta que el usuario dé destino e instrucción. Activar campañas solo después de validar el canal y los destinatarios.
7. Retomar P2/P3 del contexto original: no se implementaron handoff real, recetas completas, cobertura, formularios, pagos, agenda avanzada, multiusuario ni el resto de funcionalidades futuras.
