# Plan: conectar WhatsApp (oficial con Meta o WAHA para el MVP)

> Traspaso del 21/10/2026. **La opción B (WAHA + Custom Channel) ya está construida y probada con tests** (ver "Estado de la construcción"). Falta conectarla con los servicios reales: el usuario está comprando el chip.
> Leer antes: `AGENTS.md`, `TRASPASO_CONFIGURACION.md` y `CONTEXTO_PROYECTO.md`.

## Actualización de configuración del 22/10/2026

Speech to Text ya está habilitado y guardado en la clave de Turnia; la clave de Anthropic fue cargada por el usuario y la app la detecta. El teléfono todavía no fue colocado. El servicio existente `n8n/waha` se conservó intacto. Crear un proyecto separado fue rechazado por el límite de Easypanel; la alternativa de crear solo `n8n/turnia-waha` y el alta del Custom Channel están preparadas, pendientes de las confirmaciones del usuario. Ver el bloque más reciente de `ESTADO_Y_PRIORIDADES.md` antes de repetir pasos históricos.

## Estado

- No hay ningún número de WhatsApp conectado. `clinics.whatsapp_phone_number_id` está vacío, así que las campañas no envían.
- El agente de ElevenLabs (`agent_1101m5fg08ezfzrtbvw1rkmvn1df`) ya funciona en la demo web: chat probado en producción, voz todavía no.
- El usuario **eligió WAHA para el MVP** ("continuá con todo, voy a comprar un chip para instalar WAHA"): ya lo tiene en su VPS. El código está hecho; faltan el chip, las variables y la prueba real.

## Estado de la construcción (opción B, 21/10/2026)

Hecho y verificado contra un Postgres 16 local, con WAHA y ElevenLabs simulados (`src/test/waha.integration.test.ts`, 11 tests; `src/lib/waha.test.ts`, 11 unitarios):

- `clinics.whatsapp_provider` (`meta` | `waha`), elegible en Panel → Configuración. Recuadro "WhatsApp por WAHA" con las variables que faltan (solo nombres) y las dos URLs para copiar. El checklist del inicio del panel se adapta al proveedor.
- `src/lib/whatsapp.ts`: adaptador único (`sendPatientMessage`). Campañas, lista de espera (`offerFreedSlot`) y respuestas a pedidos (`resolveTask`) pasan por ahí. Por WAHA se manda el texto de `TEMPLATE_TEXTS` (los mismos del README); los no pedidos (recall, reactivación, ausentes, encuesta, personalizada) suman "respondé BAJA". Pausa con azar entre envíos (`WAHA_SEND_DELAY_MS`, 2 s por defecto) y el tope de 50 por corrida.
- Tablas `channel_conversations` (chat, conversación de ElevenLabs, campaña, contexto, transcripción) y `channel_events` (deduplicación de reintentos), en `schema.sql`. Se aplican solas en cada deploy de producción (`scripts/migrate-db.mjs`).
- `POST /api/waha/webhook`: HMAC SHA-512 (`X-Webhook-Hmac`, admite `X-Webhook-Hmac-Algorithm` sha512/sha256; verificado con el ejemplo de la doc de WAHA), solo evento `message`, ignora propios, grupos, estados y canales. Chats `@lid`: usa el teléfono que traiga el motor (`_data.key.remoteJidAlt`, `senderPn`, `Info.SenderAlt`) o lo pide a `GET /api/{session}/lids/{lid}`; si no aparece, no procesa. Audios: baja el archivo de WAHA y lo transcribe con Speech to Text (`scribe_v2`); si no puede, le pide al paciente que escriba. Fotos y archivos: le pide que lo cuente por escrito. Un lock por paciente evita abrir dos conversaciones con mensajes seguidos. Conversación nueva tras 15 min sin mensajes o después de `end_call`; un mensaje de campaña espera respuesta hasta 72 h y el agente recibe `conversation_context` (con el texto enviado) y `campaign_id`.
- `POST /api/elevenlabs/canal`: verifica la firma con `ELEVENLABS_CHANNEL_SIGNING_SECRET`, une los `agent_response`, pasa `**negrita**` a `*negrita*`, manda por WAHA al mismo chat, cierra con `end_call` y deduplica los reintentos. Si WAHA falla devuelve 502 (ElevenLabs reintenta); si la conversación todavía no está guardada, 409. Si el agente falla (`status: failed`) le pide al paciente que repita.
- La conversación se guarda en `conversations` mientras ocurre (canal WhatsApp, transcripción, campaña), se actualiza el destinatario de la campaña y al cerrar se avisa `conversacion.finalizada` a n8n. Si llega el post-call, ese la completa con resumen y no se pisa.
- `system__channel` con "custom" cuenta como WhatsApp (`sourceFromChannel`, `detectChannel`).

