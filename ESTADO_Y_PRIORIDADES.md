# Turnia Salud — estado operativo y prioridades

Actualización: 23/10/2026 (Argentina). Este registro prevalece sobre los pendientes históricos de los otros documentos. No contiene credenciales.

## Canales y demo con Telegram — 23/10/2026

**Este bloque prevalece sobre todo el registro histórico que sigue.** El usuario resolvió WAHA por su cuenta y confirmó que funciona. Instrucción expresa: **dejar WAHA exactamente como está**; no cambiar motor, imagen, sesión, credenciales, webhook, conexión ni despliegue. La imagen derivada de la rama histórica `codex/waha-qr-refresh` no es la configuración actual y no se debe desplegar.

- La integración conversacional real es **WAHA → Turnia en Vercel → Custom Channel de ElevenLabs → Turnia → WAHA**. n8n solo recibe eventos de aviso. Despublicar n8n no pausa al bot.
- Por pedido urgente del usuario se publicaron dos reglas temporales Deny en el firewall del proyecto **turniasalud** de Vercel, rutas exactas `/api/waha/webhook` y `/api/elevenlabs/canal`. Ambas respondieron 403 y `/api/health` siguió 200, `database: "ok"`. No se modificó WAHA.
- Objetivo confirmado: `/probar-demo` recibe la web del interesado, abre el canal elegido, lee esa web, arma una clínica temporal y permite chat, notas de voz de ElevenLabs o llamada. Para Telegram la llamada es mediante el enlace web existente; la API de bots no inicia llamadas nativas.
- Bot elegido por el usuario: **@TurnIA_salud_bot**. Confirmó que guardó `TELEGRAM_BOT_TOKEN` como Secret de Production en Vercel y realizó un redeploy. No se copió su valor al chat, repositorio ni entorno local.
- Código implementado y validado localmente en `codex/telegram-demo` (**146 pruebas con Postgres 17 descartable**, TypeScript, lint y build correctos; servicios externos simulados): selector **Pausado / Telegram / WhatsApp** en Panel → Configuración, adaptador de Telegram, webhook autenticado, enlace `/start` con token opaco para asociar la web, mismo agente y TTS/STT de ElevenLabs. La nueva tabla `messaging_settings` comienza en **pausado**. Cambiar de canal termina las demos previas y descarta respuestas pendientes mediante una revisión persistida.
- Para habilitar Telegram: publicar el código con CI correcto, comprobar la migración automática y el estado pausado, conectar el bot desde el panel, elegir Telegram y guardar. **Retirar las dos reglas temporales del firewall solo después de comprobar que el selector del código está publicado y WhatsApp permanece pausado.** La regla de `/api/elevenlabs/canal` también bloquearía las respuestas de Telegram; no dejarla activa al probar. No modificar reglas de seguridad ajenas a esas dos.
- El workflow [Turnia · Eventos (avisos al equipo)](https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q) permanece despublicado, sin nodos modificados, ejecuciones ni envíos. Gmail, campañas y destinatarios asistenciales siguen pendientes por elección del usuario.
- Prueba real pendiente: landing con web → Iniciar en Telegram → ficha de clínica → chat → audio entrante y respuesta con la voz → llamada web → MENU/SALIR; verificar registro en Panel → Pedidos de demo. No regenerar los siete audios de la web ni modificar permisos/voces de ElevenLabs.

## Diagnóstico histórico de vinculación WAHA del 23/10 (superado por la configuración del usuario)

