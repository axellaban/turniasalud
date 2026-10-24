# Sofi · piloto comercial odontológico (antes Agustín)

24/10/2026. Oferta elegida por Axel: **demo personalizada y después charla con él**, sin cotizar precios. Después de la preparación, autorizó **US$5 por día** y **una única primera prueba a su teléfono**. Esa prueba ya terminó. No habilita llamadas a prospectos ni reintentos sin destinatarios autorizados.

## Editor del agente comercial — 24/10/2026

- **Panel → Comercial → «Editar saludo, instrucciones y voz»** (`/panel/comercial/configuracion`). El saludo y el system prompt se editan completos desde el panel y se guardan en `sales_settings`, junto con la voz y la versión aplicada. El código solo aporta el texto inicial cuando todavía no hay una versión guardada.
- **«Guardar y aplicar en ElevenLabs»** actualiza el mismo agente comercial y consulta de nuevo su configuración real antes de confirmar. Siempre pausa el piloto y conserva el cupo. No llama, recarga saldo ni modifica la recepcionista clínica.
- Cada aplicación conserva una versión en `sales_config_versions`; **«Restaurar la versión anterior»** recupera saludo, prompt y voz, los comprueba y agrega otra versión sin borrar historia. Cambiar de voz/sincronizar conserva el texto editado. La ficha de cada llamada registra `config_version`; las llamadas anteriores al editor quedan con versión 0.
- Los formularios viejos se rechazan por número de versión, y el borrador permanece visible si hay error. Si una aplicación parcial no se puede comprobar, queda `needs_sync` y el piloto pausado hasta guardar/aplicar de nuevo. No se reserva ni inicia un intento con esa marca.
- Las variables internas, las herramientas comerciales, el límite de duración y las reglas operativas se mantienen fuera del editor. El saludo admite `{{business_name}}`; las instrucciones también `{{sales_context}}`. No pegar claves en el prompt.
- La validación previa a llamar compara el **texto guardado** con el remoto, en vez de exigir el texto fijo del código. Antes de enviar, vuelve a comprobar que no cambió la versión. Ediciones directas en ElevenLabs siguen requiriendo reconciliar desde el panel.
- Las fichas muestran **el motivo concreto** del bloqueo (pausa, autorización vencida, cupo agotado, contacto sin revisar/vencido, baja, llamada pendiente, línea ausente o aplicación sin comprobar), con enlace al paso que lo resuelve. El panel no consulta el saldo de Twilio ni los créditos de ElevenLabs: hay que comprobarlos por separado.
- Validación: **232 pruebas** (21 comerciales de integración y 4 de bloqueos), TypeScript, ESLint y build. Navegador local con base y proveedor simulados: error conserva borrador, edición y restauración funcionan y muestran versión/confirmación. Sin llamadas reales para esta implementación.

## Twilio observado durante este cambio

El usuario pidió abrir el registro. Se dejaron **Call Logs**, filtrado por la línea de Turnia, y **Recording Logs**. Aparece una llamada posterior iniciada fuera de este trabajo: **24/10/2026 19:03:19 Argentina, Completed, 63 s**. No se inició ninguna desde esta tarea. Twilio muestra **cuenta suspendida por falta de fondos**, saldo **−US$0,49524**. No se recargó ni se tocó la configuración de HolaVeggie. La cuenta comparte saldo por decisión expresa del usuario; esto requiere atención del titular. Sofi comercial sigue sin grabación de audio; no se activó grabación ni escucha en vivo.

## Cambio vigente — misma voz de Sofi y pitch breve

El usuario pidió usar la misma voz de la recepcionista y mejorar la venta. El agente comercial pasa a presentarse como **Sofi**, conservando su ID `agent_4501m5qvpjwrfcxrafq64zmx0y0q`. El botón **«Usar la voz de Sofi y aplicar pitch»** lee la voz real del agente de la clínica principal (`ijxn8I4NzJccD2Sa7lcj`), independientemente de la clínica seleccionada en el navegador, y la aplica solo al comercial. No modifica la recepcionista. Prepararlo siempre pausa el piloto; no llama.

El saludo pide veinte segundos. Ante un «sí», avanza sin repetir identidad ni permiso. Hace una sola pregunta sobre quién responde los mensajes, conecta con esa necesidad y ofrece la demo con la web + charla con Axel. No lee etiquetas emocionales, inventa métricas/precios ni insiste ante un rechazo. Busca cerrar antes de 45 s; conserva el límite remoto de 60 s de conversación más despedida. **El pitch nuevo no tiene una prueba telefónica real todavía**; la prueba histórica de abajo fue con Agustín/Mauricio.

**Mismo número:** Comercial → «Consultorios y pruebas» → «Abrir ficha y llamar» en «Consultorio de prueba de Axel». Revisar contacto/contexto, marcar la confirmación y «Iniciar una llamada». Para otro intento, reabrir la ficha y confirmar otra vez; si hay un intento pendiente, actualizar el resultado primero.