### A verificar con los servicios reales
1. Que el Custom Channel acepte las 11 `dynamic_variables` en cada turno y qué valor trae `system__channel` (se asumió que contiene "custom").
2. Si dispara el webhook post-call: si lo hace, la conversación queda con resumen; si no, queda con la transcripción que arma Turnia.
3. Que WAHA mande `X-Webhook-Hmac` con la clave de la sesión y el formato real del payload de su motor (NOWEB, GOWS o WEBJS), sobre todo `@lid` y `media.url`.
4. Si su WAHA es Core o Plus (Core puede no bajar audios) y si `media.url` apunta a una dirección pública. Si llega con `localhost`, Turnia la cambia por `WAHA_URL` (sin soporte para `WAHA_URL` con subruta).
5. Que la clave de ElevenLabs tenga permiso **Speech to Text** (la actual tiene ElevenAgents, Voices y Webhooks).
6. El tiempo de un envío de campaña: 50 mensajes × ~2 s ≈ 2 min, dentro del `maxDuration` de 300 s de `/api/automations`.

## Opción A — oficial: Meta Cloud API conectada a ElevenLabs

Es la que asume el código actual (`sendWhatsAppTemplate` en `src/lib/elevenlabs.ts`, templates en `clinics.templates`).

- El proveedor es **Meta** (WhatsApp Business Platform). No hay intermediario: ElevenLabs tiene integración nativa y gestiona el número con permiso del dueño.
- **Requisitos:**
  - Un portfolio de Meta Business administrado por el usuario.
  - Un número que no esté en la app de WhatsApp ni en otro proveedor.
  - Una tarjeta en WhatsApp Manager para templates y llamadas salientes.
- **Pasos:**
  1. ElevenLabs → Agents → WhatsApp → **Import account** (flujo de Meta).
  2. Asignar el agente.
  3. Copiar el *phone number ID* y pegarlo en panel → Configuración.
  4. Crear los 7 templates del README en WhatsApp Manager y esperar la aprobación.
- **Ventajas:** textos, audios con respuesta en voz, imágenes y documentos (credencial, órdenes), llamadas por WhatsApp. El webhook de inicio recibe `caller_id` y `called_number`, que es lo que ya lee `src/app/api/elevenlabs/initiation/route.ts`. No hay riesgo de bloqueo.
- **Costos:** Meta cobra los templates salientes; cuando el paciente escribe primero, las respuestas dentro de las 24 h no tienen costo de Meta. ElevenLabs cobra el uso del agente, más transcripción y voz si hay audios.
- Documentación: https://elevenlabs.io/docs/eleven-agents/whatsapp (índice en `https://elevenlabs.io/docs/llms.txt`; se lee con `curl …/docs/<ruta>.md`).

## Opción B — MVP no oficial: WAHA + ElevenLabs Custom Channel

WAHA (WhatsApp HTTP API) usa WhatsApp Web con un chip común. ElevenLabs **Custom Channel** (en alpha) conecta cualquier canal de texto al mismo agente. Así se conservan las 9 herramientas, el prompt y la memoria del paciente.

```
Paciente ──WhatsApp──► WAHA (VPS) ──webhook──► Turnia POST /api/waha/webhook
                                                  │ dynamic_variables = buildDynamicVariables()
                                                  ▼
                       ElevenLabs Custom Channel (async_message) → agente → tools de Turnia
                                                  │
Paciente ◄──WhatsApp── WAHA sendText ◄── Turnia POST /api/elevenlabs/canal (respuesta firmada)
```

### Custom Channel (verificado en la documentación el 21/10/2026)

- Se crea en el agente: **Channels → Custom Channel → Add trigger**, con la *Reply Webhook URL*. Devuelve tres valores: *Inbound Webhook URL*, *Inbound Secret* y *Outbound Signing Secret*.
- **Mensaje del paciente:** `POST {inbound_url}` (forma `/v1/convai/api-integrations/custom_channel/triggers/{trigger_connection_id}/async_message`), con el header `X-Webhook-Secret`. El body es:
  `{"data":{"type":"user_message","text":"…","user_identifier":"549…"},"user_message_id":"<id único, idempotencia>","conversation_id":"<opcional, para continuar>","dynamic_variables":{…}}`
  La respuesta es `202 {"conversation_id":"…","status":"queued"}`.