- El usuario ya tiene la línea activada en WhatsApp Business en un iPhone. Confirmó que puede vincularla con WhatsApp Web oficial, pero WAHA muestra en el teléfono «no se pueden vincular dispositivos en este momento». Hay dos dispositivos vinculados y el rechazo de WEBJS fue inmediato. No hay evidencia suficiente para atribuirlo a una cuenta nueva, una prohibición o un passkey.
- Se trabajó únicamente sobre **`n8n/turnia-waha`**. No se modificaron `n8n/waha`, amoblaia, Supabase, ElevenLabs ni los audios. No se enviaron mensajes ni se contrataron planes.
- Se probó NOWEB con `WAHA_NOWEB_WA_VERSION=auto-web` y se comprobó en registros que tomó una versión más reciente. El iPhone rechazó QR y código, incluido un código solicitado con formato internacional correcto. GOWS 2026.9.2 tampoco se vinculó. Su registro mostró `Event=timeout`, `Error=null`, sin un motivo específico de rechazo ni desafío de passkey. Se comprobó por hash que el QR del dashboard coincidía con el de la API; eso no equivale a una vinculación.
- Motor actual **WEBJS**, basado en la imagen oficial WAHA 2026.9.2 CORE con Chromium. Límites actuales: **0,5 CPU / 768 MB** dentro del mismo VPS; se amplió solamente el límite de memoria de Turnia desde 512 MB. Se conservaron dominio, almacenamiento, webhook y valores privados existentes. No se observaron reinicios ni `OOMKilled` en las comprobaciones efectuadas.
- **Error real encontrado en WEBJS:** `TypeError: window.require(...).Cmd.refreshQR is not a function`. La captura de Chromium mostraba «Select to reload QR code» mientras el dashboard aún decía `SCAN_QR_CODE`. No pedir escaneos basándose solo en ese estado.
- Se creó y desplegó una imagen derivada con un cambio puntual de esa llamada al método `WAWebLaunchSocketUtils.refreshQR`, que la propia biblioteca instalada ya usa en otro flujo. [Dockerfile y comprobaciones](infra/waha/Dockerfile), [explicación y operación](infra/waha/README.md). El contenedor desplegado confirmó cero llamadas antiguas y dos al método nuevo; el build incluye comprobación de sintaxis. Después del despliegue hubo un timeout al esperar el estado inicial; se cerró el intento nunca vinculado y se reinició únicamente `default` para probar desde un perfil limpio. La API empezó a entregar QR diferentes y no reapareció el error de refresco en los registros nuevos revisados.
- **Segundo hallazgo:** el PNG del diálogo abierto del dashboard no coincidía con el PNG actual de la API. Al tocar el botón de actualización junto a «QR» se comprobó que ambos hashes coincidían. El diálogo abierto puede conservar una referencia anterior: actualizarlo antes de pedir un escaneo y mantenerlo vigente durante la prueba.
- En el intento con la imagen actualizada, el usuario informó que el iPhone pasó a **«Iniciando sesión»**. A las **12:44:50 Argentina**, WAHA registró cierre de sesión y desconexión, con motivo **`LOGOUT`**, y cerró Chromium. La API confirmó **`FAILED`, sin cuenta vinculada**. Se pidió al usuario el resultado final en el teléfono y que no repitiera el escaneo. No afirmar que el canal quedó conectado.
- Última comprobación de producción: `database: "ok"`, `configured.waha: true`, `demo.base: true`, `demo.claude: true`, **`demo.whatsapp: false`**. Ningún motor llegó a `WORKING`; la demo completa y el intercambio real de mensajes siguen pendientes.
- **Credenciales:** durante el diagnóstico se mostraron accidentalmente valores privados en salidas de herramientas. No están en este repositorio. Deben rotarse en los servicios correspondientes y sus destinos privados al cerrar la configuración, con intervención del usuario para el cambio de credenciales. No volver a emitir el entorno completo, ni incluir claves en capturas, documentación o chat.
- Gmail y campañas siguen pospuestos. No regenerar audios ni cambiar ElevenLabs sin que el usuario lo retome.

## Actualización posterior del 22/10: infraestructura WAHA y Custom Channel preparados

