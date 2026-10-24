# Agustín · piloto comercial odontológico

24/10/2026. Oferta elegida por Axel: **demo personalizada y después charla con él**, sin cotizar precios. El usuario pidió preparar todo y definir el gasto después: **no hay autorización para llamar todavía**.

## Uso

1. Administrador → **Comercial** (`/panel/comercial`). «Crear Agustín» busca la voz guardada **Agustin De Angelis - Confident and Happy**, crea dos herramientas comerciales y un agente separado de Sofi. Actualizarlo pausa el piloto. No inicia llamadas, compra números ni cambia agentes clínicos.
2. Cargar el consultorio con web, teléfono internacional argentino y contexto revisado. Agregar una ficha no scrapea la web ni contacta a nadie. El contexto comercial se edita en la ficha. El enlace «Abrir demo con su web» usa `/probar-demo?web=…`: al probarla, la demo existente lee esa web y ofrece la experiencia clínica.
3. Antes de ofrecer servicios por teléfono, revisar la posibilidad de contacto y **Registro No Llame**; o documentar el pedido de devolución de llamada. Guardar fuente y fecha. La publicación de un teléfono comercial no demuestra por sí sola permiso. La aplicación registra la revisión humana, **no consulta el padrón automáticamente**. La revisión vence a las 24 h.
4. Revisar saldo **compartido** en Twilio y disponibilidad/créditos de ElevenLabs. Definir cupo en US$, confirmar autorización de gasto y habilitar manualmente. La autorización vence al terminar el día en Buenos Aires. Valor inicial: **US$0 / pausado**. No hay recargas.
5. Abrir una ficha, revisar destino y marcar confirmación → «Iniciar una llamada». Una a la vez. La clave de solicitud impide duplicados por doble envío. El siguiente intento necesita nueva confirmación; no hay campaña ni reintentos automáticos.
6. El resultado y transcripción llegan por el webhook firmado existente. «Actualizar resultado» consulta ElevenLabs sin llamar. El interés queda anotado para seguimiento **manual de Axel**. No se envían WhatsApp, email ni Telegram automáticamente.

## Límites y costos

- Máximo remoto de **60 segundos**, silencio de 15 s, concurrencia 1, sin bursting, cola deshabilitada. Antes de cada llamada se comprueban voz, prompt, herramientas comerciales y duración del agente remoto.
- Se reserva **US$1 por intento**, incluyendo fallidos. Es un cupo preventivo para limitar cantidad de intentos, **no un precio ni un límite de facturación garantizado**: Twilio redondea y ElevenLabs cobra conversación y LLM según el plan. No se debe habilitar más que el saldo disponible. El panel no tiene las credenciales de Twilio para leer su saldo.
- No convertir créditos ElevenLabs a US$ sin consultar el plan. Historial muestra duración y créditos del proveedor; la factura Twilio se revisa en Twilio.
- Si el envío pierde confirmación, queda **incierto**, conserva la reserva y bloquea nuevos intentos. No volver a llamar por rutina. Revisar ElevenLabs/Twilio. Si existe conversación, copiar su ID público `conv_…` al campo de reconciliación: se valida agente e ID interno del intento. Si el proveedor nunca creó conversación, requiere revisión operativa del registro antes de desbloquear; no hay botón que libere a ciegas.
- «Pausar» evita nuevas llamadas; una ya iniciada termina con el límite remoto. No promete cortar una llamada en curso instantáneamente.

## Seguridad y bajas

- Todas las páginas y acciones requieren **administrador**. Los consultorios no ven Comercial.
- Tablas `sales_settings`, `sales_prospects`, `sales_calls`, `sales_suppressions`, con RLS, sin relación con pacientes ni turnos.
- Solo herramientas `registrar_resultado_comercial`, `registrar_baja_comercial` y `end_call`. Los webhooks comerciales requieren secreto de herramientas más token HMAC por intento (no se muestra en el panel). La baja se escribe antes de responder ok; interrupciones deshabilitadas durante la herramienta.
- Una baja bloquea el teléfono en todas sus fichas. También hay baja manual y detección conservadora de peticiones explícitas en la transcripción como respaldo; esta detección no sustituye probar el uso de la herramienta en conversación real.
- Las transcripciones comerciales se enrutan antes del servicio clínico: no crean pacientes ni tareas clínicas. ElevenLabs se configura sin grabación de audio y retención de 30 días para este agente; la base de Turnia conserva la transcripción hasta definir una política propia de borrado.
- No tocar WAHA, canal actual Telegram, Sofi, números/callbacks de HolaVeggie ni credenciales de la cuenta compartida.
- No reutilizar el teléfono de la prueba anterior que pidió no recibir llamadas. No guardar números de prospectos ni credenciales en este documento.

## Validación y próximos pasos

- Tests de integración con Postgres descartable y proveedor simulado: presupuesto cero/vencido, revisión de contacto, doble envío, concurrencia, timeout incierto, herramientas clínicas rechazadas, baja por token e idempotencia, webhook firmado sin pacientes, permisos y creación separada del agente.
- Verificado en navegador local: agregar ficha, llamada bloqueada con cupo cero y baja persistida con botón deshabilitado.
- **Pendiente de autorización:** gasto de piloto y destinatarios concretos revisados. Luego una prueba con Agustín (conversación, baja y end_call), y recién después el piloto de consultorios. La prueba previa de Sofi valida telefonía, no este guion comercial.
- Fuentes oficiales: [crear agente y configuración](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create), [end_call](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/end-call), [AAIP / No Llame](https://www.argentina.gob.ar/noticias/registro-no-llame-la-aaip-brinda-informacion-para-garantizar-el-cumplimiento-de-la-ley), [condiciones de Twilio Voice](https://www.twilio.com/en-us/legal/service-country-specific-terms/voice-sip).
