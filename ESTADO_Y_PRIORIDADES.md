# Turnia Salud — estado operativo y prioridades

Actualización: 24/10/2026 (Argentina). Este registro prevalece sobre los pendientes históricos de los otros documentos. No contiene credenciales. **La lista consolidada de lo que falta está en [`PENDIENTES.md`](PENDIENTES.md).**

## Agustín · preparación del piloto comercial — 24/10/2026

- **Actualización posterior:** el usuario autorizó **US$5/día** y una única prueba propia al teléfono terminado en 4245. Se ejecutó **una llamada**, atendida, con Agustín/Mauricio; confirmó que la voz se escuchó bien. **65 s reales**, cierre automático por duración (configurado 60 s + ~5 s de despedida), Twilio **US$0,7056**, ElevenLabs **452 créditos**. Resultado/transcripción en Comercial. Conversación `conv_1901m5qwas11fwbs64wsk8kemn5e`. No hubo uso de herramientas de interés/baja/end_call: validar esas partes en otra prueba autorizada.
- **Estado final vigente:** Twilio mostró **US$0,21916** de saldo compartido tras la prueba, insuficiente para otro minuto al móvil. Piloto **pausado**, cupo **US$5** conservado y **US$1 reservado** por el intento. Sin recargas, sin cambios de planes, WAHA/HolaVeggie intactos y ninguna llamada a prospectos. El usuario deberá resolver saldo y elegir los próximos destinatarios. El permiso nuevo fue una prueba propia puntual, no una autorización para prospectar al mismo teléfono ni repetir automáticamente. Cierre detallado en `COMERCIAL_AGUSTIN.md`.
- **Cierre:** Agustín creado y configurado en producción con la voz **Mauricio**, elegida por el usuario. Agente `agent_4501m5qvpjwrfcxrafq64zmx0y0q`. Panel → Comercial (`/panel/comercial`) publicado (PR #41 + #44). **Pausado / US$0 / ninguna llamada nueva**: el usuario definirá gasto después. Falta autorizar y probar una llamada con Agustín, luego revisar destinatarios del piloto.
- Pedido: vender Turnia a consultorios odontológicos con Agustín. Oferta confirmada: **demo personalizada y después charla con Axel**. Gasto: **preparar todo; definir después**. No autoriza llamadas nuevas.
- Código de **Panel → Comercial**: agente separado, contexto editable por consultorio, revisión de contacto, cupo diario inicialmente cero/pausado, confirmación individual, límite remoto de 60 s, reserva preventiva de US$1 por intento, historial/transcripción y bajas persistidas por teléfono. Sin campañas automáticas. Detalle de uso, costos y límites en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- Herramientas comerciales separadas de las clínicas. Webhook firmado se enruta sin crear pacientes. No se modifican WAHA, el selector Telegram, Sofi ni conexiones/números de otros negocios.
- Pruebas: **213 en verde**, 13 comerciales, typecheck, ESLint y build. Navegador local: guardado, bloqueo con cupo cero y baja. Producción: agente y voz guardados persisten al recargar, pausa y cupo cero; validación previa a llamar pasó contra la API real. Límites remotos: 60 s, concurrencia 1, sin bursting ni cola, 20 conversaciones/día. Análisis predeterminado efectivo `gemini-2.5-flash`. Sofi conserva exactamente su configuración (hash antes/después). Base `ok`, Telegram activo, WhatsApp pausado.
- La creación real expuso dos restricciones de ElevenLabs, **resueltas**: `analysis_llm: gpt-4.1-mini` rechazado con 422 (se hereda el predeterminado), y la voz «Agustin De Angelis - Confident and Happy» rechazada con `400 / voice_live_moderated_not_allowed`. Se agregó selector con validación previa. El usuario eligió **Mauricio**, masculina argentina, sin moderación en vivo y tarifa estándar; se agregó y aplicó únicamente al agente comercial. No se quitó moderación ni se clonó la voz bloqueada. Detalle operativo en `COMERCIAL_AGUSTIN.md`.

## Telefonía saliente con Twilio — 24/10/2026

- Se revisó la cuenta Twilio existente: **Pay-as-you-go**, dos números activos con sus rutas de voz y mensajes hacia Chatwoot. El usuario indicó que HolaVeggie está operativo: **no modificar esos números, agentes, webhooks ni credenciales existentes**. Se comprobó al terminar que las dos líneas y sus URLs originales seguían presentes.
- El usuario verificó por SMS su línea de WhatsApp Business de Turnia como **Verified Caller ID**. No se compró ni portó un número; WhatsApp Business y WAHA no se modificaron. Este identificador sirve para llamadas telefónicas salientes; las llamadas entrantes a la línea siguen en su operador habitual.
- En ElevenLabs se importó **«Turnia · llamadas salientes»**. La pantalla ofrece **Outbound call**; asignar agente entrante está deshabilitado, coherente con un número propio verificado.
- Se creó con autorización una clave **Restricted** «Turnia · ElevenLabs · salientes» con lectura/listado de números e identificadores y lectura/creación de llamadas (seis permisos, sin modificar ni comprar líneas). La importación con esa clave falló con Twilio **8011 / no requested permission**. **La conexión final no usa esa clave restringida**; quedó creada y sin usar para esta conexión.
- El formulario de ElevenLabs exige además el Auth Token de cuenta para importar por API key. Se propuso una subcuenta; el usuario prefirió expresamente continuar con la cuenta existente. La importación final usa **Account SID + Auth Token de esa cuenta**, cargados únicamente en los campos privados de ElevenLabs. **Su alcance es general, no limitado a Turnia.** No se creó subcuenta ni se rotaron credenciales de otros servicios. No copiar valores al repo, chat o logs.
- Vercel / **turniasalud / Production**: agregada `ELEVENLABS_PHONE_NUMBER_ID` y redesplegada la versión actual `c29d1fb` (#32), sin cambios de código. [Despliegue Ready](https://vercel.com/labans-projects-c5c64fdc/turniasalud/98HS96po4c6Fg5PcYvuDhp1NTHQ6).
- Verificación pública después del despliegue: `/api/health` → **`database: "ok"`, `demo.llamada_telefonica: true`, `demo.canal: "telegram"`, `demo.telegram: true`, `demo.whatsapp: false`**. El indicador telefónico confirma configuración, **no una llamada real**. No se cambió el selector de canal.
- Voice Geographic Permissions de Twilio: **Argentina ya estaba habilitada**; consulta de solo lectura, sin cambios.
- **Llamada real validada por el usuario:** la última prueba llegó al teléfono indicado, Sofi se escuchó y hubo conversación de ida y vuelta. El usuario confirmó que **en el celular apareció la línea de Turnia**. ElevenLabs registra **2:11, 21 mensajes, 877 créditos de conversación + 587 de LLM = 1.464 créditos** (LLM mostrado: US$0,12). Twilio registra **2:12, Completed y US$1,0584**; el destinatario cortó. La transcripción termina con `Remote party ended call`. No convertir los créditos a dólares sin verificar el plan. Los cargos de Twilio se redondean: el intento previo de 1 segundo muestra US$0,3528.
- Se hicieron **cinco intentos autorizados** en total: dos desde el botón rápido sin contexto (0 segundos), uno con contexto que sonó pero no fue atendido (confirmado por el usuario), un reintento que se cortó por `clinic_id` vacío (1 segundo, 3 créditos de ElevenLabs) y la prueba corregida exitosa. No se recargó saldo ni cambiaron planes; el saldo de Twilio sigue compartido. **No iniciar más llamadas ni reintentar los lotes de prueba por rutina.** No hubo llamadas a prospectos.
- Diagnóstico de la prueba manual: **Outbound call → Send Test Call** omite el contexto y falla con **`Missing required dynamic variables in first message: {'agent_name', 'clinic_name'}`**. El primer CSV dejó `clinic_id` vacío y falló con **`Missing required dynamic variables in tools: {'clinic_id'}`**. Se corrigió y prevalidó que las nueve variables del prompt y herramientas tuvieran valor, incluyendo el UUID de la clínica demo del seed. El código de Turnia ya envía esas variables en `startPhoneCall`; los errores pertenecieron a la preparación manual. No repetir el botón rápido con este agente.
- La prueba exitosa usó ElevenLabs → Outbound con **un solo destinatario**, contexto técnico explícito y sin usar herramientas clínicas ni crear reservas. Lote `btcal_1801m5qg9j1xfv2t9zete9076ajc`, conversación `conv_9301m5qg9jpwe83sf1146rb4hdh9`. Se aceptaron los términos de comunicaciones salientes con autorización expresa del usuario; un rechazo inicial de aceptación se resolvió al enviar de nuevo, sin crear llamadas duplicadas. No se cambió el prompt, la voz ni la configuración del agente.
- **Límite de la prueba clínica anterior:** validó telefonía y conversación, no ventas, reservas, transferencia ni persistencia de bajas. El guion técnico pedía no usar herramientas clínicas. Hubo una petición de no recibir más llamadas y el agente luego corrigió que no podía registrarla: no reutilizar ese destino para prospección. Posteriormente el usuario pidió expresamente una única prueba comercial propia al mismo teléfono: ver el cierre de Agustín arriba. El intento clínico de colgar mediante herramienta fue abandonado por nueva intervención del usuario; esa llamada terminó cuando este cortó. Antes del piloto comercial real, probar baja persistente y `end_call`.
- El flujo de callback ya existente en `src/lib/demo/session.ts` llama por Twilio solo para sesiones de WhatsApp cuando se elige llamada y hay número configurado. Telegram conserva la llamada web. Esta configuración no agrega una campaña comercial, un control humano por chat ni llamadas nativas de WhatsApp.
- Agente comercial separado **Agustín** ya preparado (ver cierre arriba), conservando la voz de Sofi. Queda pendiente **Tomar / Devolver al agente** para atención humana y la prueba del piloto con gasto/destinatarios autorizados. La voz comercial finalmente elegida es **Mauricio**, porque la primera voz intentada no admite agentes en vivo. El saludo comercial explica identidad de IA y motivo de la llamada.

## Turno a mano en la Agenda — 24/10/2026

- **Pedido del usuario:** el campo de hora rechazaba casi todo («Ingresá un valor válido»: el selector nativo exigía múltiplos de 5 minutos).
- **Ahora** se elige prestación, profesional y día, y aparecen los **horarios libres** de ese día como botones (mañana y tarde), con el horario de atención del profesional.
  - Ya descuentan turnos, feriados, bloqueos y lo ocupado en Google Calendar.
  - Sin anticipación mínima, a diferencia del agente.
- Flechas para pasar de día. Si ese día no atiende o está completo, lo dice y ofrece el día siguiente.
- «Otro horario» permite escribir la hora: entiende 9:15, 915, 19 hs o 7:30 pm. Si no la entiende, lo dice.
- El botón muestra el turno elegido («Reservar lun 26/10 · 08:40»). Los errores se muestran en palabras del panel, no del agente.
- Código: `freeSlotsOnDay` en `src/lib/agent/service.ts`, `loadDaySlots` en `src/app/panel/actions.ts`, `parseClockTime` en `src/lib/time.ts`, `src/app/panel/(app)/agenda/manual-form.tsx`.
- Pruebas: 202 en verde, con casos nuevos del turno a mano y de la lectura de horas.

## Google Calendar — 24/10/2026

- **Código hecho** con un calendario por profesional, a pedido del usuario. Detalle y pasos en `GOOGLE_CALENDAR.md`.
- **Conexión:** Configuración → Calendario conecta la cuenta de Google de la clínica (OAuth con estado firmado y tokens cifrados). Ahí se elige el calendario de cada profesional.
- **Lectura:** lo ocupado en Google deja de ofrecerse. Al reservar se consulta Google en el momento.
- **Escritura:** cada turno se escribe como evento («Turno: prestación · Nombre I.»), se mueve al reprogramar y se borra al cancelar. Si Google falla, el turno se da igual y el evento se reintenta (`/api/automations/calendario`).
- **Pruebas:** 193 de integración en verde (8 nuevas del calendario con Google simulado) y 4 unitarias.
- **Falta:**
  - Que el usuario cree las credenciales en Google Cloud y las cargue en Vercel.
  - La automatización de reintentos en n8n.
  - Para clínicas reales, la verificación de la app en Google.

## Demo en el navegador a pantalla completa — 24/10/2026

Pedido del usuario: que toda la demo (`/probar-demo/sesion/<token>`) entre en una pantalla, en la computadora y en el celular.

- **Lista para probar:** ocupa exactamente el alto de la pantalla debajo del header (`100dvh - 4.5rem`). Los mensajes se desplazan dentro de la conversación (sin mover la página) y quedan pegados abajo, como en WhatsApp.
  - **Computadora:** ficha y frases de ejemplo a la izquierda (columna de 340 px, con scroll propio si no entra), conversación a la derecha y «Pedí una demo guiada» al lado del título. Alineada con los bordes del header.
  - **Celular:** la ficha pasa a una hoja que sube desde abajo («Lo que leímos de tu web», `<dialog>` nativo: se cierra con Esc, con la X o tocando afuera). Las frases de ejemplo aparecen como botones en la conversación vacía. Apenas empieza la charla, el título se guarda (queda para lectores de pantalla) y la conversación gana lugar. `interactive-widget=resizes-content` solo en esta página: en Android el teclado achica la pantalla y el chat queda entero arriba.
  - **Voz:** botón grande «Llamar a Sofi» en el centro; durante la llamada, abajo, el estado («Te escucho…» / «Sofi está hablando…») y «Cortar». En la columna, las frases pasan a «Decile, por ejemplo» (antes eran botones desactivados).
  - Detalles: «Te queda 1 conversación» en singular; en demos sin web la ficha dice «La ficha de tu consultorio».
- **Mientras se lee la web y avisos:** también entran en una pantalla. En el celular se omite la ilustración del navegador (decorativa) y el detalle de cada paso; en pantallas muy bajas, el dato del estudio.
- **Arranca en voz** (pedido del usuario): «Voz» es la primera opción y la que viene elegida. La llamada tiene una esfera animada al estilo del modo de voz de ChatGPT (`orbe-voz.tsx`): nubes de colores que giran adentro (cian, violeta, rosa y blanco), respira en reposo, gira un anillo al conectar y, en la llamada, sigue el volumen real (el de Sofi cuando habla y el del micrófono cuando escucha, con `getOutputVolume`/`getInputVolume` del SDK). Después de la primera prueba del usuario («reacciona poco») tiene ganancia automática (se ajusta al volumen de cada parlante y micrófono), crece hasta un 28 %, late como una gota, saca ondas en cada golpe de voz y cambia de tono: cian cuando habla Sofi, violeta cuando habla el paciente. Se anima con `requestAnimationFrame` sin re-renderizar React y queda quieta con «reducir movimiento». Su tamaño se ajusta al alto disponible (container query). En la llamada: botón para silenciar el micrófono y «Cortar». Los errores de micrófono salen en castellano y sugieren el chat.
- **Telegram fuera de `/probar-demo`** (pedido del usuario): en el celular solo se ofrece navegador o WhatsApp. El bot de Telegram y el selector de canales del panel no se tocaron.
- **Video del hero con ahorro de batería** (el usuario lo vio quieto en su iPhone, con la batería en modo ahorro): iOS no arranca solo ningún video así, y la home se quedaba en la foto para siempre. Ahora el primer toque en la página lo pone en marcha y los mensajes vuelven a seguirlo (`agente-en-vivo.tsx`). Probado simulando el bloqueo en Chromium: antes, quieto aun después de tocar; ahora arranca con el toque.
- **Header:** a 360 px «Pedí una demo» se partía en dos líneas y el header medía 92 px; ahora queda en una línea y mide 72 px en todos los anchos.
- **Verificado** con el build de producción y la API y el WebSocket de ElevenLabs simulados en Playwright: 1920×1000, 1440×800, 1280×680, tablet 820×1180, celular 412×780, 390×664, 360×640, 360×560, apaisado 740×360 y con teclado (390×380). En todos, la demo termina justo en el borde inferior y sin scroll horizontal. axe sin violaciones (chat, voz y la hoja de la ficha). 188 tests en verde. Falta que el usuario la pruebe en su celular con una conversación real.

## Prospección a consultorios odontológicos — 24/10/2026

- **Base:** 96 consultorios odontológicos de Argentina con web propia (30 A, 41 B, 25 C; 83 con WhatsApp tomado de los botones `wa.me` de su web). Se leyó cada web para puntuar cuánto se va a lucir la demo (texto legible, profesionales, tratamientos), si atiende sábados y si trabaja con obras sociales. Quedaron afuera las webs sin texto legible, franquicias y redes grandes.
- **Canal:** WhatsApp desde el número personal o Business del usuario, de a uno (no el chip de WAHA). Instagram y email para los que no tienen WhatsApp. Seguimiento el lunes de 9:30 a 11.
- **Mensaje:** pregunta según el momento («si hoy sábado a la tarde un paciente les escribe para pedir turno, ¿quién le contesta?»), qué es Sofi y el link `/probar-demo?web=<su web>`. Sin precios ni datos inventados.
- **Tablero:** artefacto privado del usuario con la lista, el botón de WhatsApp con el mensaje armado y el estado de cada consultorio: https://claude.ai/artifact/1NwvGAsbxdtkbGLpRBHyKf . Los datos de contacto no se guardan en el repo.
- **Código:** `/probar-demo?web=` llega con la web escrita y el foco en el email (rama `claude/determined-turing-ota3pm`). Para medir: Panel → Pedidos de demo muestra la web y el email de cada uno que probó.

## Crítica de diseño de la home y /probar-demo, y demo en el navegador — 24/10/2026

- **Crítica** con `impeccable critique` (sin subagentes ni detector, aclarado en el informe): 21/32. Copia en `.impeccable/critique/2026-10-24-home-y-probar-demo.md`.
- **Arreglado:**
  - Las ★★★★★ del hero se sacaron y, a pedido del usuario, volvieron como estaban.
  - «Probalo ahora» y «Probá el agente» llevaban a `/demo`, que pide sesión del panel: un visitante veía «Ingresá al panel». Ahora todos van a `/probar-demo`. La banda final queda con «Probalo con tu web» y «Pedí una demo guiada», en azul, y no aparece en `/probar-demo`.
  - «Ver todas las especialidades» abre el índice nuevo `/especialidades` (antes, Clínica médica).
  - La tarjeta oscura del motor ya no repite las especialidades: muestra lo que el agente recuerda de cada paciente. «9 acciones sobre la agenda» pasó a «3 canales».
  - «Conectado a los canales» sin jerga (Postgres, SIP, n8n, webhooks, ElevenLabs); Google Calendar figura como «Próximamente» porque todavía no está.
  - El texto de pediatría ya no dice «una mamá» sobre la foto de un papá.
- **«Lo que dicen los números»** (como «Real Results» de Assort): 24/7 propio y tres números de estudios publicados, cada uno con su enlace:
  - 23 % de ausentismo promedio (Dantas y otros, Health Policy, 2018).
  - 29,5 % de los turnos autogestionados se piden fuera de horario (North y otros, JMIR Medical Informatics, 2021).
  - −29 % de ausencias con recordatorios automáticos (Hasvold y Wootton, J Telemed Telecare, 2011).

  Los números de la captura de Assort son de sus clientes, no de la industria: no se usaron.
- **`/probar-demo` en el navegador** (pedido del usuario): web + email; en computadora directo al navegador, en celular elige navegador o Telegram. Detalle en `PLAN_LEAD_MAGNET.md`. La página tiene los tres pasos y un ejemplo de conversación.
- Pruebas: 184 en verde (7 nuevas de la demo en el navegador). axe en las páginas nuevas: solo los bordes decorativos de la rueda.
- **Verificado en producción:** demo en el navegador de punta a punta (lectura con Claude en 15 s, chat con Sofi y voz). El primer mensaje del chat no se mandaba; se arregló en el PR #30 y se volvió a probar. Interesado de prueba: `prueba-claude@turnia.test`.

## Skills de diseño y auditoría de accesibilidad — 24/10/2026

- **Skills instaladas en `.claude/skills`** (con el OK del usuario): `frontend-design` (Anthropic), `web-design-guidelines` y `react-best-practices` (Vercel) e `impeccable` (pbakaus). Origen, commit, licencia y cambios en `.claude/skills/README.md`. `impeccable` va sin `scripts/` (su lanzador baja y ejecuta un binario); `web-design-guidelines` lee una copia local de las reglas.
- **Auditoría con axe-core** (WCAG 2.2 AA + buenas prácticas) en 27 páginas, escritorio 1366 y celular 390, con la web y el panel corriendo sobre el build de producción: **512 problemas antes, 6 después**. Los 6 que quedan son el desvanecido de los bordes de la rueda «Simplificá cada paso» (decorativo: `aria-hidden` y fuera del orden de tabulación).
- **Contraste:** los grises de texto (`brand-900/50`, `/55`, `/45`…, `brand-950/40`…) pasaron a `/65`; `tinta/70-80` a `tinta`; títulos del menú del panel a `brand-200/75`. Tokens nuevos `emerald-700` y `sun-700` para texto verde y naranja (`sun-600` y `emerald` no llegan a 4,5:1). Las tarjetas verdes y naranjas de la home y de producto usan texto oscuro.
- **Otros:** puntos de la banda 24/7 con área táctil de 32 px; la banda, el carrusel de destacados y la rueda se pausan con foco de teclado (antes solo con el mouse); `transition-all` reemplazado por propiedades explícitas; selector de clínica del panel con rótulo en celular; orden de títulos corregido en el formulario de demo y en «Escuchá a nuestros agentes»; foco visible en el campo de `/probar-demo`.
- **Arreglo chico:** el reproductor ya no pide `/audios/<slug>.json` (404) antes de `/api/audios`. `next.config.ts` anota al compilar qué audios hay en `public/audios`, que siguen teniendo prioridad.
- **Verificado en producción** (PR #27, 24/10): home, `/probar-demo`, «Escuchá a nuestros agentes», odontología, «Pedí una demo» y login del panel, en 1366 y 390. Sin errores 4xx (el 404 de audios desapareció) y axe solo marca los bordes decorativos de la rueda en la home.

## Guardar prestación y profesional — 23/10/2026

- «Guardar prestación» y «Guardar profesional» no avisaban nada: si un dato era inválido (precio con letras, duración fuera de 5–480, nombre vacío) se descartaba en silencio y parecía que no guardaba. Ahora cada edición responde «Prestación guardada ✓» / «Profesional guardado ✓» y se cierra, o muestra el error exacto sin perder lo escrito. Si la clínica elegida cambió en otra pestaña, también lo avisa ahí mismo.
- Probado en navegador (precio inválido → error y valores intactos; precio válido → guardado, se cierra y persiste al recargar) y con test de integración.
- Si alguien tenía el panel abierto durante un deploy, conviene recargar una vez.

## Home: video del hero y llamada en una pantalla — 23/10/2026

- **Video del hero publicado** (`public/videos/`): cuatro clips de Mixkit con licencia libre para uso comercial, uno por mensaje del agente, con fundido entre personas. Hay versión de escritorio (mp4 y webm, 1080p, ~4 y ~2 MB), un recorte vertical para el celular y un póster con el primer cuadro. No se usó el video de Assort (tiene derechos). Detalle de los clips y cómo reemplazarlos en [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md).
- **Celular igual que Assort**: el hero ocupa toda la pantalla, con la cara arriba y el texto abajo sobre un velo que oscurece hacia abajo. La barra queda transparente sobre el video, con el logo en blanco y solo el menú; al bajar vuelve a la barra blanca con «Pedí una demo». El menú del celular suma «Probá la demo con tu web» y «Pedí una demo». Revisado en 390×844 y 375×667.
- **Mensajes sincronizados** con cada persona (0,3 / 7,7 / 15,1 / 22,5 s, en `agente-en-vivo.tsx`). Con «reducir movimiento», el video queda quieto y los mensajes rotan solos.
- **«Escuchá a Sofi en acción»** (variante `escena`, datos en `src/content/escena-home.ts`): Sofi a la izquierda con su objetivo, el paciente a la derecha con los datos que detecta el agente, el orbe al centro y el texto al ritmo del audio real. «Miralo en acción» baja directo a la tarjeta (`#llamada`), que entra completa en la pantalla: medido en 1440×900, 1366×650, 1280×720, 1024×700 y 390×844. Audio comprobado en producción.
- **Skew Protection de Vercel**: no está disponible en el plan actual (Hobby) y no hace falta contratarlo. El panel ya cubre el caso: `deploymentId`, aviso «Hay una versión nueva del panel» con recarga y borrador recuperado.

## Límite de demos por persona — 23/10/2026

- El mensaje «Ya probaste varias demos hoy» salía al llegar a 3 demos por persona por día; ese tope estaba fijo en el código. Ahora se ajusta en **Panel → Sistema → Demo con tu web → «Demos por persona por día»**. Por defecto no hay límite (0), así que se desbloqueó apenas se publicó. Cada demo lee una web y usa créditos de Claude: si la landing recibe abusos, poner un tope (por ejemplo, 5).
- El freno del formulario público subió de 10 a 30 enlaces por origen por hora y sigue el tope global de 1000 por hora. Los enlaces de «Probar este perfil» no cuentan.

## Direcciones mal escritas y verificación del guardado — 23/10/2026

- `/panel/clinica` (en singular) daba el 404 negro de Next. Ahora las variantes habituales redirigen a la sección correcta: `clinica`, `demo`, `paciente`, `conversacion`, `chats`, `tarea`, `campana`, `config`, `inicio`, con o sin tilde. Las direcciones inexistentes muestran una página propia con «Ir al panel». Después del login, `next` solo acepta secciones reales; si no, va a Inicio.
- **Guardado verificado contra el build de producción** (`next start`). Se completaron los 14 campos de las reglas más zona horaria y coberturas (quitar y agregar), se guardó en ~0,1 s, se recargó y cada valor persistió. La web se guarda normalizada, con «/» final. También persistieron: editar profesional, quitar horario, desactivar/activar, editar precio y duración, quitar bloqueo y el historial de cada sección. El recorrido completo de 31 comprobaciones también pasó sobre ese build.

## Segunda auditoría del panel — 23/10/2026

- **Seguridad**
  - Las sesiones de administrador quedan atadas a `PANEL_PASSWORD`: al cambiarla en Vercel se cierran todas las sesiones abiertas con la anterior. Antes seguían valiendo hasta 14 días. Este deploy pide volver a ingresar una vez. Las sesiones de los consultorios no se ven afectadas: esas se cortan con «Revocar».
  - Login y cierre de sesión rechazan formularios enviados desde otro sitio (verificación de Origin).
  - El proxy manda a Inicio, sin cargar la página, al consultorio que intenta abrir Clínicas, Pedidos de demo o Sistema. La página igual lo verifica.
  - Al salir se borran los borradores guardados en el navegador.
- **Experiencia**
  - Cada página del panel tiene su título de pestaña.
  - Esqueleto de carga al navegar.
  - Login con «Mostrar» y una ayuda para el código del consultorio.
  - El código se puede mandar por WhatsApp con un mensaje listo.
  - Bienvenida al consultorio en Configuración, sin la etiqueta interna «Demo conservada».
  - Cambiar de clínica conserva la pestaña.
  - En el celular, la pestaña activa queda a la vista.
  - Textos de «Lectura de la web» sin jerga interna.
- **Validación**
  - 175 pruebas (incluye las del proxy, Origin y contraseña rotada), TypeScript, lint y build.
  - Recorrido completo en Chromium con 31 comprobaciones, como administrador en escritorio y como consultorio en celular, dos veces seguidas y sin errores de página. Cubre crear clínica, completar la ficha al 100 %, equipo, prestaciones, bloqueos con error y con éxito, turno manual, código y WhatsApp, cambio de clínica, Sistema, Tareas, ingreso del consultorio, bloqueo de secciones, cierre de sesión y el historial visto por el administrador.
- **Pendiente del usuario** (no se puede hacer desde el código):
  - ~~activar Skew Protection~~: no disponible en el plan Hobby; queda cubierto por el aviso de versión nueva;
  - rotar las credenciales que quedaron expuestas en el diagnóstico de WAHA (ver la sección del 23/10).

## Auditoría del panel: arreglos — 23/10/2026

Hecho por prioridad después de auditar el flujo completo (código y navegador):
1. **No se pierde lo escrito.** Antes, si guardar fallaba (web o zona horaria mal escritas), React vaciaba el formulario. Los formularios del panel se envían ahora sin ese reseteo automático. Las reglas, además, guardan un **borrador en el navegador**: después de una recarga, un corte o un deploy, se ofrece «Recuperarlos». El borrador queda atado a la revisión de la ficha y no pisa cambios guardados por otra persona.
2. **El agente toma los cambios en la charla abierta.** Cada conversación guarda la revisión de la ficha con la que empezó (`channel_conversations.context_revision`). Si la ficha cambia, el próximo mensaje arranca una conversación nueva de ElevenLabs con los datos actuales y un resumen de lo último que se habló. Ya no hace falta esperar 15 minutos ni escribir MENU.
3. **Deploys.** `deploymentId` usa `VERCEL_DEPLOYMENT_ID`: una pestaña vieja se recarga al navegar. Si una acción quedó desfasada, el panel muestra «Hay una versión nueva del panel» con un botón para recargar, y el borrador se recupera. *Skew Protection* requiere plan Pro de Vercel; con Hobby no se activa y no se contrata.
4. Cambiar de clínica en el selector con cambios sin guardar ahora pide confirmación.
5. Login con límite: 10 intentos fallidos por origen cada 15 minutos (`login_failures`, solo hash del origen). Si la base no responde, no bloquea.
6. **Ficha completa al X %** en Inicio y en Reglas, con lo que falta y un enlace a cada dato. El consultorio que entra con su código va directo a Configuración.
7. En el celular, «Ficha completa» y «Probar el agente» quedan antes del formulario. Después de guardar, la barra ofrece «Probar los cambios».
8. **Historial de cambios** (`clinic_changes`): quién (Turnia o el nombre del acceso del consultorio), qué sección y cuándo. Se ve en Reglas («Últimos cambios») y en Clínicas («Última edición»).
- Menores:
  - zona horaria como lista;
  - coberturas como etiquetas;
  - Tareas con pestañas Pendientes/Resueltas y «Resolver sin respuesta» diferenciado;
  - campañas deshabilitadas con aviso en las demos;
  - sin emojis en el panel;
  - sesión y clínica leídas una vez por página.
- Validación: 171 pruebas, TypeScript, lint y build. Recorrido en Chromium de cada arreglo, sin errores de página.

## Rediseño del panel y acceso propio del consultorio — 23/10/2026

- **Login sin 404** ([PR #18](https://github.com/axellaban/turniasalud/pull/18), en producción): el login y el cierre de sesión son formularios comunes hacia `/api/panel/login` y `/api/panel/logout`, no Server Actions. Una pestaña abierta antes de un deploy ya no termina en 404. Con la sesión vigente, `/panel/login?next=…` lleva directo al destino. Link fijo: `https://turniasalud.vercel.app/panel/login?next=/panel/clinicas`.
- **Acceso del consultorio**: en Configuración → Reglas del consultorio, el administrador crea un código (formato `XXXX-XXXX-XXXX-XXXX`) para la clínica seleccionada. Se muestra una sola vez; en la base se guarda solo su hash (`clinic_access`). El consultorio entra en el mismo login con ese código y **solo ve y edita su clínica**. No ve Clínicas, Pedidos de demo ni Sistema, no cambia el canal, no crea agentes ni borra fichas. «Revocar» lo corta en el acto. Borrar la clínica borra sus accesos. Las sesiones de administrador existentes siguen valiendo.
- **Navegación**: barra lateral agrupada en «Consultorio» y «Turnia» (solo administrador). En el celular, barra inferior con Inicio, Agenda, Chats, Tareas y «Más». El selector de clínica del encabezado cambia al elegir y se queda en la misma sección.
- **Configuración en pestañas**: Reglas del consultorio · Equipo y horarios · Prestaciones · Feriados y bloqueos · Lectura de la web. Las reglas tienen una barra fija de guardado que avisa si hay cambios sin guardar y pide confirmación antes de salir. Lo técnico (canal, Telegram, agente de ElevenLabs, WAHA, URLs, audios de la web y estado) pasó a **[Panel → Sistema](https://turniasalud.vercel.app/panel/sistema)**, solo administrador.
- **Otras pantallas**:
  - Inicio muestra primero lo de hoy, y la puesta en marcha técnica solo al administrador. Los porcentajes con menos de 5 casos se muestran como «—».
  - La Agenda tiene una franja semanal con la cantidad de turnos por día y el turno manual plegado.
  - Clínicas es una lista compacta con filtros Todas / Conservadas / Temporales.
  - Prestaciones es una lista con precio y edición en el lugar.
  - Horarios se ven en una grilla semanal.
- Validación local: **170 pruebas**, TypeScript, lint y build correctos. Recorrido en Chromium con escritorio (1440 px) y celular (390 px), sin errores ni desborde horizontal: cambio de clínica, aviso de cambios sin guardar, guardado, creación del código, ingreso como consultorio, bloqueo de las secciones del administrador y revocación.

## Borrado de fichas y enlaces de perfil de 7 días — 23/10/2026

- `/panel/clinicas`: cada ficha de demo tiene «Borrar ficha» (con confirmación; borra agenda de prueba, pacientes, conversaciones y lecturas). «Borrar demos temporales» elimina todas las demos sin conservar; la principal nunca se puede borrar. Si la ficha borrada estaba seleccionada, el panel vuelve a la principal.
- «Probar este perfil» genera un enlace que vale **7 días** y se puede usar varias veces, desde cualquier chat. Antes vencía a los 15 minutos y quedaba atado al primer chat que lo usaba. La migración extiende a 7 días desde su creación los enlaces de perfil ya emitidos. La limpieza de enlaces de la landing ya no borra enlaces de perfil vigentes.


- Implementado `/panel/clinicas`: listado, búsqueda, creación manual y selector de clínica. Configuración, agenda, pacientes, conversaciones y tareas consultan la clínica seleccionada; los webhooks siguen resolviendo su clínica sin usar la selección del administrador.
- Configuración permite editar el contexto completo de cada ficha: identidad, dirección, web, zona horaria, horarios, coberturas, FAQ, políticas, urgencias, fuera de horario, derivación, formas de pago e instrucciones adicionales. También profesionales, prestaciones, precios, indicaciones, horarios y bloqueos. Las conexiones generales se administran desde la clínica principal; guardar contexto no modifica proveedor, claves, número, voz ni templates.
- Guardar, conservar, leer la web o preparar una prueba protege el perfil de la limpieza de demos de siete días (`retained_at`). Conserva `is_demo`: su agenda sigue siendo simulada y no envía avisos ni campañas a pacientes.
- Las nuevas extracciones guardan en Neon `clinic_imports`: URL, fecha, texto por página y ficha estructurada. Las demos anteriores conservan su ficha pero no tienen archivado el texto original. Se puede leer su web ahora para guardar una nueva referencia; no presentarla como la lectura histórica.
- «Leer web y revisar propuesta» guarda una propuesta sin sobrescribir contexto. Cada campo se aplica por selección explícita; el reemplazo opcional de catálogo desactiva el anterior y conserva turnos e historial. Una revisión desactualizada o de otra clínica se rechaza. Límite de tres lecturas por clínica/hora.
- «Probar este perfil» genera un enlace (hoy de 7 días, ver arriba) al canal habilitado para usar la misma clínica y sus correcciones, sin re-scrapear ni crear otra ficha. Telegram requiere tocar Start. La llamada privada de `/demo` también usa el perfil seleccionado y el agente compartido, sin crear agentes en ElevenLabs. Desde la auditoría del 23/10 el agente toma el contexto editado en el próximo mensaje.
- Validación local: **161 pruebas**, TypeScript, lint y build correctos con Node 24 y Postgres descartable; APIs externas simuladas. Revisión con Chrome: guardar y recargar, cambiar entre clínicas, aplicar solo dirección y conservar pagos/instrucciones manuales. Migración aditiva en el build de producción; sin `seed.sql`.
- WAHA, su sesión y servicio, credenciales, webhook y despliegue no se modificaron. Telegram sigue seleccionado. n8n continúa despublicado; Gmail y campañas siguen pospuestos. No se regeneraron audios ni se modificó ElevenLabs ni planes.
- Publicado por [PR #14](https://github.com/axellaban/turniasalud/pull/14), merge `a8d64bd`. CI y Vercel aprobados; producción [7AGU3CRKJpf4jdT8g9Xd6H3JMuM1](https://vercel.com/labans-projects-c5c64fdc/turniasalud/7AGU3CRKJpf4jdT8g9Xd6H3JMuM1). Comprobación real: panel autenticado con Clínicas y selector, `/api/health` 200 con `database: "ok"`, cuatro fichas y canal Telegram; webhooks WAHA/ElevenLabs sin firma 401.
- En producción se conservó **Guerra–Mininni creado el 23/10 a las 16:22 Argentina**, asociado a la última prueba de audio y llamada. Se guardó una nueva lectura de **1 página a las 16:42**: texto/fuente visibles y propuesta pendiente, sin aplicar datos ni reemplazar catálogo. «Probar este perfil» generó correctamente un enlace a @TurnIA_salud_bot, sin iniciar mensajes. Para probar ahora, generar uno nuevo desde ese botón (vence en 15 minutos).
- Hay tres fichas homónimas de Guerra–Mininni provenientes de pruebas anteriores: no se borraron ni fusionaron. Selector y listado muestran fecha de creación y referencia corta para distinguirlas; la ficha conservada es la de 16:22. Al abrirla desde Pedidos de demo se sincroniza la selección visible. Completar manualmente horarios reales, coberturas, políticas y pagos que la web no publica; no inventarlos ni tratar la agenda simulada como disponibilidad real.
- El servidor y Postgres locales de prueba quedaron detenidos. El recorrido de reutilizar una ficha y sus correcciones se probó con proveedores simulados; el enlace real quedó preparado, y la prueba conversacional humana de **ese nuevo enlace** queda disponible para el usuario. Las pruebas previas de audio y llamada por Telegram ya estaban confirmadas.

## Canales y demo con Telegram — 23/10/2026

**Este bloque prevalece sobre todo el registro histórico que sigue.** El usuario resolvió WAHA por su cuenta y confirmó que funciona. Instrucción expresa: **dejar WAHA exactamente como está**; no cambiar motor, imagen, sesión, credenciales, webhook, conexión ni despliegue. La imagen derivada de la rama histórica `codex/waha-qr-refresh` no es la configuración actual y no se debe desplegar.

- La integración conversacional real es **WAHA → Turnia en Vercel → Custom Channel de ElevenLabs → Turnia → WAHA**. n8n solo recibe eventos de aviso. Despublicar n8n no pausa al bot.
- Pausa urgente inicial: dos reglas temporales Deny en Vercel (`/api/waha/webhook` y `/api/elevenlabs/canal`). **Ambas ya están desactivadas y publicadas**, porque la pausa ahora la controla el selector del código. Las rutas responden 401 sin firma; no hay que reactivarlas para operar. No se modificó WAHA ni otras reglas de seguridad.
- Objetivo confirmado: `/probar-demo` recibe la web del interesado, abre el canal elegido, lee esa web, arma una clínica temporal y permite chat, notas de voz de ElevenLabs o llamada. Para Telegram la llamada es mediante el enlace web existente; la API de bots no inicia llamadas nativas.
- Bot elegido por el usuario: **@TurnIA_salud_bot**. Confirmó que guardó `TELEGRAM_BOT_TOKEN` como Secret de Production en Vercel y realizó un redeploy. No se copió su valor al chat, repositorio ni entorno local.
- Código integrado en `main`: [PR #12](https://github.com/axellaban/turniasalud/pull/12), merge `9a86c7e`. **146 pruebas correctas** con Postgres local descartable y también CI con Postgres 16; TypeScript, lint y build correctos, servicios externos simulados. Incluye: selector **Pausado / Telegram / WhatsApp** en Panel → Configuración, adaptador de Telegram, webhook autenticado, enlace `/start` con token opaco para asociar la web, mismo agente y TTS/STT de ElevenLabs. La nueva tabla `messaging_settings` comienza en **pausado**. Cambiar de canal termina las demos previas y descarta respuestas pendientes mediante una revisión persistida.
- Producción [81bacckz7sk8br9SwHfFgiT7rG37](https://vercel.com/labans-projects-c5c64fdc/turniasalud/81bacckz7sk8br9SwHfFgiT7rG37), **Ready / Production / Current**. La migración creó las tablas y arrancó en Pausado. Después de la autorización específica del usuario, se conectó el bot desde el panel y se guardó **Telegram**. Telegram confirmó el webhook y el panel conservó la elección tras recargar.
- Comprobación HTTP: `/api/health` devuelve 200, `database: "ok"`, `demo.canal: "telegram"`, `demo.telegram: true`, `demo.base: true`, `demo.whatsapp: false`. Esta última significa WhatsApp pausado; **no indica que WAHA perdió la conexión**. No se consultó ni cambió la sesión de WAHA en esta implementación.
- **Uso cotidiano:** [Panel → Sistema](https://turniasalud.vercel.app/panel/sistema) (antes en Configuración), tarjeta «Canal de la demo y del agente» → elegir Pausado / Telegram / WhatsApp → **Guardar canal**. No requiere redeploy, cambio de webhook de WAHA, n8n ni nueva credencial. Cambiar termina las demos anteriores; arrancar otra desde la landing.
- Bot conectado con `getMe` + `setWebhook` + comprobación `getWebhookInfo`: solo acepta @TurnIA_salud_bot y rechaza sobrescribir otro webhook. El token permanece en Vercel; el webhook valida un secreto derivado exclusivo. Solo admite chats privados. No se borró la cola de Telegram.
- La landing se verificó en producción: ingresada la URL elegida por el usuario, «Probar demo» abrió `t.me/TurnIA_salud_bot?start=…`, con token opaco válido por 15 minutos. **Telegram exige tocar Iniciar / Start desde la cuenta del usuario**; no es un borrador de WhatsApp. El enlace debe generarse otra vez desde la landing si vence.
- El workflow [Turnia · Eventos (avisos al equipo)](https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q) permanece despublicado, sin nodos modificados, ejecuciones ni envíos. Gmail, campañas y destinatarios asistenciales siguen pendientes por elección del usuario.
- Web elegida para probar: **Consultorio Odontológico Dr. Guerra y Dr. Mininni**, `https://lab-orpin-five.vercel.app/consultorio/`. Lectura visual comprobada: Aráoz 2879, 1° D, Buenos Aires; odontología integral, rehabilitación oral, operatoria y mantenimiento periodontal; equipo Guerra, Mininni, Coldeira y Fernández. No se envió nada a los contactos de esa web.
- **Prueba real ya observada en el panel:** demo iniciada 23/10 a las 15:32 Argentina, leyó **1 página**, armó «Consultorio Odontológico Dr. Guerra y Dr. Mininni», usuario eligió **audio**. A las 15:33 se registró una nota de voz entrante transcripta y una respuesta del agente al pedido de turno de prueba con el Dr. Guerra. Esto confirma entrada Telegram, lectura de la web, perfil/clínica temporal, STT, Custom Channel y callback real del agente. No se contactó a la clínica real.
- **Validación humana confirmada el 23/10:** el usuario confirmó que el bot ofreció las tres opciones y que la respuesta llegó como **nota de voz de Sofi y se escucha bien**. Queda validado en producción el recorrido landing → Telegram → lectura de la web → selección de audio → transcripción → agente → voz de ElevenLabs → Telegram.
- **Llamada web confirmada el 23/10:** el usuario probó la opción de llamada y confirmó que funciona.
- **Pruebas reales pendientes:** información de la web (dirección/tratamientos/equipo), MENU → chat y SALIR. La reserva sigue probada solo con proveedores simulados; usar datos ficticios en la prueba real. Registro en [Pedidos de demo](https://turniasalud.vercel.app/panel/demos?q=Telegram). El filtro por el dominio deja de encontrar la demo cuando la organización se actualiza al nombre de la clínica; usar Telegram o Guerra. WhatsApp permanece pausado y la conexión de WAHA se conserva.
- No regenerar los siete audios de la web ni modificar permisos/voces de ElevenLabs. No contratar planes. El servicio Postgres local usado en las pruebas quedó detenido.

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
- Casos reales y precios: pendientes de contenido. El video del hero ya está publicado con clips de stock con licencia; se puede reemplazar por uno propio.
- Dependencias de desarrollo: `npm audit` reportó cinco entradas de severidad alta en la cadena de ESLint/fast-glob/micromatch/braces. `braces` 3.0.3 sigue siendo la última versión consultada; no se aplicó el `--force` que propone bajar `eslint-config-next` a Next 14. No forma parte del servidor publicado. Revisar al salir una corrección compatible.

## Continuidad sin computer use

El código y los tests se pueden continuar desde el repositorio. Los accesos a consolas permanecen en las sesiones del navegador del usuario. n8n permite buscar los workflows por MCP, pero su detalle no está habilitado por MCP; se editó desde la UI sin ampliar ese acceso. No tocar proyectos ajenos a Turnia ni contratar planes. Las credenciales no se copian a este documento.

## Referencias de esta entrega

- App: https://turniasalud.vercel.app/panel/demos
- PR integrado: https://github.com/axellaban/turniasalud/pull/5
- CI aprobado (98 tests): https://github.com/axellaban/turniasalud/actions/runs/39685558750
- Producción comprobada: https://vercel.com/labans-projects-c5c64fdc/turniasalud/2FEsHc3xyKH8A7GPSTUhAo4Sr3HY
- Ejecución de email pendiente de reconexión: https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q/executions/50206