- **Respuesta del agente:** ElevenLabs hace `POST` a la reply URL con el header `ElevenLabs-Signature: t=…,v0=…`. Es el mismo HMAC-SHA256 de `{t}.{body}` que ya implementa `verifyWebhookSignature`, pero con el *Outbound Signing Secret*.
  - Body: `{"conversation_id","user_message_ids":[…],"status":"completed"|"failed","data":[{"type":"agent_response","event":{"agent_response":"…"}}, {"type":"agent_tool_response","event":{"tool_name":"end_call","status":"success",…}}],"error":null}`.
  - Hay que unir los `agent_response` del turno. Un `end_call` con `status: "success"` cierra la conversación.
  - ElevenLabs reintenta a los 0, 0,5 y 2 s; cualquier 2xx cuenta como recibido.
- **Limitaciones:** solo texto (sin adjuntos), no está disponible con Zero Retention Mode y es alpha.
- **Sin confirmar:** si dispara el webhook post-call (`/api/elevenlabs/post-call`) al terminar. Si no lo hace, las conversaciones de WhatsApp no llegan al panel con resumen y hay que guardarlas desde el reply webhook.
- **Sin confirmar:** si `dynamic_variables` tiene que mandarse en cada turno o solo en el primero. Mandarlas siempre (todas las de `buildDynamicVariables`), porque si falta una la conversación falla.

### Qué se construyó (plan original, ya hecho)

1. **Proveedor de WhatsApp configurable:** `clinics.whatsapp_provider` = `meta` | `waha`, editable en Configuración. Un adaptador en `src/lib/whatsapp.ts` con `sendText` (WAHA) y `sendTemplate` (Meta, el actual). `campaigns.ts`, `offerFreedSlot` y `tasks.ts` pasan por ese adaptador.
2. **Tabla `channel_conversations`**: `clinic_id`, `phone`, `elevenlabs_conversation_id`, `campaign_id`, `context`, `last_activity_at`, `closed_at`. Si pasan 15 min sin actividad o llega un `end_call`, se arranca una conversación nueva. Agregarla en forma idempotente a `schema.sql`.
3. **`POST /api/waha/webhook`:**
   - Verificar la firma de WAHA: HMAC configurable en el webhook de la sesión, que llega en el header `X-Webhook-Hmac`.
   - Procesar solo el evento `message`. Ignorar `fromMe`, grupos (`@g.us`) y estados.
   - `chatId` `549…@c.us` → teléfono con `normalizePhone`.
   - Audios: bajar el archivo de WAHA, transcribirlo con ElevenLabs Speech-to-Text y mandarlo como texto. En algunas versiones de WAHA bajar media requiere **Plus**: confirmar con el usuario qué versión tiene.
   - Llamar a `async_message` con `user_message_id` = id del mensaje de WAHA.
4. **`POST /api/elevenlabs/canal`:** verificar la firma, buscar el teléfono por `conversation_id` y mandar el texto por WAHA (`POST {WAHA_URL}/api/sendText` con `{session, chatId, text}` y el header `X-Api-Key`). Registrar el cierre si hubo `end_call`.
5. **Campañas por WAHA:** mandar el texto del template ya armado (los textos del README, con los `{{1}}`/`{{2}}` reemplazados) y guardar en `channel_conversations` el contexto y el `campaign_id`. Así, cuando el paciente responde, el agente recibe `conversation_context` y `campaign_id` como en el flujo de Meta. Mantener el límite de 50 por corrida y espaciar los envíos para bajar el riesgo de bloqueo.
6. Panel: Configuración (proveedor) y el checklist de inicio. README y traspaso.

### Riesgos (ya explicados al usuario)

- **API no oficial, contra los términos de WhatsApp:** el número puede quedar bloqueado. El riesgo crece con mensajes masivos a quien no escribió (recall, reactivación). Bien para un chip de prueba; no para el número principal de una clínica.
- Sin fotos ni documentos: credenciales y órdenes no funcionan por esta vía. Respuesta en voz a los audios solo si se agrega TTS y envío de audio por WAHA.
- Custom Channel en alpha: puede cambiar.

## Qué necesita el usuario (opción B)

- Variables de entorno en este entorno de la nube (para probar) y en Vercel, nunca pegadas en el chat: `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `WAHA_WEBHOOK_HMAC`.
- Después de crear el Custom Channel en ElevenLabs, también: `ELEVENLABS_CHANNEL_URL` (Inbound Webhook URL), `ELEVENLABS_CHANNEL_SECRET` (Inbound Secret) y `ELEVENLABS_CHANNEL_SIGNING_SECRET` (Outbound Signing Secret). La Reply Webhook URL es `https://turniasalud.vercel.app/api/elevenlabs/canal`.
- Si tiene WAHA Core o Plus.
- El chip vinculado a la sesión de WAHA (QR).
- En WAHA, el webhook de la sesión apuntando a `https://turniasalud.vercel.app/api/waha/webhook`, con el evento `message` y la clave HMAC.