**Número nuevo:** Comercial → «Agregar consultorio o número de prueba» → nombre, teléfono internacional, web, contexto y fuente/fecha de revisión → guardar → abrir la ficha → confirmar la llamada. Guardar una URL no scrapea ni contacta al consultorio.

Antes: comprobar saldo de Twilio y créditos ElevenLabs, autorizar hasta **US$5 de cupo diario** y habilitar llamadas manuales hoy. El cupo no carga saldo. **Sigue pausado** por el último saldo observado insuficiente (US$0,21916); no se recargó ni se inició otra llamada en este cambio. El historial anterior se conserva, con etiqueta genérica «Agente» para no atribuir a Sofi las palabras de Agustín.

Validación del cambio: **217 pruebas**, incluidas 15 comerciales; TypeScript, ESLint y build. Casos nuevos: migración del agente existente a la voz clínica sin llamadas, presupuesto conservado/pausa y bloqueo de cambios sobre un agente de clínica.

## Primera prueba real — 24/10/2026

- El usuario indicó nuevamente su teléfono terminado en 4245 para esta prueba propia. Se documentó la autorización nueva en la ficha comercial **«Consultorio de prueba de Axel»**, sin tratarlo como prospecto real ni como permiso permanente de prospección. Ficha `e01dfd36-ef19-4dde-9528-8ae204068774`.
- Se configuró el cupo de hoy en **US$5**, con saldo existente y sin recargas. El permiso de US$5/día queda como preferencia del usuario; el panel mantiene la habilitación diaria y vence al terminar el día en Buenos Aires. No hay renovación de llamadas ni campañas automáticas.
- **Un solo intento**, aceptado y atendido: conversación `conv_1901m5qwas11fwbs64wsk8kemn5e`, Twilio `CAaed38ff64babca82e4df59a539c44b47`. Agustín usó la voz Mauricio, presentó Turnia y ofreció la demo personalizada. El usuario confirmó **«La voz se escuchó bien»**.
- Duración real **65 s**; terminó automáticamente con `Conversation has exceeded maximum duration`. La configuración es de 60 s de conversación, pero la despedida/cierre añadió unos 5 s. **No prometer un corte telefónico exacto a los 60 s** ni presupuestar una sola unidad de Twilio para este ajuste.
- Cargo del registro de llamada Twilio: **US$0,7056**, equivalente a dos minutos facturados. ElevenLabs: **452 créditos**. No convertir esos créditos a US$ sin verificar el plan. La reserva preventiva del panel es **US$1** y no una factura.
- Resultado y transcripción guardados en Comercial mediante «Actualizar resultado». No se aceptó la demo antes del cierre y no hubo llamadas a herramientas comerciales: **registro de interés, baja y `end_call` todavía necesitan prueba conversacional real**, aunque sus pruebas de integración pasaron.
- Twilio tenía **US$0,93356** antes y mostró **US$0,21916** después; el saldo es compartido y no se atribuye toda su variación al registro de voz sin revisar los otros cargos. Auto-recharge sigue desactivado. El saldo restante no alcanza otro minuto a este móvil (~US$0,3528/min de voz).
- **Estado final: piloto pausado por saldo insuficiente para otro intento, cupo conservado US$5, reserva US$1.** No recargar, cambiar planes ni tocar HolaVeggie. Para continuar, el usuario debe resolver saldo disponible por su cuenta y definir los próximos destinatarios. No repetir la prueba por rutina.

## Estado de la primera prueba (histórico; prevalece el cambio vigente de arriba)

- Panel publicado: https://turniasalud.vercel.app/panel/comercial (PR #41 y corrección #44, ambos con CI y Vercel en verde).
- **Agente creado:** `agent_4501m5qvpjwrfcxrafq64zmx0y0q`, «Turnia · Agustín · ventas odontología».
- **Voz elegida expresamente por el usuario y aplicada:** «Turnia · Mauricio · comercial» (`jIgvw3W75cbd6IP0JYwL`), agregada desde la biblioteca con moderación en vivo desactivada y multiplicador estándar 1. No se cambió el nombre Agustín ni la voz clínica.
- Verificado por API real y por el panel después de recargar: 60 s, concurrencia 1, máximo 20 conversaciones/día, sin bursting, cola deshabilitada, LLM conversacional `gpt-4.1-mini`, análisis heredado `gemini-2.5-flash`, sin grabación de audio y retención ElevenLabs de 30 días. La comprobación que corre antes de llamar (`verifySalesAgent`) pasó contra el agente real.
- **Piloto pausado, cupo US$5 y reserva US$1**, tras una prueba propia autorizada y confirmada. Ver el cierre más reciente arriba. No se autorizaron ni iniciaron campañas o llamadas a consultorios reales.
- Base `ok`, 6 clínicas; demo sigue en Telegram, WhatsApp pausado. Configuración de Sofi comparada por hash antes/después: idéntica. WAHA, n8n y Twilio de otros negocios no se modificaron.
- 213 pruebas en verde (13 comerciales), TypeScript, ESLint y build. Endpoint comercial sin secreto devuelve 401. En navegador: agente y voz persisten al recargar y cupo cero sigue visible.
- **Próximo paso:** resolver saldo disponible con el usuario (sin recargas por el agente), revisar destinatarios y probar herramientas comerciales/cierre antes del piloto real. No usar «Send Test Call» sin variables: el panel envía las cuatro variables comerciales obligatorias. El número propio de prueba requiere pedido explícito para cada nueva prueba y no se usa para prospección.

