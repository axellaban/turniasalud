# Turnia Salud — traspaso de configuración

Actualizado el 21/10/2026, aproximadamente 12:30 (Argentina). Leer este archivo antes de continuar con `CONTEXTO_PROYECTO.md`.

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

## Bloqueo principal: `jwk not found`

No está resuelto. Se reprodujo tanto en pruebas locales como en producción:

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
RUN_LIVE_INTEGRATION=true SETUP_ELEVENLABS=true npx vitest run src/test/live.integration.test.ts
```

## Orden para seguir

1. Leer `AGENTS.md`, este traspaso y `CONTEXTO_PROYECTO.md`; inspeccionar `git status` y `main` antes de modificar nada.
2. Resolver Neon y pasar la prueba real completa, incluida la limpieza sintética, sin pacientes ni avisos reales.
3. Probar la demo chat autenticada, una herramienta desde el agente y la llegada real del webhook firmado al panel. La voz y el micrófono todavía no se probaron.
4. Verificar persistencia, memoria, relaciones del panel, campañas y post-conversación contra la base real. El listado original de P1 no está totalmente cerrado.
5. Pedir al usuario que elija un número disponible cuando quiera habilitar WhatsApp. Autorizar ElevenLabs en Meta, importar, asignar agente y crear/aprobar templates. No contratar servicios ni migrar números por suposición.
6. Mantener los avisos n8n sin envío hasta que el usuario dé destino e instrucción. Activar campañas solo después de validar el canal y los destinatarios.
7. Retomar P2/P3 del contexto original: no se implementaron handoff real, recetas completas, cobertura, formularios, pagos, agenda avanzada, multiusuario ni el resto de funcionalidades futuras.