Este bloque prevalece sobre las comprobaciones anteriores de esta misma fecha:
- El usuario cargó la clave de Anthropic en Vercel. Comprobado `/api/health`: `database: "ok"`, `demo.base: true`, `demo.claude: true`, `demo.whatsapp: false`. La presencia de la variable no confirma todavía una extracción real con Claude.
- Speech to Text habilitado y guardado en la clave existente «Turnia Salud · Vercel», después de la confirmación explícita del usuario. ElevenLabs mostró «API key updated successfully» y, al reabrir la clave, Speech to Text → Access seguía seleccionado. Text to Speech y los demás permisos no se cambiaron; límite de 25.000 créditos conservado.
- El usuario todavía no puso el teléfono de Turnia. Se puede preparar la infraestructura; la vinculación y prueba de WhatsApp requieren el QR y ese celular.
- WAHA existente: Easypanel confirma `n8n/waha`, habilitado, imagen `devlikeapro/waha:noweb`, con almacenamiento persistente. Esto no confirma que una sesión esté conectada. No se modificó ese servicio ni se copiaron sus credenciales a otro proyecto.
- Easypanel rechazó crear otro proyecto con `You are not allowed to create more projects`. Después de la **autorización explícita del usuario**, se creó únicamente `n8n/turnia-waha`, con imagen `devlikeapro/waha:noweb`, volúmenes propios `/app/.sessions` y `/app/files`, claves nuevas y límites de **0,5 CPU / 512 MB**. No se modificaron los otros servicios. Verificados límites y 1 contenedor activo de 1 esperado.
- Servicio exclusivo: `https://n8n-turnia-waha.b6mgbu.easypanel.host`. Sesión `default`, motor NOWEB, inicio automático y webhook global de evento `message` a `https://turniasalud.vercel.app/api/waha/webhook`, con HMAC y reintentos. La API autenticada respondió 200. Sin teléfono, se encontró `FAILED`; un reinicio exclusivo de esta sesión la llevó a **`SCAN_QR_CODE`**, sin `me.id`. Esto comprueba que puede pedir vinculación, **no que WhatsApp esté conectado**. Si vence el QR, reiniciar esa sesión cuando el usuario tenga el teléfono listo.
- Custom Channel de ElevenLabs: conexión **«Turnia · WhatsApp WAHA»** y trigger **User message** creados con confirmación explícita. Reply Webhook URL: `https://turniasalud.vercel.app/api/elevenlabs/canal`. Las tres credenciales generadas se cargaron directamente en Vercel como secretos de Production.
- Vercel: guardadas `WAHA_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC`, `WAHA_SESSION=default`, `ELEVENLABS_CHANNEL_URL`, `ELEVENLABS_CHANNEL_SECRET` y `ELEVENLABS_CHANNEL_SIGNING_SECRET`, todas como secretos de Production. [Redeploy comprobado Ready](https://vercel.com/labans-projects-c5c64fdc/turniasalud/5LeKt2uu348Lem2R4SzrqYoRAvFm). Panel → Configuración: proveedor WAHA guardado y persistencia comprobada al recargar; seis variables obligatorias en verde.
- Verificación después del deploy: `/api/health` → `database: "ok"`, `configured.waha: true`, `demo.base: true`, `demo.claude: true`, `demo.whatsapp: false`. Un evento sintético `session.status`, que el receptor ignora sin enviar mensajes, respondió 200 con HMAC correcto y 401 «Firma inválida» sin firma. No se probó todavía una entrega real de mensajes desde WAHA ni una respuesta de ElevenLabs.
- Para retomar: colocar el chip y activar WhatsApp en el celular, abrir el dashboard del **nuevo** servicio, entrar con los campos `WAHA_DASHBOARD_USERNAME` / `WAHA_DASHBOARD_PASSWORD` de **n8n/turnia-waha → Environment** y vincular `default` con el QR. La clave de API está en `WAHA_API_KEY`, en ese mismo servicio; no usar las credenciales de `n8n/waha` ni pegarlas en chat. Luego verificar `WORKING`, `demo.whatsapp: true` y el recorrido completo del lead magnet.
- El navegador no pudo observar la pestaña de error de la URL de WAHA: su política de seguridad rechazó el acceso. No se intentó eludir el bloqueo con otro navegador ni con peticiones directas a ese servicio. La revisión de configuración se hizo mediante el conector de Easypanel.
- Gmail y campañas siguen pospuestos. No se enviaron mensajes ni se contrataron planes.

## Revisión del 22/10/2026: últimos cambios y orden de trabajo

Se revisó `main` hasta `746d903` (PR #6 y #7). CI de esa versión: **123 tests correctos**, TypeScript, lint y build aprobados. Vercel marca el commit como publicado correctamente.

Comprobado por HTTP el 22/10: `/api/health` devuelve 200, `database: "ok"`, `demo.base: true`, `demo.whatsapp: false`, `demo.claude: false`, `demo.llamada_telefonica: false`; los siete JSON de audio siguen devolviendo 200. `/probar-demo` devuelve 200 y muestra «La demo por WhatsApp se habilita en breve».

Orden recomendado para la próxima sesión con navegador:
1. Revisar Speech to Text de la clave existente en ElevenLabs; Text to Speech ya se habilitó y se probó generando los siete audios. No crear otra clave si no hace falta.
2. Configurar la clave de Anthropic en Vercel y comprobar acceso/saldo, sin contratar planes ni recargar. Es para extraer la ficha completa de la web; el código tiene un perfil básico si falta Claude. `demo.claude: true` solo comprobará la presencia de la variable, no una llamada exitosa: hay que hacer una extracción real después.
3. Conectar WAHA y el Custom Channel del agente, cargar sus variables y probar el chip. Es el bloqueo que mantiene deshabilitado el botón de `/probar-demo`.
4. Con el canal listo, probar la nueva demo de punta a punta: web → ficha → chat y reserva ficticia → MENU → audio → MENU → llamada web → SALIR; comprobar un único interesado con sus conversaciones en el panel. Los tests actuales simulan esos proveedores.
5. Dejar Gmail pospuesto según el pedido del usuario. Campañas y avisos asistenciales requieren canal validado y destinos acordados.

`demo.llamada_telefonica: false` es opcional: sin Twilio, la nueva demo usa un enlace de llamada desde el navegador. No contratar telefonía para cerrar el MVP.

La actualización automática de `schema.sql` en los builds de producción ya está implementada y `demo.base: true` confirma que la tabla de la demo existe. No repetir la carga manual de SQL por rutina.

## Trabajo autónomo del 22/10: lead magnet

Se reforzó el código de `/probar-demo`: lector con DNS fijo y límites reales de bytes/tiempo, cuota y creación de demos bajo transacción, reintentos idempotentes, análisis único, cancelación sin clínicas huérfanas, máximo de tres llamadas por demo y cierre de la captura temporal del micrófono. Los textos aclaran que las conversaciones y la agenda son simuladas. Detalle, benchmark de cuatro webs y verificación en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md#revisión-y-endurecimiento-del-22102026).

Verificación local: **137 tests correctos** con Postgres 17 descartable; TypeScript, lint y build correctos. No se usaron API pagas en las pruebas. CI del [PR #9](https://github.com/axellaban/turniasalud/pull/9) aprobada: **137 tests** con Postgres 16, TypeScript, lint y build. Integrado en `main` como `e8f171c`. Vercel confirma el deploy de producción [`3WMXBJUTw8ro8hQhFfkXtxxprweE`](https://vercel.com/labans-projects-c5c64fdc/turniasalud/3WMXBJUTw8ro8hQhFfkXtxxprweE).

Consolas revisadas sin modificar credenciales:
- Anthropic: saldo positivo, recarga automática desactivada; ninguna clave exclusiva de Turnia. Crear `turnia-demo-web` requiere confirmación de seguridad en ese momento.
- ElevenLabs: Text to Speech habilitado; Speech to Text confirmado en No Access. Habilitarlo amplía permisos y requiere confirmación de seguridad en ese momento. Se canceló la edición.
- WAHA: el servicio existente está asociado a otro flujo. No se cambió su configuración ni se reutilizaron sus claves. Falta un servicio/sesión exclusivo y la vinculación del chip mediante QR.
- Gmail sigue pospuesto por pedido expreso del usuario.

La Mac se bloqueó al intentar abrir la consola del deploy; no se intentó desbloquearla automáticamente ni se continuó operando esa consola. La comprobación final se hizo mediante el estado de Vercel y HTTP: salud 200 con `database: "ok"` y `demo.base: true`; siete JSON 200 y siete MP3 206 con Range; `/panel/demos` y `/demo` → 307 al login; API de token del panel → 401 sin sesión; enlace de llamada inválido → 404. `/api/waha/webhook` devuelve 500 «Webhook sin configurar», coherente con que todavía no está conectado. Los textos nuevos ya aparecen en `/probar-demo` y `/escucha-a-nuestros-agentes`. La base y el servidor locales de prueba quedaron detenidos.

Estas confirmaciones no se pueden suplir con la instrucción de avanzar mientras el usuario duerme. No se contrataron planes ni se recargó saldo.

## Prioridad 1: cerrar la demo y la captación de interesados

- [x] Neon responde `database: "ok"`; proyecto exclusivo de Turnia, base `neondb`, rama principal `br-cold-wildflower-b6ubnhi1`.
- [x] Siete audios generados desde el panel y guardados en `web_audios`. Las siete URLs `/api/audios/<slug>.json` responden 200 con un segmento por línea del guion. Duración total: 1.089,09 segundos (18:09,09).
- [x] Voces configuradas en Production: Sol para Sofi y Agustín para el paciente. No usar la detección de favoritas: la cuenta no las devolvía. La clave existente tiene Text to Speech, Voices Write y límite de 25.000 créditos.
- [x] Analytics de ElevenLabs, filtrado Text to Speech, muestra **7,05K créditos, 17,6K caracteres y 18 minutos** para los siete audios. Equivalente aproximado prorrateado: US$1,41 por el lote, sin cargo adicional.
- [x] El usuario contrató Starter por su cuenta. La muestra `home` consumió 1.031 créditos por 156,71 segundos y 2.578 caracteres. US$0,21 es el equivalente prorrateado de un abono de US$6/30.000 créditos, no un cargo adicional. Medir cada tanda en Analytics filtrando Text to Speech; no mezclar los minutos del agente.
- [x] Reproducción real y transcripción sincronizada comprobadas en la home y en Pediatría. Los siete MP3 cargan en el navegador.
- [x] La demo por voz conecta, emite el saludo de Sofi y termina. Su webhook real creó en el panel la conversación `7480ec7b-414d-472b-b80f-7eef39c18fdb`, con transcripción y resumen. **Esto no valida una conversación hablada completa ni el reconocimiento del micrófono con una persona.**
- [x] n8n: rama `lead.nuevo` agregada y publicada en el workflow existente `PEaOkLPBrLIfFE0Q`, después de la verificación del secreto. Aviso por la conexión Gmail existente a `axellaban@gmail.com`, con enlace a `/panel/demos`. No incluye datos clínicos ni el texto libre del formulario en el correo. Las otras ramas siguen sin envío.
- [x] Esquema de seguimiento aplicado en Neon con el `schema.sql` completo: 62 sentencias sin errores. Agrega a `leads` estado, notas y fecha de actualización; no se ejecutó seed.
- [x] Bandeja `/panel/demos` publicada por el PR #5 (merge `35840bd`). Deploy comprobado en ese cierre: `2FEsHc3xyKH8A7GPSTUhAo4Sr3HY` (después hubo publicaciones nuevas). Permite búsqueda, filtros, estados y notas internas. El pedido de prueba apareció y quedó Descartado; las notas persisten al recargar. Sin sesión devuelve 307 al login. TypeScript, lint, 62 tests locales y build pasan; CI con Postgres descartable: **98 tests correctos**.
- [x] Formulario público → registro en bandeja verificado en producción, con un único pedido ficticio: `Prueba técnica Turnia · no contactar`, `prueba-turnia@example.com`, sin teléfono. Se conserva Descartado como evidencia; no se borró nada.
- [ ] **Bloqueo de email: reconectar Gmail.** La ejecución real de n8n **50206**, 21/10/2026 19:21 Argentina, verificó el secreto y la ruta `lead.nuevo`, pero falló en Gmail con `The credential "Gmail account" needs to be reconnected. (item 0)`. El aviso no fue enviado. La credencial existente figura Account connected, pero su refresh falla. Se abrió su diálogo en Chrome; el usuario debe usar Switch account para reconectar el remitente correcto. No se cambiaron credenciales ni permisos. Después, reintentar **50206** una sola vez (con el workflow actual), verificar Succeeded y recepción a `axellaban@gmail.com`; no crear otro lead. **El usuario pidió dejar Gmail pendiente por ahora. No reconectar ni reintentar envíos sin que lo retome.** Los pedidos siguen guardándose en la bandeja.

## Prioridad 2: conectar WhatsApp y validar el circuito real

- [x] Servicio WAHA exclusivo en el VPS y variables privadas preparados; ver bloque operativo de arriba. Falta vincular el chip por QR.
- [x] Custom Channel y trigger del agente creados; sus valores están en los campos correctos de Vercel, sin valores en chat ni documentación.
- [x] Webhook global HMAC configurado y proveedor WAHA guardado en el panel. El receptor acepta firma válida y rechaza firma ausente.
- [ ] Vincular el teléfono con QR y comprobar sesión `WORKING` antes de probar texto, audios entrantes, turnos, cancelación, memoria, recetas y derivación a recepción. Speech to Text ya está habilitado; su uso real todavía no fue probado.
- [ ] Definir los destinos de avisos asistenciales; la autorización de email de esta sesión es para pedidos comerciales de demo, no para enviar datos de pacientes.
- [ ] Activar campañas solamente después de validar el canal, los destinatarios y la baja de mensajes. Workflow `g0H8xbQvRNv5FxQj` continúa desactivado.

## Prioridad 2b: lead magnet "Probá la demo con tu web" (después de WAHA)

- [x] Landing `/probar-demo`, flujo por WhatsApp, lectura de la web, ficha con Claude, clínica temporal y modos llamada/audio/chat. Tests de integración con servicios simulados. Detalle en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md).
- [x] Unido a `main` (PR #6) y publicado: `/api/health` → `demo.base: true` (la base se actualizó sola en el deploy). El número de la landing sale solo de WAHA.
- [ ] **Prueba real pendiente:** Anthropic, permisos de ElevenLabs y conexiones de WAHA ya están preparados. Vincular el teléfono y probar extracción, chat, audio, llamada web y SALIR. Checklist en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md#puesta-en-marcha-lo-que-queda-para-la-próxima-ia).

## Prioridad 3: primera clínica y ampliaciones

- Cargar datos y protocolos reales de la clínica; hoy sigue el centro ficticio de demo. No reemplazar datos por suposición.
- Hacer una conversación hablada completa con una persona, comprobar una herramienta y el registro final; el circuito de reserva por chat ya tuvo una prueba anterior exitosa.
- Revisar acceso, consentimiento, conservación de datos y los textos de privacidad antes de usar pacientes reales. No activar Zero Retention a ciegas: el plan de Custom Channel documenta incompatibilidad.
- Configurar derivación telefónica si se elige teléfono de recepción. Agendas externas, roles por clínica, admisión digital y cobranzas son ampliaciones posteriores.
- Video propio del hero, casos reales y precios: pendientes de contenido; la web usa una foto de respaldo.
- Dependencias de desarrollo: `npm audit` reportó cinco entradas de severidad alta en la cadena de ESLint/fast-glob/micromatch/braces. `braces` 3.0.3 sigue siendo la última versión consultada; no se aplicó el `--force` que propone bajar `eslint-config-next` a Next 14. No forma parte del servidor publicado. Revisar al salir una corrección compatible.

## Continuidad sin computer use

El código y los tests se pueden continuar desde el repositorio. Los accesos a consolas permanecen en las sesiones del navegador del usuario. n8n permite buscar los workflows por MCP, pero su detalle no está habilitado por MCP; se editó desde la UI sin ampliar ese acceso. No tocar proyectos ajenos a Turnia ni contratar planes. Las credenciales no se copian a este documento.

## Referencias de esta entrega

- App: https://turniasalud.vercel.app/panel/demos
- PR integrado: https://github.com/axellaban/turniasalud/pull/5
- CI aprobado (98 tests): https://github.com/axellaban/turniasalud/actions/runs/39685558750
- Producción comprobada: https://vercel.com/labans-projects-c5c64fdc/turniasalud/2FEsHc3xyKH8A7GPSTUhAo4Sr3HY
- Ejecución de email pendiente de reconexión: https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q/executions/50206