## Uso

1. Administrador → **Comercial** (`/panel/comercial`) → «Usar la voz de Sofi y aplicar pitch». Actualiza el agente comercial existente y lo pausa, sin tocar la recepcionista ni iniciar llamadas. El selector de otras voces está dentro de «Elegir otra voz guardada».
2. Cargar el consultorio con web, teléfono internacional argentino y contexto revisado. Agregar una ficha no scrapea la web ni contacta a nadie. El contexto comercial se edita en la ficha. El enlace «Abrir demo con su web» usa `/probar-demo?web=…`: al probarla, la demo existente lee esa web y ofrece la experiencia clínica.
3. Antes de ofrecer servicios por teléfono, revisar la posibilidad de contacto y **Registro No Llame**; o documentar el pedido de devolución de llamada. Guardar fuente y fecha. La publicación de un teléfono comercial no demuestra por sí sola permiso. La aplicación registra la revisión humana, **no consulta el padrón automáticamente**. La revisión vence a las 24 h.
4. Revisar saldo **compartido** en Twilio y disponibilidad/créditos de ElevenLabs. Definir cupo en US$, confirmar autorización de gasto y habilitar manualmente. La autorización vence al terminar el día en Buenos Aires. Valor inicial: **US$0 / pausado**. No hay recargas.
5. Abrir una ficha, revisar destino y marcar confirmación → «Iniciar una llamada». Una a la vez. La clave de solicitud impide duplicados por doble envío. El siguiente intento necesita nueva confirmación; no hay campaña ni reintentos automáticos.
6. El resultado y transcripción llegan por el webhook firmado existente. «Actualizar resultado» consulta ElevenLabs sin llamar. El interés queda anotado para seguimiento **manual de Axel**. No se envían WhatsApp, email ni Telegram automáticamente.

## Límites y costos

- Límite remoto configurado de **60 segundos de conversación**, silencio de 15 s, concurrencia 1, sin bursting, cola deshabilitada. La primera prueba duró **65 s contando cierre**. Antes de cada llamada se comprueban voz, prompt, herramientas comerciales y duración del agente remoto.
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
- No reutilizar el teléfono de prueba para prospección: hubo una petición de baja en el ensayo clínico anterior y después el usuario autorizó expresamente una prueba comercial propia. Esta autorización puntual no elimina bajas ni habilita futuros intentos por rutina. No guardar teléfonos completos ni credenciales en este documento.

## Validación y próximos pasos

- Configuración real: el primer intento creó las dos herramientas comerciales, pero ElevenLabs devolvió `422` en `platform_settings.analysis_llm`: `Value error, LLM 'gpt-4.1-mini' is not supported for analysis.` No creó agente ni llamada. Se quitó esa sobreescritura para heredar el análisis predeterminado, como el setup clínico. El modelo conversacional sigue siendo `gpt-4.1-mini`. La preparación reutiliza herramientas existentes y busca un agente comercial ya creado antes de crear otro.
- Tras corregir el análisis, la API devolvió `400 / voice_live_moderated_not_allowed` para la primera voz intentada. [La documentación confirma la incompatibilidad](https://elevenlabs.io/docs/eleven-agents/customization/voice). Se agregó selector y validación previa de moderación. El usuario eligió **Mauricio** entre las alternativas compatibles: se agregó esa voz y se creó/configuró Agustín desde el panel con éxito. No se quitó ninguna restricción ni se clonó la voz bloqueada.

- Tests de integración con Postgres descartable y proveedor simulado: presupuesto cero/vencido, revisión de contacto, doble envío, concurrencia, timeout incierto, herramientas clínicas rechazadas, baja por token e idempotencia, webhook firmado sin pacientes, permisos y creación separada del agente.
- Verificado en navegador local: agregar ficha, llamada bloqueada con cupo cero y baja persistida con botón deshabilitado.
- **Pendiente:** saldo disponible y destinatarios concretos revisados; validar en conversación las herramientas de resultado, baja y `end_call`. Voz y conversación de Agustín ya confirmadas por el usuario en la única prueba autorizada de este cierre. Presupuesto autorizado: US$5/día, sin recargas.
- Fuentes oficiales: [crear agente y configuración](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create), [end_call](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/end-call), [AAIP / No Llame](https://www.argentina.gob.ar/noticias/registro-no-llame-la-aaip-brinda-informacion-para-garantizar-el-cumplimiento-de-la-ley), [condiciones de Twilio Voice](https://www.twilio.com/en-us/legal/service-country-specific-terms/voice-sip).
