# Turnia Salud — qué falta (traspaso para la próxima IA)

## Laboratorio de Sofi (27/11/2026)

En producción: Panel → Turnia → **Laboratorio de Sofi** ([`PLAN_LABORATORIO_SOFI.md`](PLAN_LABORATORIO_SOFI.md)). Batería nocturna con 18 casos × 3, puntaje de 1 a 100, revisión de las charlas reales, propuestas diarias de Claude, experimentos (versión actual contra la variante) y publicación con un clic. Guerra–Mininni arranca con el laboratorio y el resumen por WhatsApp prendidos.
- [ ] Mirar la primera batería nocturna (28/11, de 2 a 6) y la primera tanda de propuestas. Si el juez se equivoca, sumar criterios en la pestaña Criterios.
- [x] Criterio cargado (migración): en Guerra–Mininni se ofrece primero al Dr. Mininni y no se pregunta por profesional al inicio; si el paciente pide otro (o «una mujer»), se respeta.
- [ ] **Decidir con Axel:** el PR #289 hace que Sofi pregunte la preferencia de profesional junto con los datos, pero Axel prefiere que en Guerra–Mininni se ofrezca primero al Dr. Mininni sin preguntar (criterio cargado). Mientras no se resuelva, el juez del laboratorio marca esa pregunta como falla en Guerra–Mininni. Opciones: sacarla del prompt general y dejarla para los consultorios que la quieran, o una regla en las instrucciones de Guerra–Mininni.
- [ ] Pasar al repositorio (`src/lib/agent/prompt.ts`) las mejoras de prompt aprobadas en el laboratorio cada tanto; el procedimiento está en el plan.
- [ ] Próximas fases, en este orden: consultorio de laboratorio con agenda sintética y herramientas reales; modo prueba completo (pacientes ficticios, ficha simulada, números con vencimiento, `#prueba`, archivar chats); prueba automática en producción con una línea de prueba; calibración semanal del juez. Fase 2: escrituras reales en Smile Connect, solo con un profesional de prueba acordado con Mariano.

## Consultorio odontológico de muestra (27/11/2026)

Clínica real (no demo) para mostrarle Turnia a los consultorios: **Consultorio Odontológico Turnia**, id `86901eaf-369c-4ef5-a653-8c89c0bce2e3`. Agenda propia en Turnia (sin Smile Connect), dos profesionales ficticios con horarios (Dra. Valeria Costa y Dr. Nicolás Ibarra) y la marca `clinics.showcase`: funciona como una real (Sofi manda recordatorios y avisos), pero no cuenta en el uso real de `/api/metricas`. La crea la migración `2026-11-27-consultorio-de-muestra`. El Centro Médico Plaza sigue siendo la clínica principal de las demos y del WhatsApp general: no se toca.

Falta:
- [ ] **Prestaciones:** en el panel, elegir la clínica → Configuración → Prestaciones → «Sumar las que faltan» (plantilla odontológica). Revisar duraciones y precios.
- [ ] **Agente propio:** Configuración → «Crear/actualizar agente». Sin agente propio usa el general; para la línea propia tiene que tener el suyo.
- [ ] **Google Calendar:** Configuración → Calendario, con la cuenta de Google del usuario.
- [ ] **Línea de WhatsApp:** chip nuevo, un WAHA nuevo en Easypanel (WAHA Core admite una sola sesión; no tocar la de Mininni ni la general) y escanear su QR. Después, sumar la conexión a `WAHA_CONNECTIONS` en Vercel con `clinicId` = el id de arriba (por ejemplo id `consultorio-muestra`, webhook `/api/waha/webhook/consultorio-muestra`). La clave va solo en la variable privada, nunca en el chat ni en el repo. Arrancar con `enabled: false`, probar y recién ahí habilitarla.

## Preferencias del paciente y «no hay turnos» (27/11/2026)

Charla real de Guerra–Mininni: la paciente pidió «con una mujer» y «después de las 17». Sofi dijo que con la profesional no había nada «hasta mediados de enero» (había el 23/12, el 28/12 y el 29/12) y dos mensajes después le ofreció horarios con un profesional hombre. Además preguntó las preferencias recién al final.

- [x] `consultar_disponibilidad`: `profesional_genero` (mujer, hombre, cualquiera), `desde_hora` y `hasta_hora`. Lo pedido queda guardado por paciente (`agent_search_preferences`, vence a las 12 h) y se aplica en cada búsqueda de la charla; un horario nuevo reemplaza al anterior y «cualquiera» lo borra. Si nadie cumple la preferencia, no ofrece a otro: pide preguntar antes.
- [x] Busca hasta 60 días antes de decir que no hay. Sin Smile Connect, de una vez; con Smile Connect, de a dos semanas con `seguir_buscando`. Siempre devuelve `buscado` (desde/hasta) y el mensaje dice «Busqué hasta el D/M».
- [x] `professionals.gender` y en Configuración → Equipo «Si el paciente pide una mujer o un hombre». Sin dato, sale de «Dra.»/«Dr.» del nombre; nunca se adivina por el nombre de pila. El catálogo de Sofi dice «Profesional mujer/hombre».
- [x] Prompt: preguntar la preferencia de profesional y horario junto con los datos; mantenerla toda la charla; «No hay» solo hasta `buscado.hasta`, con la fecha; «Perdón, me fijé de nuevo y sí hay…».
- [x] Desplegado ([PR #289](https://github.com/axellaban/turniasalud/pull/289)) y cargado el 27/11 directo en ElevenLabs: el prompt en los dos agentes (WhatsApp general y llamadas de Guerra–Mininni) y la herramienta `consultar_disponibilidad`. Se comprobó que no cambió nada más. Las charlas que ya estaban abiertas siguen con el prompt anterior hasta que empiezan de nuevo.
- [ ] Guerra–Mininni: marcar en Equipo a quien no tenga «Dra.»/«Dr.» en el nombre (por ejemplo, Lara Fernandez), para que entre en las búsquedas de «con una mujer».

## Motivo de consulta y lista de espera unificada — 27/11/2026

- Pedido de Axel y feedback de Guerra–Mininni: Sofi debe preguntar el motivo antes de ofrecer horarios si no lo dijo el paciente, usar sus palabras, no repetir la pregunta ni explicar prioridades internas. «Consulta general» alcanza si no quiere detallar. `collect_visit_reason` queda apagado por defecto; activar solo en Guerra–Mininni después de actualizar las herramientas de sus agentes.
- El motivo, categorías y primera vez confirmada se guardan en el turno y también en la inscripción sin turno. No inferir primera vez por ausencia de historial en Turnia. No inventar ni completar retroactivamente motivos de pacientes reales.
- **Una sola lista:** Panel → Lista de espera, con acceso en el menú lateral y en «Más» en celular. Columnas con/sin turno, motivo, prioridad, preferencias y reserva actual. Incluye pedidos de aviso y primeras consultas confirmadas de implantes/prótesis/blanqueamiento para evaluar adelanto; distingue ambos orígenes y no genera inscripciones ni mensajes por mostrar un candidato. El equipo decide a quién contactar. La prioridad es de seguimiento, no urgencia clínica. La consulta del equipo por WhatsApp usa la misma lista actualizada.
- Una reserva recuperada sin `notes` deja una cola independiente para completar las notas: conserva el turno confirmado, verifica el turno antes/después, preserva texto de recepción y no reejecuta el alta. Reintentos a los 5/10/20/40 minutos (máximo cinco intentos); al agotarlos queda para revisar en el panel. Sin avisos técnicos ni mensajes al paciente por ese campo opcional. La API obliga a reenviar horarios al editar notas y no ofrece escritura condicional: se coteja dos veces antes y se verifica después; no prometer ausencia absoluta de carreras con cambios manuales simultáneos.
- Validación local: 849 tests en 101 archivos y regresiones focalizadas posteriores, proveedores simulados y Postgres descartable; ninguna reserva real usada para estas pruebas. La pantalla pasó el control en computadora e iPhone, con/sin turno, filtros, enlace en «Más», sin errores de navegador, desborde de página ni problemas graves de accesibilidad. Para habilitar una clínica se actualizan primero sus agentes y después se activa la opción en el panel.

## Hallazgos de la sesión de pruebas de Sofi (26/11/2026)

Facundo probó a Sofi simulando pacientes de Guerra–Mininni y encontró 11 problemas. Hecho en el repositorio (llega a ElevenLabs con «Actualizar a Sofi»):
- [x] Prompt general: ningún estado de turno sin herramienta en esa charla y nunca «ya avisé» sin herramienta; día pedido contra días de atención; primero para quién es el turno; derivación ofrecida y con el sí del paciente (salvo urgencia), con datos mínimos y una tarea por pedido; responder cada pregunta (también el precio); respetar la franja pedida y ofrecer lo más cercano y la lista de espera; palabras del paciente; contención ante miedo o dolor; diferenciales en consultas de tratamientos.
- [x] Protocolo odontológico `2026-11-26.1`: señales de alarma (cara hinchada con fiebre, dificultad para tragar o respirar, golpe fuerte, sangrado que no para) → guardia ya, sin «si considera que es un riesgo para su vida»; precios sin saltear la pregunta.
- [x] `buscar_paciente` sin DNI para un turno existente: nombre y apellido + día (y hora) del turno. Solo con el permiso temporal de la clínica y si hay un único paciente; si no, pide el DNI.
- [x] Herramienta nueva `anular_tarea` (pedidos de la misma charla) y evento n8n `tarea.anulada`.
- [x] Modo prueba: Configuración → Turnos y urgencias → «Modo prueba» (solo admin), `clinics.test_phones`. Tareas cerradas y marcadas (`tasks.is_test`), sin aviso; reservas, cambios, cancelaciones, confirmaciones y lista de espera simulados.
- [x] Trato «Como escribe el paciente» (`clinics.tone = 'espejo'`).
- [x] Guerra–Mininni (migración `2026-11-26-contencion-diferenciales-guerra-mininni`): contención y diferenciales agregados a sus instrucciones.
- [x] Batería `probar-sofi`: 10 casos nuevos (los que usan `anular_tarea` se saltean hasta «Actualizar a Sofi»).
- [x] **«Actualizar a Sofi»** desde Configuración de Guerra–Mininni: el 27/11 el panel confirmó la actualización del agente general (WhatsApp) y el propio (llamadas). Repetir al publicar nuevas herramientas o prompt.
- [ ] Correr la batería de simulaciones de ElevenLabs (`npm run probar-sofi -- --agente <id> --clinica "Guerra"`). La actualización del agente no equivale a haber corrido la batería.
- [ ] Decidir con Mariano si Guerra–Mininni pasa al trato «Como escribe el paciente» y si Sofi puede decir «limpieza» (hoy sus instrucciones lo prohíben, pedido del 18/11).
- [ ] TODO_CONFIG de Guerra–Mininni: valor de la consulta particular (en Prestaciones o Preguntas frecuentes), precio «desde» o rango de implante, blanqueamiento y otros tratamientos (Prestaciones → precio y modo), en cuánto tiempo los contacta el consultorio ante una urgencia (Turnos y urgencias → «Qué hacer ante una urgencia»), y si hay un turno de urgencia en la agenda (prestación «Es un turno de urgencia»). Cargar los celulares de testers en «Modo prueba».
- [ ] n8n `Turnia · Eventos`: sumar una rama para `tarea.anulada` si recepción tiene que enterarse de que un pedido quedó sin efecto (hoy el evento llega y no hace nada).

## Email de respaldo para los avisos técnicos — 26/11/2026

- Axel autorizó enviar los avisos técnicos a `axellaban@gmail.com`.
- El flujo real `Turnia · Eventos (avisos al equipo)` (`PEaOkLPBrLIfFE0Q`) está publicado y ya tiene una conexión `Gmail account` usada para `lead.nuevo`. Ese envío de pedidos de demo se conserva. La rama nueva procesa únicamente `axel.aviso` y usa esa misma conexión para el email técnico.
- La aceptación del webhook y la entrega del email son comprobaciones distintas. `notifyN8n` ahora devuelve si n8n aceptó el HTTP; un 401 o un 500 no se presenta como éxito. Los errores de n8n conservan el flujo clínico.
- Sistema incorpora «Probar email de respaldo», solo para el administrador, con un código en el mensaje y un máximo de una solicitud por minuto. Debe comprobarse la entrega en Gmail, sin hacer fallar WAHA ni usar pacientes para probar.
- Límite: n8n corre en el mismo VPS que WAHA. Este email cubre fallas de WhatsApp; una caída completa del VPS requiere un proveedor de correo externo a ese VPS. No describirlo como respaldo independiente del VPS.
- La rama se publicó en n8n como versión `03e77dcb-171b-4dc0-a1cf-07576276cfd6`. Después de reautorizar Gmail se verificó el recorrido desde Turnia en producción: código `TURNIA-EMAIL-8fd91a45`, ejecución n8n `56136` exitosa y mensaje `1a2187a5e81ca9ea` recibido en INBOX de Axel. El cliente de Google ya está en producción.
- En la reconexión se detectó `redirect_uri_mismatch`: el cliente de Gmail conservaba solo el dominio anterior `fu6abb`. Se agregó y verificó en Google Cloud `https://n8n-n8n.b6mgbu.easypanel.host/rest/oauth2-credential/callback`, conservando las URI anteriores. Hay que iniciar una autorización nueva desde «Switch account»; la ventana del intento anterior no sirve.
- No tratar una lista de workflows de la caché como prueba de autenticación vigente. Las lecturas de control usan `cache: no-store` y el identificador de navegador de la sesión.

## Radar de WhatsApp (WAHA) y del VPS — 26/11/2026

**Política de avisos técnicos (26/11, noche): solo indisponibilidades operativas.** Los emails horarios repetían dos datos que no eran caídas: horarios copiados y falta de `events:read`. Quedan en el panel junto con los recordatorios de clave, copias y uso alto. `checkSmileHealth` avisa una escritura frenada o una API que falla en dos comprobaciones actuales; no deduce una caída de un error antiguo ni de una copia atrasada. El monitor de WhatsApp reconsulta antes de avisar, ignora un `STARTING` reciente y no repite el aviso mientras sigue el mismo incidente. No poder leer Easypanel queda en diagnóstico: no prueba una caída del VPS.

**Causa de la repetición:** `notifyAxel` devolvía `false` después de que n8n aceptara el correo porque había fallado WhatsApp; se borraba la deduplicación y se reenviaba cada hora. Ahora devuelve aceptación por cualquiera de los dos canales. Esto no afirma que Gmail ya lo entregó; conserva la distinción entre aceptación y entrega final. Si ambos canales rechazan el aviso, se permite reintentar. No volver a agregar avisos informativos al canal técnico.

Pedido de Axel: entender por qué se desvinculó la WAHA del consultorio y detectar la próxima caída a tiempo.

**Corrección de avisos (26/11):** Axel pidió recibir avisos solo por fallas actuales. Los dos «reinicios» del 19/11 y 7/11 fueron falsos positivos: `startTimestamp` cambió 1 ms entre consultas mientras `uptime` siguió creciendo. WAHA calcula ese valor con `Date.now() - uptime`; la comparación exacta era incorrecta. Docker confirmó que los contenedores seguían funcionando desde esas fechas. El radar no reinicia nada.

- Solo avisan los servicios y sesiones usados por las conexiones habilitadas de Turnia o su transporte general. Las instancias anteriores siguen visibles para diagnóstico, sin avisos.
- Las recuperaciones, los reinicios y el uso alto de RAM/disco se guardan en el panel, sin enviar avisos. Un cambio de arranque solo se registra si avanza más de cinco segundos; se ignoran diferencias mínimas, retrocesos y fechas futuras.
- Los logs se guardan sin avisos: pueden ser históricos o reconexiones ya resueltas. Las caídas se confirman por estado/webhook; las restricciones que efectivamente frenan una línea en uso conservan su aviso. Los preavisos de cupo no lo generan.

**Qué hay en el VPS (Easypanel, leído por API el 26/11):** un solo CPU, 3,9 GB de RAM y 47 GB de disco. Cuatro WAHA, todas NOWEB y CORE, con una sola sesión cada una:

| Servicio | Línea | Estado 26/11 | Imagen |
|---|---|---|---|
| `n8n/waha` | 3765 (Guerra–Mininni, la activa) | WORKING | `waha:noweb` (corre 2026.10.1), sin tope de memoria |
| `n8n/turnia-guerra-mininni-waha` | 3765 (la anterior) | FAILED, sin webhook | 2026.9.2 fijada, 768 MB |
| `n8n/turnia-prospeccion-5483-waha` | 5483 (prospección, suspendida) | FAILED | 2026.9.2 fijada, 768 MB |
| `n8n/turnia-waha` | general y demo | sin leer desde la nube (clave de la sesión vieja) | `waha:noweb`, 768 MB |

**Hallazgos:**
- **La RAM del VPS está entre 89 y 96 %** (el 25/11 a las 12:55 llegó a 3,77 de 3,9 GB). Más usan: n8n (590 MB), Chatwoot sidekiq (520), `turnia-waha` (460) y `n8n/waha` (370). Las dos WAHA en FAILED ocupan unos 600 MB sin dar servicio. A las 23 h el CPU llega al 100 % (coincide con la limpieza diaria de Docker de Easypanel).
- **La caída del 3765 del 24/11 no fue un reinicio del contenedor:** `turnia-guerra-mininni-waha` corre sin reiniciarse desde el 19/11 09:53 (despliegue por cambio de variables). La sesión pasó a FAILED dentro del proceso. La causa exacta no se pudo leer: Easypanel no tiene prendido el guardado de logs y su visor solo entrega el arranque del contenedor y lo que pasa en vivo.
- **`n8n/waha` tenía «zero downtime» prendido** (es lo que Easypanel trae por defecto). En un redespliegue, el contenedor nuevo arranca antes de que se apague el viejo y los dos usan la misma sesión de WhatsApp a la vez. Eso desvincula la línea. **Se apagó el 26/11 por API, sin redesplegar** (mismo arranque y sesión WORKING verificados). Las otras tres ya lo tenían apagado.
- `n8n/waha` usa la etiqueta móvil `waha:noweb`: un redespliegue baja la última versión sin avisar. Conviene fijar el digest de la que corre (2026.10.1) antes del próximo despliegue.

**Qué se construyó:**
- `src/lib/infra-radar.ts`: cada diez minutos, con el cron `calendario`, lee por la API de Easypanel la RAM, el disco y el CPU del VPS, la memoria de cada contenedor y todas las WAHA (sesiones, arranque del contenedor y versión). La clave de cada WAHA la saca de Easypanel, así que no hace falta cargarla en Vercel. Avisa a Axel por WhatsApp (o por n8n si la línea general no anda) cuando una conexión en uso se cae, deja de responder o tiene una restricción que frena su operación. Si no puede consultar Easypanel guarda el diagnóstico sin afirmar una caída. Los reinicios, las recuperaciones y los recursos altos quedan para consulta en el panel.

  Guarda estado, eventos y una muestra por corrida en `infra_radar_state`, `infra_radar_events` e `infra_radar_samples` (30 días). Nunca guarda claves ni teléfonos.
- El webhook de WAHA guarda **en el momento** el aviso `session.status` (antes se descartaba) y avisa la caída sin esperar al cron. `n8n/waha` ya manda ese evento.
- `scripts/waha-radar/radar.mjs`: lector de logs para el VPS (servicio `n8n/waha-radar`, imagen `node:22-alpine`, 96 MB). Escucha en vivo los logs de las cuatro WAHA y manda a `POST /api/infra/waha-logs` solo las advertencias, los errores y los cambios de estado, sin ruido, sin nombres ni números y sin volcados de claves. También los deja en el volumen `/data`, 30 días. Firma con una clave derivada del token de Easypanel: no necesita otra variable.
- Panel → Sistema → «Radar de WhatsApp y VPS»: la última lectura y los últimos eventos.
- **Buenas prácticas de la doc oficial de WAHA (26/11, tanda A):**
  - El radar lee `GET /api/sessions/{s}/me` y avisa si WhatsApp frena la línea aunque siga en WORKING: bloqueo temporal por escribir a muchos contactos nuevos (error 463) o tope del ciclo (`messageCapping`: `FIRST_WARNING`, `SECOND_WARNING` o `CAPPED`, error 475). En esos casos **no se reinicia ni se re-vincula**: no lo levanta y empeora la línea. Se frenan los mensajes a contactos nuevos y se espera.
  - Ante FAILED, la doc indica primero reiniciar la sesión y, si no vuelve, re-vincular.
  - Sofi marca como leído (`/api/sendSeen`) antes del «escribiendo…».
  - `/api/infra/waha-logs` responde 503 si faltan las variables de Easypanel y 401 si la clave no coincide.

**Pendiente:**
- [x] **Variables del radar cargadas en Vercel Production el 26/11.** `EASYPANEL_API_URL=https://b6mgbu.easypanel.host/api` y token como secreto. Se redesplegó la misma versión publicada (`4da0746`); el endpoint de logs aceptó la firma derivada del token y `/api/health` respondió 200 con la base operativa.
- [ ] **Rotar el token de Easypanel y las cuatro `WAHA_API_KEY`**: pasaron por un chat el 26/11. Rotar las claves de WAHA obliga a redesplegar cada servicio, así que conviene hacerlo fuera del horario del consultorio y empezando por las que están en FAILED.
- [x] **Tanda B (27/11, 00:40, aprobada por Axel, fuera del horario del consultorio), por la API de Easypanel:**
  - Se apagaron `turnia-guerra-mininni-waha` y `turnia-prospeccion-5483-waha` (las dos en FAILED). Volúmenes y configuración intactos: se vuelven a prender desde Easypanel si hace falta.
  - `n8n/waha` (3765 del consultorio):
    - imagen fijada en `devlikeapro/waha@sha256:0d64cce1…` (`noweb-2026.10.1`, la misma versión que ya corría);
    - tope de 1024 MB de memoria con reserva de 256 MB y sin tope de CPU;
    - zero downtime apagado.
    - Redespliegue a las 03:41 UTC: la sesión volvió a WORKING con el 3765 en unos 40 s, sin bloqueo temporal ni tope de contactos nuevos (`messageCapping: NONE`).
  - `n8n/turnia-waha`: misma imagen fijada y redesplegada; responde. Su sesión no se pudo leer desde la nube porque la clave guardada en el entorno de esta sesión es vieja. El radar de Turnia la lee con la clave de Easypanel.
  - **RAM del VPS:** del 92 % antes a 73 % después (2,9 de 3,9 GB).
- [ ] Leer la sesión de `turnia-waha` (línea general y demos) en el panel de Turnia → Sistema → Radar, y corregir la clave guardada de ese host en el entorno de la sesión de Claude.
- [ ] Fijar la imagen de `n8n/waha` en su digest actual (no redesplegar para eso en horario de atención).

## Modelo de Sofi por canal — 25/11/2026

- Pedido de Facu: Opus 5.5 en el chat mientras se ajusta el prompt y Sonnet 5.5 en voz.
- `AGENT_CHAT_LLM` (por defecto `claude-opus-5-5`) va en el agente general, que atiende todos los WhatsApp y las demos por chat. `AGENT_VOICE_LLM` (por defecto `claude-sonnet-5-5`; antes `AGENT_LLM`) va en el agente propio de cada clínica, que solo atiende llamadas.
- Las demos por voz del agente general (web, `/probar-demo/llamada`, la llamada saliente de la demo y «Probar a Sofi» por voz) piden el LLM de voz al arrancar. Solo lo piden si el agente ya permite cambiar el LLM por charla (`platform_settings.overrides.conversation_config_override.agent.prompt.llm`). Si no, siguen con el de chat, que es más lento pero no se cortan.
- **Después del deploy:** tocar «Actualizar a Sofi» (Sistema) para el agente general. Después, abrir en ElevenLabs → agente general → Security y confirmar que el override «LLM» quedó prendido (la forma del campo no está en la documentación de la API: se dedujo de la del resto). Si no quedó, prenderlo a mano. Probar una demo por voz y un WhatsApp.
- Revisar en una semana el consumo de LLM en ElevenLabs: Opus cuesta el doble que Sonnet por token.

## Lista de espera consultable por el equipo — 24/11/2026

- `ver_lista_espera` lee la base en cada pedido de un número con acceso total por WhatsApp. Incluye activas y ofrecidas, también las altas de hoy, con paciente, celular, prestación, profesional, preferencias, estado y turno que conserva. Tiene filtro desde una fecha local, por profesional/estado y páginas de 30 sin ocultar el total.
- Panel → Campañas → Lista de espera → «Ver lista» abre `/panel/lista-espera`, con «Todos los pendientes», «Anotados hoy» y actualización manual. Usa la misma lectura que Sofi, limitada a la clínica de la sesión.
- Para que Sofi use la herramienta nueva, ejecutar «Actualizar a Sofi» después del despliegue. Una inscripción aceptada se registra con `anotar_lista_espera`; una propuesta pendiente en un chat no se incorpora por inferencia.
- Este cambio no activa campañas, no manda mensajes a pacientes ni incorpora avisos de cancelaciones hechas directamente en Smile Connect. Esas mejoras conservan su autorización pendiente.
- Control de las altas de hoy: contrastar la lista real con los pedidos aceptados de las conversaciones de Mónica y Adriana. El resultado de publicación y revisión se registra al cerrar la tarea.

## Conexión activa del consultorio — 24/11/2026, tarde

- El usuario configuró el 3765 en `n8n/waha`. Se comprobó `WORKING` con la cuenta correcta. La instancia exclusiva anterior seguía en `FAILED`; un único reinicio conservando la autenticación no la recuperó. No se cerró sesión ni se pidió otro QR.
- La firma del webhook de la sesión activa fue aceptada por Turnia, pero el evento de estado inocuo fue descartado como «otra sesión»: la sesión real es `default` y la configuración de la aplicación no coincidía. También había un 401 histórico al consultar WAHA.
- `WAHA_CONNECTION_TRANSPORTS` permite corregir únicamente URL, API key, sesión y revisión de una conexión existente, preservando la variable sensible `WAHA_CONNECTIONS` completa y sin cambiar clínica, teléfono, habilitación ni firma. No sobrescribir el secreto original con una reconstrucción parcial.
- El primer valor de revisión cargado por Codex fue demasiado grande para `channel_conversations.revision` (PostgreSQL integer) y frenó la prueba real antes de llegar al agente. Se corrigió el secreto de Production a una revisión válida y se volvió a publicar el mismo commit, conservando la sesión. La validación ahora rechaza valores mayores que 2.147.483.647 tanto en la configuración base como en el transporte; no usar `Date.now()` como revisión.
- La recepción real debe comprobarse después del despliegue, sin reenviar mensajes viejos ni pruebas a pacientes. Las campañas y sus automáticas conservan su configuración.

## Protección del WhatsApp de prospección — 24/11/2026

- Axel informó una suspensión del 5483 en WhatsApp Business. No se confirmó la causa: `FAILED` no distingue una suspensión de otros fallos y los logs históricos no estaban disponibles.
- La recuperación previa solo reinició y renovó la sesión del 3765. Se encontró otra vía preexistente: Chapa intentaba recuperar el 5483 automáticamente al detectar `FAILED` con el diálogo de audios abierto. No se pudo establecer si se ejecutó durante este incidente ni si influyó en la suspensión.
- Se retira esa automatización y la gestión de sesiones desde Chapa. Turnia rechaza `action: reconnect` con HTTP 423 y `reconnection_disabled`, incluso para pestañas que conservaron el código anterior. La vista de conexión solo consulta el estado; no solicita QR ni inicia, reinicia o desvincula una sesión.
- No reactivar la línea, generar QR ni cambiar servicios, imágenes, claves o volúmenes como parte de este arreglo. La recuperación posterior requiere revisar primero el resultado en la app de WhatsApp Business y una intervención manual específica fuera de Chapa. Las pausas de envío no garantizan evitar bloqueos de WhatsApp.

## Turnia Activa · Campañas — 24/11/2026 (en curso)

Rediseño de Panel → Campañas, cerrado en otra sesión. Diseño de referencia: el artefacto de diseño «Turnia Activa · Campañas» de claude.ai, con tres pantallas (Campañas, Nueva audiencia y Revisar lote). Plan y decisiones en [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md) → «Versión 2: Turnia Activa». Va en cinco PRs chicos; cada uno se mergea a main solo con CI y el preview de Vercel en verde.

**Regla:** las automáticas y las secuencias salen **apagadas**. Se prenden por clínica cuando Axel valide el canal, los destinatarios y la baja (el 18/11 dijo «por ahora no» a mensajes nuevos a pacientes).

- [x] **PR 1 · Arreglos de fondo.**
  - Automáticas por clínica: `clinics.auto_campaigns`, vacío por defecto, con interruptor en Panel → Campañas → Automáticas que solo cambia el administrador. n8n ya no llega solo a la clínica por defecto: cada job corre en las clínicas que lo tienen prendido y saltea las demo.
  - El tope de 50 ya no deja pacientes sin mensaje: la automática retoma su campaña abierta (`campaigns.automatic`) y nunca toma un borrador del equipo.
  - Atribución de 14 días (`ATTRIBUTION_DAYS`).
- [x] **PR 2 · Secuencias.**
  - Pasos por campaña en `campaign_steps`. El de «volver a sacar turno» trae un seguimiento sugerido a los 5 días.
  - Por paciente se guarda `messages_sent`, `next_step_at` y `sequence_stopped`.
  - Corren en `/api/automations/calendario`, la tarea de cada 10 minutos, de lunes a viernes de 9 a 20.
  - Se cortan si el paciente responde, saca turno por cualquier canal o pide la baja.
  - Tope de 60 por día y por línea WAHA (`campaign_messages`). También frena «Enviar con Sofi» y anota lo que el equipo manda a mano.
  - Interruptor «Seguimiento a quien no responde» por clínica, apagado y solo para el administrador. Un paso que venció hace más de 4 días se cierra sin mandarse.
- [ ] **PR 3 · Pantalla de Campañas:**
  - audiencias con cantidad, valor y una acción (o el motivo si no hay datos, como «Presupuestos sin iniciar → Conectar origen»);
  - «WhatsApp del consultorio · hoy N de 60»;
  - borradores y una línea «Del día a día» (los recordatorios de Guerra–Mininni los manda Smile Connect);
  - resultados en 4 etapas: contactados → respondieron → citas agendadas → citas atendidas;
  - una cola con motivos y acciones;
  - el panel con las pestañas Audiencia, Secuencia y Mensaje.
- [x] **PR 4 · Nueva audiencia.**
  - Pantalla `/panel/campanas/audiencia` con reglas que se leen como frase: meses sin venir, prestación, profesional, cobertura, edad, cumpleaños este mes, faltó a un turno y control indicado. «Presupuesto sin iniciar» queda deshabilitado hasta tener el origen.
  - Vista previa en vivo con la cantidad, el valor, quiénes quedan afuera y por qué, y algunos nombres.
  - Audiencias guardadas (`saved_audiences`) como tarjetas en Campañas, con «Crear campaña +» y «Editar».
  - Las campañas de audiencia propia usan `type = 'audiencia'` y guardan sus reglas en `campaigns.audience_rules`. Cuentan para el tope entre campañas y traen el seguimiento sugerido.
- [x] **PR 5 · Revisar lote.**
  - Pantalla `/panel/campanas/[id]/lote`, con los próximos 5.
  - **«Con Sofi, automático»:** manda solo los elegidos del lote.
  - **«Desde mi WhatsApp, de a uno»:** abre el chat con el mensaje escrito y lo marca como enviado. Atajos de teclado: Enter abre el chat y → pasa al siguiente.
  - **Seguimiento de lo enviado a mano:** también sale desde el lote, a los N días.
  - **Marcas Respondió / No le interesa / Pidió la baja** (`campaign_recipients.outcome`): cuentan como respuesta. La baja queda en la ficha y corta el seguimiento.
  - **Piloto de 20** (`campaigns.pilot_size`): frena «Con Sofi» y el lote hasta que el equipo sigue con el resto.
- **Siguiente:** probar en producción con Axel cuando apruebe canal, destinatarios y baja, y prender las automáticas y el seguimiento de a una.
- Valores confirmados:
  - atribución de 14 días;
  - seguimiento a los 5 días, con un máximo de 2 mensajes;
  - lotes de 5;
  - 60 por día y por línea WAHA;
  - piloto de 20;
  - envío de lunes a viernes, de 9 a 20.
- La IA se llama «Sofi». La llamada de Sofi aparece como paso futuro y no se implementa: requiere autorización. No copiar textos, diseño ni código de DentiPilot.

## WhatsApp y llamadas del consultorio — 24/11/2026

- La sesión propia de WAHA estaba en FAILED. Reiniciar conservando la autenticación no la recuperó; se renovó la vinculación y quedó WORKING con la cuenta correcta. El usuario confirmó una respuesta real y el mensaje y la respuesta se comprobaron en Turnia.
- No se pudo establecer el motivo original de la desconexión: el contenedor seguía activo con el digest fijado y sus volúmenes; la consulta de logs de Easypanel devolvió 400 y no había configuración de logs disponible. No atribuirlo a créditos, a un despliegue o a una acción del teléfono sin evidencia.
- Cambios de llamadas: nueva herramienta para consultar el resultado verificado de una gestión pendiente antes de despedirse, mención explícita de WhatsApp y revisión humana si ese canal no está operativo. Las fechas se ofrecen desde la última búsqueda, sin mezclar límites de ventanas anteriores.
- La lista de espera admite turno_id para una reserva existente, conserva las restricciones de cirugía/implantes/extracciones/duración/antelación y verifica que un adelanto sea compatible. No habilita nuevas reservas del tipo genérico importado.
- El cron existente controla cada diez minutos el estado real de las líneas propias: guarda transiciones, deja una tarea al caer y avisa a Axel (con el fallback existente de n8n), como máximo una vez por hora por incidente. El control no reinicia ni desvincula líneas.
- La confirmación que falló antes de recuperar la sesión sigue requiriendo revisión contra la agenda; no reenviar mensajes antiguos automáticamente.

## Incidente de créditos y entrega — 19/11/2026

- **Reprogramación y duración en Smile Connect (19/11):** reproducido con un turno ficticio a un año: 14:15–14:45 pasó el chequeo antiguo de celdas de 5 minutos, pero el PATCH devolvió `409 slot_unavailable`; 14:00–14:30 se aplicó y verificó en la agenda nativa. La oferta y la escritura ahora consultan la duración completa y conservan los inicios exactos del proveedor. Si otro turno ocupa el destino después de consultar, se vuelve a leer el original antes de decir que se conserva y pedir otra opción. La causa específica del rechazo histórico no se puede demostrar retrospectivamente: el registro antiguo guardó solo una frase genérica. El cliente ya conserva código, motivo y `request_id`. Validación previa: 704 pruebas en 84 archivos, ESLint y build correctos. El resultado del control posterior al despliegue y la limpieza de la prueba se registra en el cierre del [PR #247](https://github.com/axellaban/turniasalud/pull/247).

- A las 13:29 ElevenLabs agotó los 158.603 créditos del workspace compartido. Los callbacks fallaron por saldo, aunque el proveedor había generado texto y su transcripción lo mostraba. WAHA y la base seguían operativos.
- El usuario cargó 100.000 créditos. Se verificó el saldo y una respuesta real por la línea propia; no se confirmó el cambio de abono que se había preparado. Se cerraron cinco sesiones fallidas para evitar reutilizarlas.
- Se corrigieron cinco historiales afectados contra los mensajes realmente enviados por WAHA, conservando una copia privada previa. La reprogramación que el proveedor rechazó quedó resuelta manualmente por el consultorio: se verificó en Smile Connect, se actualizó Turnia y se cerró la revisión, sin volver a modificar el turno.
- Las transcripciones propias de WhatsApp prevalecen sobre texto generado que no se entregó. El panel muestra el fallo de entrega, las sesiones fallidas se cierran y una caída por saldo genera un aviso a Axel, como máximo uno por clínica y hora.
- Las pruebas de carga usan proveedores simulados y PostgreSQL descartable. Los créditos de las pruebas reales se comparten con las clínicas; no repetir baterías de llamadas en producción sin revisar primero el saldo.

## Días para turnos de Sofi — 19/11/2026

- Guerra–Mininni pidió que Sofi solo dé turnos de lunes a jueves. Los viernes quedan para cirugías y casos grandes de prótesis coordinados por el equipo. La regla también aplica al destino de una reprogramación, con todos los profesionales; no cambia los turnos existentes ni las reglas de cancelación.
- Configuración → Turnos y urgencias → «Días en que Sofi da turnos»: política independiente de los horarios reales. Smile Connect conserva su agenda de viernes y sus sincronizaciones no pisan esta selección. Las otras clínicas mantienen todos los días por defecto; el equipo puede operar los días reservados.
- Las instrucciones de la clínica se actualizaron en producción antes del despliegue de esta validación. La conversación de horarios de las 10:15 fue una prueba nuestra.
- La lista de espera también respeta los días permitidos: cancelar o mover un turno de viernes no ofrece ese lugar automáticamente. Las entradas siguen activas para un día válido.

## Plan Consultorio (19/11/2026)

Hecho: el plan está en su página privada `/pricing/consultorio`, a US$ 99 (ver `ESTADO_Y_PRIORIDADES.md`; el guion de venta, en `PLAN_PROSPECCION.md`). Lo que promete se cumple en el setup de cada consultorio:

- [ ] **Urgencias al celular de la profesional:** cargar su celular como teléfono de derivación y una instrucción del consultorio: «ante dolor fuerte, sangrado o hinchazón que no puede esperar al día siguiente, pasale el celular de la Dra. …». Hoy, sin esa instrucción, Sofi crea una tarea urgente y avisa al equipo. Si se repite en varios consultorios, convertirlo en una opción de «Turnos y urgencias».
- [ ] **Pausa automática** cuando la profesional escribe en el chat: Sofi y ella comparten el mismo WhatsApp. Se configura igual que en Guerra–Mininni (`message.any` en su instancia de WAHA y la opción en Equipo por WhatsApp).
- [ ] **Campañas:** importar su lista de pacientes en el setup (Excel, planilla o exportación de su sistema). Mandar la campaña en tandas chicas, en varios días: es WhatsApp no oficial, desde su número.
- [ ] **Costo real:** después del primer mes del primer consultorio, anotar el costo de IA, transcripción de audios y WAHA. La estimación es de US$ 10 a 18 por mes.

## Control de producción y configuración de Sofi (19/11/2026)

- [x] **Tarea 10 revisada:** modo «Crear, mover y cancelar», tres profesionales vinculados, sincronizaciones automáticas y copia de esta mañana aplicada a Turnia. Un turno ya creado por Sofi se comprobó en Smile Connect, con el mismo horario y profesional. La lista activa «Para revisar en Smile Connect» estaba vacía. El registro conserva un movimiento histórico con rechazo por cupo y la Agenda señala turnos pasados sin vínculo externo; no se modificaron para este control.
- [x] **Herramientas de Sofi actualizadas** desde «Equipo por WhatsApp», para el agente general de WhatsApp y el propio de llamadas.
- [x] **Pausa automática configurada y comprobada técnicamente:** `message,message.any` en la instancia exclusiva de Guerra–Mininni, sesión `WORKING` y opción prendida en Turnia. Se comprobó un evento propio de app simulado y firmado: crea la pausa, el entrante queda ignorado y «Reactivar» la retira. Los mensajes de la API no pausan. Se retiró la pausa del número ficticio; no se mandaron mensajes a pacientes.
- [ ] **Prueba de recepción desde la app de WhatsApp del consultorio:** requiere una sesión del 3765. El usuario confirmó el 19/11 que por ahora solo tiene acceso al 5483. Desde ese chat se comprobaron respuestas reales de Sofi sobre los horarios; la prueba manual desde el consultorio queda pendiente hasta contar con su sesión.
- [ ] **Bloqueos: rechazo real 403 de Smile Connect.** Después del [PR #238](https://github.com/axellaban/turniasalud/pull/238) se ejecutó una única sincronización manual a las 10:16 con la misma clave vigente: turnos y horarios correctos, pero `/events` devuelve 403. El usuario indicó que esa clave ya tenía todos los permisos y pidió conservarla. Revisar con Smile Connect la habilitación de `events:read` para esa clave; no generar otra ni revocarla por iniciativa propia. El arreglo distingue 403 de 404 y permite volver a probar desde «Sincronizar ahora» sin cambiar la clave. Sofi sigue verificando la disponibilidad en vivo.
- [x] **Recepción de un aviso de integración confirmada por Axel el 19/11.** Indicó que recibió un mensaje de «Turnia · Smile Connect» en su WhatsApp personal. No se revisó el contenido ni se envió otro aviso para esta confirmación.

## Configuración: auditoría de otra IA (26/11/2026)

Hecho en el código (todos los consultorios):
- **Horario que dice Sofi contra la agenda real:** si «Horario de atención» no coincide con Equipo y horarios, se avisa arriba y bajo el campo, con «Usar este texto» (el armado con los horarios). Sofi recibe además el de la agenda y sabe que vale ese. Vacío: dice el armado.
- **Días con horarios en que Sofi no da turnos** (el viernes de Guerra–Mininni): aviso informativo, no error, porque es a propósito. Sofi ya le dice al paciente que esos días los coordina el equipo.
- **Trato contradictorio** (selector «De vos» y el texto «tratá de usted», o al revés): aviso.
- **Smile Connect como fuente:** en Equipo y horarios, los horarios comunes que vienen de allá dicen «SC» y no se pueden borrar (los vuelve a poner la copia); los de urgencias y de algunas prestaciones siguen siendo de Turnia. En Feriados y bloqueos, los de Smile Connect dicen «De Smile Connect». En Agenda e integraciones, Smile Connect va primero y el método anterior (Tampermonkey) lo ve solo Turnia.
- **Feriados y bloqueos:** agrupados por período y profesionales («del mar 1 dic al jue 3 dic · todo el día · …»), «Quitar» de a varios, el formulario fijo al costado y **«Cargar feriados»** (los nacionales del próximo año, de ArgentinaDatos; los puentes, si se marcan).
- **Guardar:** apagado sin cambios; en Coberturas dice qué guarda. Pestañas con el borde desvanecido cuando hay más para deslizar.
- **Errores legibles** (WAHA, Smile Connect): «No se pudo enviar: la línea de WhatsApp estaba desconectada», con el original en «Detalle».
- **Prestaciones con el mismo nombre** (dos «Turno Smile Connect»): en los selectores se distinguen por especialidad y duración. «+ Particular» con un toque en Coberturas. Una sola zona horaria para la Argentina. «Preguntas frecuentes» pasa a «Sobre el consultorio y preguntas frecuentes».
- **Mismo teléfono para el paciente y para derivar:** Sofi lo recibe en una sola línea.

- **Regla: con Smile Connect como fuente (cualquier modo menos «Apagada»), lo que se maneja allá se ve con candado** (`smileIsSource`). Arriba de cada pestaña, un aviso violeta dice qué se cambia en Smile Connect y qué se configura acá; las pestañas que traen datos de allá llevan la etiqueta «Smile», y cada bloque que no se toca en Turnia aparece con candado y «Se maneja en Smile Connect»: «Agregar profesional» (llegan de Smile Connect y se vinculan solos), «Cargar feriados» (la disponibilidad de allá ya los descuenta) y Google Calendar, que queda plegado si no estaba conectado. El bloqueo manual pasa a «Frenar a Sofi»: sirve para días en que Sofi no tiene que dar turnos aunque allá haya lugar. Lo demás de la Configuración sigue, porque es cómo atiende Sofi y Smile Connect no lo tiene: prestaciones, coberturas, reglas de turnos, urgencias, textos y avisos.

**Segunda revisión (26/11):**
- Corregido el falso positivo del trato: «Tratar siempre de usted… Solo tutear si el paciente lo pide» ya no se marca. Solo cuentan las órdenes generales, no lo condicional.
- Cada aviso se muestra entero en la pestaña donde se corrige (el horario y los días, también en Equipo); en las demás, una línea plegada con el total.
- El aviso de Smile Connect va entero en sus pestañas y en una línea en las de Sofi. Las pestañas llevan un candado chico en lugar de la etiqueta «SMILE», y se cortan de un solo lado.
- «Ver el error técnico» en lugar de un segundo «Detalle». También se corrigió un error de render que causaba ese desplegable dentro de un párrafo.
- Con Smile Connect: el formulario de bloqueos es «Frenar a Sofi» de punta a punta, y los bloqueos cargados en Turnia dicen «Solo Sofi». Sofi ya no repite el motivo interno de un bloqueo de Smile Connect («Día cancelado manualmente»).
- Prestaciones agrupadas: «Las que ofrece Sofi» y, plegadas, «Solo el consultorio» e «Inactivas». Los nombres repetidos también se distinguen en la lista.
- El 403 de bloqueos se explica sin código; el detalle técnico queda en «Qué hacer».
- El aviso de cambios sin guardar funciona: se comprobó en local que pide confirmar al cambiar de pestaña.

**Tercera tanda (26/11):**
- La **ficha de salud** (iniciales y profesionales del encabezado) pasó a la pestaña **Consultorio**. «Turnos y urgencias» queda con lo de los turnos, las urgencias y el fuera de horario, con un índice arriba para saltar a cada sección.
- **Horarios editables en el lugar:** al tocar un horario de Turnia se abre para cambiar las horas o quitarlo (`updateSchedule`). Los de Smile Connect siguen con candado.
- **Equipo por WhatsApp:** una fila por cosa que recibe cada persona (avisos de turnos, acceso total, resumen de las 10), con su estado y su acción, en vez de mezclados en una línea.
- Sigue sin hacer: unir los tres campos de texto libre en uno (es un cambio de contenido de cada consultorio; con los avisos de contradicciones alcanza por ahora).

Ya estaba: el aviso de cambios sin guardar (pide confirmar al cambiar de pestaña y guarda un borrador) y el aviso de precios o plazos que no coinciden.

No se hizo (por ahora): pasar la ficha de salud a la pestaña Consultorio (es otro formulario y otra acción de guardado), editar un horario en el lugar (hoy se quita y se vuelve a cargar), agrupar las prestaciones «solo el consultorio» en las listas, y unir los tres campos de texto libre en uno.

- [x] **Datos de Guerra–Mininni corregidos** (migración `2026-11-26-configuracion-guerra-mininni`, una vez): «Horario de atención» vacío (Sofi dice el armado con la agenda de Smile Connect, siempre al día), sin la web de prueba (`lab-orpin-five…`, otro proyecto en la raíz) y «Particular» sumado a las coberturas del consultorio.
- [x] **Hecho el 26/11 (otra IA con computer use, tarea 11 de `TAREAS_COMPUTER_USE.md`):** (hay que ver el texto actual, que no se lee desde una sesión sin acceso al panel): sacar de «Otras condiciones» los plazos y coberturas que ya son campos; pasar «No hacemos tratamientos de conducto por obra social» a una excepción en Coberturas (prestación de conductos · «No la acepta»); sacar el precio de las preguntas frecuentes; sacar «Tratá siempre de usted» de las instrucciones si el selector ya dice «De usted»; ver si sobra una de las dos «Turno Smile Connect». Ninguno contradice hoy a otro dato: si uno cambia, el panel avisa.

## Smile Connect: ficha completa del paciente nuevo (26/11/2026)

Smile Connect avisó que `POST /patients` ahora acepta más campos (ver su OpenAPI).
- [x] Cuando Sofi da un turno a alguien que no está en Smile Connect, la ficha se crea con nombre, DNI, mail, celular, nacimiento, sexo, domicilio y obra social con plan y afiliado. Si la rechaza, se crea con lo básico y el turno sale igual. Detalle en `SMILE_CONNECT_API.md`.
- [ ] **Verificar el primer alta real → tarea 12 de `TAREAS_COMPUTER_USE.md`:** abrir en Smile Connect la ficha del próximo paciente nuevo que agende Sofi y confirmar que trae la obra social y el nacimiento. Si en «Detalle» aparece `ficha_rechazada`, revisar qué campo rechazó.
- [x] **Traer a Turnia los datos nuevos de Smile Connect:** la copia completa los vacíos (nacimiento, sexo, domicilio, obra social, plan y afiliado) y, desde ahí, cada cambio que haga recepción allá pasa a Turnia. La primera vez no se pisa lo que Turnia ya sabe.
- [ ] **Mandar el pedido a Smile Connect para el 10/10** (texto en `SMILE_CONNECT_API.md` → «Pedido a Smile Connect para el 10/10»): editar pacientes, `updated_since` o webhook, marcar la confirmación, turnos con dos profesionales y el 403 de `events:read`. Reemplaza el pedido de `updated_since` de abajo.
- CUIT y «cómo llegó» no se mandan: Turnia no los pide.

## Sofi confirma en el mismo mensaje, prompt más corto y batería de pruebas (25/11/2026)

Salió de leer las charlas reales de Guerra–Mininni del 16 al 25/11.

- [x] **Confirmación en el mismo mensaje por WhatsApp.** Al reservar, mover o cancelar por chat, la herramienta escribe el pedido en Smile Connect y espera hasta 7 s (`SMILE_CHAT_WAIT_MS`, 0 apaga la espera). Si llega, Sofi contesta «Turno confirmado» (o que el horario se ocupó, o que lo revisa recepción) y el aviso posterior al paciente no sale: queda como «Dicho en el chat» (`clinic_notices.status = 'en_chat'`). Si no llega a tiempo, sigue como antes (pendiente y confirmación por WhatsApp). Por teléfono y desde el panel no cambia nada.
- [x] **Prompt general más corto y ordenado** (de unos 21.000 a 17.000 caracteres, mismas reglas) con una revisión final antes de mandar. Ante «limpieza» sin saber si es primera vez, pregunta si ya se atendió sin nombrar la práctica.
- [x] **Filtro de fórmulas en WhatsApp** (`withoutFormulas` en `whatsapp-style.ts`): saca del final «Que tenga un buen día», «Necesita algo más?», «Quedamos a disposición», «Tiene alguna otra consulta?», «Hasta pronto» y el «Con gusto» del principio, que el prompt prohíbe pero a veces se escapan. Si el mensaje es solo eso, queda como está.
- [x] **Batería de pruebas** (`npm run probar-sofi -- --agente <id> --clinica "Guerra"`): siete casos de charlas reales, simulados en ElevenLabs con todas las herramientas simuladas (no toca la agenda ni Smile Connect). Prueba el prompt del repositorio sin cargarlo en el agente; con `--prompt actual`, el cargado. Correrla después de cada cambio de prompt y antes de «Actualizar a Sofi». El 25/11: 14/14 con el prompt nuevo (dos corridas por caso) y 7/7 con el cargado.
- [x] Prompt nuevo cargado el 25/11 directo en los dos agentes de ElevenLabs (WhatsApp general y llamadas de Guerra–Mininni), solo el texto del prompt: se comprobó que no cambió nada más (herramientas, modelo, transferencia, saludo). Batería contra el prompt cargado: 7/7 (con la reserva simulada corregida). Las charlas que estaban abiertas en ese momento siguen con el prompt anterior hasta cerrarse (el botón las reinicia; por API no).
- [ ] Sumar casos a la batería cuando aparezca un error nuevo en una charla real (en `scripts/probar-sofi.mjs`, con pacientes ficticios: el repositorio es público).

## Lista de espera como la secretaria (25/11/2026)

- Pedido de Mariano (Guerra–Mininni): que Sofi haga como la secretaria, primero cerrar un turno y además anotar en lista de espera. Si no, el paciente cree que estar anotado le asegura un turno antes y, cuando no se libera nada, termina más atrás.
- [x] `anotar_lista_espera` (`joinWaitlist`): sin `turno_id` rechaza la inscripción y le pide a Sofi reservar primero el primer horario que le sirva. Si el paciente ya tiene un turno futuro de esa prestación, le devuelve su `turno_id`. Sin turno solo con `sin_turno` (`no_hay_horarios` o `no_quiere_turno`). El equipo no tiene esta restricción.
- [x] Prompt y mensajes de la herramienta: «Le reservo el lunes 21/12 a las 10:30 y lo anoto en la lista de espera: si se libera un lugar antes, le escribimos». Sin prometer que lo adelantan; sin turno, se aclara que todavía no tiene turno.
- [x] Desplegado ([PR #264](https://github.com/axellaban/turniasalud/pull/264)) y «Actualizar a Sofi» hecho el 25/11.

## Sofi le explicó reglas a una paciente (25/11/2026)

- Por WhatsApp, Sofi le escribió a una paciente de Guerra–Mininni «como ya es paciente, puede pedir directamente el mantenimiento, sin una consulta de primera vez» y que la profesional del mantenimiento no atiende el martes. El usuario pidió que no vuelva a pasar.
- [x] Prompt: las reglas de la clínica (qué turno corresponde, quién hace cada práctica, qué días atiende cada uno) se aplican sin contarlas; si un día no se puede, solo «ese día no tengo lugar»; un error se corrige ofreciendo lo correcto, sin explicarlo. Con un ejemplo de mal y bien.
- [x] Desplegado ([PR #264](https://github.com/axellaban/turniasalud/pull/264)) y «Actualizar a Sofi» hecho el 25/11.
- [x] «Instrucciones adicionales» de Guerra–Mininni reescritas el 25/11, más cortas: sin lo que repetía el prompt general, el viernes sin explicar la regla («ese día no tengo lugar») y la lista de espera con un turno reservado primero.

## Feedback de Guerra–Mininni sobre Sofi (18/11/2026)

- Hecho y en producción (PR #223 a #227): primer turno del día, «molestia» no es urgencia (la guardia solo con mucho dolor, sangrado o hinchazón), no prometer días antes de mirar la agenda, datos juntos por WhatsApp, sin reglas internas ni «limpieza», radiografías en un párrafo aparte, y días que Smile Connect no confirmó a tiempo sin darlos por llenos. Prompt actualizado en los dos agentes de ElevenLabs.
- **Falta, en el panel:** [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md), tarea 9. Copiar los horarios de Smile Connect (la fuente de verdad) a «Equipo y horarios», corregir el horario de atención y la línea de horarios de las instrucciones.
- Hecho (tarea 9, por computer use): horarios de los tres profesionales iguales a Smile Connect, horario de atención y línea de horarios de las instrucciones.
- **Guerra–Mininni es cliente** (migración `2026-11-18-guerra-mininni-cliente`): su ficha dejó de ser una demo conservada. Ahora Sofi avisa a la lista de espera cuando se libera un turno, la respuesta de recepción a un pedido le llega al paciente y vuelve a escribirle a quien no contestó los horarios. Las campañas salen solo si alguien las manda. El WhatsApp general de Turnia nunca toma una clínica con línea propia (`whatsappClinic`).
- **Smile Connect es la fuente de la verdad** (18/11). El consultorio no entra al panel de Turnia y todo lo que cambia en Smile Connect llega solo:
  - turnos y asistencia, cada 30 minutos;
  - lo que se cargue tarde (hasta 30 días atrás), los turnos de 61 a 120 días y los datos de los pacientes, con la copia diaria;
  - el horario de cada profesional, cada 6 horas;
  - las notas, la prestación y los bloqueos.

  La Agenda ya no pide marcar asistencia. Detalle en [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md).

- [ ] Propuesta, sin pedir todavía (el 18/11 Axel dijo «por ahora no»): cuando recepción cancela un turno en Smile Connect, ofrecérselo a la lista de espera de Turnia. Hoy solo se ofrece lo que se cancela por Sofi o por el panel. Es un mensaje nuevo a pacientes en producción.
- **Pacientes en la copia diaria y avisos a Axel** (18/11):
  - los pacientes nuevos se leen todos los días y la lista completa, dos veces por semana, para no comerse el cupo de lecturas;
  - los problemas de la integración le llegan a Axel por WhatsApp.
- [x] Avisos a Axel con la demo pausada (18/11): ya no dependen del selector de la demo pública (`demo.canal = pausado`). Si la línea general de WAHA no responde, van a n8n (`axel.aviso`).
- [ ] **Pedirle a Smile Connect `updated_since`** (lo manda Mininni; texto en `SMILE_CONNECT_API.md` → «Pedido a Smile Connect»). Turnia ya está lista y lo usa sola en cuanto aparezca en el OpenAPI.
- Ideas evaluadas el 18/11, sin pedir:
  - ventana cercana de 4 a 8 días («la semana que viene», casi al mismo costo);
  - copia hasta 180 días (controles semestrales);
  - pedirle a Smile Connect un filtro `updated_since`;
  - precios de Sofi desde Smile Connect.

## Costo de Neon en producción (18/11/2026)

- [ ] **Revisar el consumo de Neon Launch el 25/11.** Se activó el 18/11 para recuperar Turnia después de que se agotó el cupo de Free. En Vercel → Integraciones → Neon → Usage, anotar el gasto real desde el cambio, separando producción de la otra base si el panel lo permite. Con ese dato, decidir si seguimos en Launch o evaluamos un PostgreSQL gratuito administrado (Supabase o Aiven) o en el VPS de Hostinger. Antes de evaluar el VPS, comprobar capacidad, backups externos y restauración.

## Smile Connect por API y avisos por WhatsApp (16/11/2026)

- **Actualizado el 18/11:** la escritura real está activa (`SMILE_CONNECT_WRITES=on`). Por pedido de Axel, el modo pasó a «Crear, mover y cancelar»: Sofi crea, mueve y cancela en Smile Connect, y las visitas combinadas siguen yendo a recepción. Lo de abajo es el estado del 16/11.
- [x] **Control en producción por computer use: tarea 10 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).** Revisado el 19/11; los faltantes concretos están al principio de este archivo. Se conserva la clave actual por indicación del usuario.
- **Lectura verificada y «Escritura de prueba» en producción (16/11).** El consultorio cargó la clave y el userscript de Tampermonkey quedó desactivado. Los 39 turnos vigentes de Smile Connect para el 17 y 18 estaban en Turnia. Seis turnos adicionales de Sofi por WhatsApp quedan para conciliar antes de activar la escritura real.
- **Siguiente paso.** Revisar el registro de operaciones de prueba con el consultorio y probar primero la creación de un turno. Ver [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md) y la tarea 7 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Avisos por WhatsApp al consultorio:** van en el mismo PR. Falta saber a qué celulares mandarlos (se cargan en Configuración).

## Dominio y canales (14/11/2026)

- **Agenda y conversaciones en producción.** `APP_URL` usa `https://turniasalud.app`. El dominio anterior conserva el 308. La demo ofreció horarios con `consultar_disponibilidad`; una segunda charla se guardó con resumen y transcripción al cerrarla, por el nuevo webhook post-call de ElevenLabs. Google acepta ambos callbacks.
- **Telegram retirado de Turnia.** El selector pasa a pausado si apuntaba a Telegram. Se cierran sus sesiones activas y se conserva el historial. La demo funciona en el navegador y el WhatsApp de cada consultorio conserva su configuración. Las pruebas del producto usan WhatsApp o el navegador.
- **WAHA.** Los webhooks de la línea general y de Guerra–Mininni todavía apuntan al dominio anterior. Estado y alcance en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Recuperación histórica.** `POST /api/prospeccion { followup: { op: "conversations-backfill", desde } }` trae las conversaciones de ElevenLabs sin duplicarlas ni disparar tareas y avisos. Chapa Labs lo ejecuta todos los días a las 8:20 para los últimos tres días. La ejecución del 14/11 desde el 05/11 recuperó el registro que faltaba y terminó sin errores.
- El trabajo de configuración restante está en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).

## Smile Connect: después del QA del 18/11

- [ ] En Guerra–Mininni, mirar «Lecturas de hoy» en Configuración → Agenda e integraciones un par de días. Si pasa de 7.000, la sincronización ya se espacia sola; si sigue cerca, revisar la ventana cercana.
- [x] Pasar a la configuración de cada clínica lo que estaba atado a Guerra–Mininni en el código (18/11): verificación de identidad desde otro número, ficha de salud y días del resumen. Guerra–Mininni no cambia.

## Auditoría del panel: lo que quedó pendiente (18/11/2026)

Las seis fases de la auditoría están hechas (PR #210 a #215) y, después, lo pendiente (PR #216 y #217; ver `ESTADO_Y_PRIORIDADES.md`). Lo que falta es configuración, en la **tarea 8** de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md):

- [x] **«Actualizar a Sofi»** ejecutado el 19/11: herramientas renombradas (`equipo_buscar_pacientes`, `equipo_crear_paciente`) y nuevas (`pausar_chat`, `reactivar_chat`) en WhatsApp y llamadas.
- [x] **Pausa automática en Guerra–Mininni:** `message.any` agregado, opción prendida y circuito comprobado con un evento firmado de prueba el 19/11. La prueba desde la app del consultorio queda identificada arriba.
- [x] Pausa de Sofi por WhatsApp para el equipo (`pausar_chat`, `reactivar_chat`).
- [x] Pausa automática cuando recepción contesta desde el celular: Turnia anota lo que manda y lo distingue de lo que escribe el equipo. Ignora los automáticos de WhatsApp Business. Apagada por defecto.
- [x] Renombrar las herramientas parecidas, con alias de los nombres anteriores.

## Resumen diario de Sofi para Guerra–Mininni (16/11/2026)

El Dr. Mininni pidió **un resumen de Sofi a las 10** y poder **preguntarle a Sofi** por los datos del turno. Así recibe el motivo y la prestación que la API de Smile Connect todavía omite.

- [x] El celular del Dr. Mininni está cargado en «Acceso total por WhatsApp». El envío de prueba salió a los dos celulares configurados el 16/11, con el [PR #200](https://github.com/axellaban/turniasalud/pull/200) en producción.
- [ ] Verificar el primer resumen automático del martes 17/11 a partir de las 10.
- [x] Agentes actualizados por el usuario el 16/11: Sofi ya tiene `detalle_turno` y `turnos_de_sofi`.
- [x] Unificar listas (18/11, [PR #211](https://github.com/axellaban/turniasalud/pull/211)): Configuración → «Equipo por WhatsApp» muestra cada celular una vez con avisos, resumen y acceso total. Por dentro siguen las dos tablas.
- [x] Decir en el resumen si el turno ya quedó escrito en Smile Connect (18/11, [PR #216](https://github.com/axellaban/turniasalud/pull/216)).

## Resultados de Chapa Labs: ejecución de la cola (11/11/2026)

`GET /api/prospeccion?vista=followup` suma, en `results`, lo mismo que habita.: `execution` (la cola día por día y por tipo de acción: pendientes, ejecutadas por persona o bot, exitosas, bloqueadas, sin tomar, no salieron y reprogramadas), `weeklyByType` y `actionLabels`. Lógica en `src/lib/sales/followup-results.ts`; tabla `sales_followup_queue_days` y columna `sales_followup_executions.executed_by` en `supabase/schema.sql` (se aplican solas en el próximo build de producción).

- **Exitosa** en Turnia: la persona avanzó de paso después del envío (su definición de conversión de siempre; Turnia no guarda cuándo, así que no hay ventana).
- **11/11 (revisión):** la cola cuenta también los mensajes que salieron sin «Confirmar envío» (`messageExecutions` en `followup-results.ts`, desde `sales_outreach_events` kind «mensaje»): antes daba 0 ejecutadas. El saludo es exitoso si respondieron después (`sales_whatsapp_chats.last_received_at`); el resto, si avanzó de paso.
- La foto se guarda cuando Chapa pide la cola (como mucho cada 10 minutos). Turnia no tiene cron: un día en que nadie abre Chapa queda solo con lo ejecutado.
- Hoy no hay envíos automáticos: todo cuenta como «humano» hasta que un bot registre `executed_by = 'bot'`.
- Las cohortes con las etapas del panel (Por contactar … Cliente Fundador) se calculan en Chapa con las cuentas que ya manda Turnia; no hizo falta cambiar nada acá.

## Paridad con Commercial OS de Chapa Labs (09/11/2026)

La nueva UI de Chapa Labs se comparte con habita. y Turnia: General, Cola, Respuestas, Embudo por etapas, Prospectos, Reglas y Mensajes, Resultados y Etapas/Situaciones. **Turnia mantiene su cola y su embudo existentes** con confirmación de envío, horarios y secuencia a recepción; no hay cambio en sus datos ni cadencias por este rediseño.

**Pendiente para paridad funcional real (no fingir editor):**
1. Exponer `catalog: { stages, states, overrides, available }` en `GET /api/prospeccion?vista=followup`, adaptado a sus etapas `FOLLOWUP_STAGES`, sin copiar las claves de habita.
2. Persistencia y validación de situaciones custom por etapa, manteniendo estados de baja y clasificación de respuestas automáticas.
3. Reglas editables, orden y condiciones, con equivalentes seguros de `rule-save` y versiones editables `version-update`. No usar la secuencia de habita.: Turnia conserva saludo sin link, Paso 2 permiso, 3 mensajes, límites y horario.
4. Tests con Postgres real y reconciliación con Turnia Panel → Prospección y PostHog antes de habilitar edición en Chapa.
5. Revisar autenticación del operador y las dos líneas WAHA, evitando envíos repetidos en sesiones simultáneas.

El catálogo en Chapa se muestra por ahora en modo lectura para Turnia, con enlace al editor nativo. La paridad visual en Chapa sí está disponible; la paridad de API **todavía no**.


Actualizado: 08/11/2026 (Argentina). El centro comercial (Chapa Labs + Turnia + habita.) y la prospección tienen su traspaso en [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md). Este archivo junta, en un solo lugar y por prioridad, todo lo que queda. El detalle de cada tema está en los documentos enlazados. No contiene credenciales.

## Antes de empezar

1. Leé [`AGENTS.md`](AGENTS.md): esta versión de Next.js (16.4) cambia APIs. Consultá `node_modules/next/dist/docs/` antes de escribir código.
2. Leé [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md), que tiene el registro de lo hecho y prevalece sobre los documentos más viejos.
3. Ramas: se trabaja en una rama, se abre un PR contra `main`, CI (`verificar`) y Vercel tienen que dar verde, y se hace merge squash. Producción se publica sola desde `main` y cada deploy aplica `supabase/schema.sql` (idempotente) con `scripts/migrate-db.mjs`.
4. Diseño: hay skills en `.claude/skills` (`frontend-design`, `web-design-guidelines`, `react-best-practices`, `impeccable`); ver su `README.md`. Para auditar accesibilidad, axe-core está en `node_modules`.
5. Pruebas locales: `npx tsc --noEmit`, `npx eslint src`, `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run` (177 tests al 23/10) y `npx next build`. Para mirar la web, `next start` con un Postgres local; Chromium está en `/opt/pw-browsers`.
6. Google Calendar y Google Sheets: cómo están armados y qué falta configurar en `GOOGLE_CALENDAR.md` y `GOOGLE_SHEETS.md` (usan la misma conexión con Google).

## Reglas que no se rompen

- **No contratar planes ni cargar saldo** (Vercel está en Hobby, así que Skew Protection no se activa).
- **Conservar las instancias WAHA anteriores.** El 02/11 el usuario autorizó crear y configurar una nueva, `n8n/turnia-guerra-mininni-waha`, para el piloto de Guerra–Mininni. No modificar `n8n/waha` ni `n8n/turnia-waha`. La nueva copia usa la imagen exacta de las anteriores; no actualizarla al copiar una etiqueta mutable. Estado operativo y pruebas en `ESTADO_Y_PRIORIDADES.md`.
- **HolaVeggie y las líneas existentes de Twilio están operativas:** no modificar sus números, agentes, webhooks ni credenciales. Turnia usa la misma cuenta por decisión expresa del usuario; el saldo es compartido.
- No pegar credenciales en chat, repo ni documentos.
- No regenerar los audios de la web ni cambiar permisos de ElevenLabs sin que el usuario lo pida.
- Gmail de n8n está vencido y el usuario pidió **no** reconectarlo ni reintentar envíos hasta que lo retome.
- No usar material de Assort Health (videos, fotos, textos literales). La web es un copycat de estructura, no de contenido.
- No inventar clientes, testimonios ni métricas.

## 1. Pendiente del usuario (no se puede hacer desde el código)

- [ ] **Google Sheets (prospección y pedidos de demo):** en el proyecto de Google Cloud de Calendar, habilitar **Google Sheets API** y agregar el permiso `drive.file`. Después, Panel → Prospección → Google Sheets → «Conectar con Google». Para que el permiso no venza a los 7 días, publicar la app. Pasos en [`GOOGLE_SHEETS.md`](GOOGLE_SHEETS.md). Con esto ya no hace falta lo de Apps Script. A la planilla «Interesados TurnIA» conviene sacarle la edición pública o borrarla, porque está vacía.

- [ ] **Consultorios con web:** importar `consultorios-con-web-mdp-miramar.csv` (entregado por chat) en Panel → Prospección → Importar lista, con «Reemplazar los datos de los que ya están por los del archivo» marcado. Suma 13 personas y les carga la web y el WhatsApp del consultorio a 12 que ya estaban.
- [ ] **Prospección de la semana (26 al 30/10):** importar `lista-odontologos-mdp-miramar.csv` en Panel → Prospección → Importar lista (el archivo se entregó por chat; no va al repo), poner el perfil de Turnia en su WhatsApp Business y seguir «Para hoy». Plan en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).
- [ ] **Lista 3 de prospección, Mar del Plata, Miramar y alrededores (02/11):** importar `lista-mdp-miramar-nuevos.csv` (entregado por chat; no va al repo) en Panel → Prospección → Importar lista, sin marcar «Reemplazar». 268 personas que no están en la lista 1 (salen de las cartillas de OSDE y Swiss Medical): 111 con celular y 157 con fijo. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).
- [x] **Lista 4 de prospección, alrededores de Mar del Plata (08/11), importada por el usuario el 08/11 (la base quedó en 967):** se importó `lista-4-alrededores-mdp.csv` (entregado por chat; no va al repo) en Panel → Prospección → Importar lista, sin marcar «Reemplazar». Son 258 personas que no están en la base: 154 con WhatsApp (117 de Tandil, Necochea, la Costa, Pinamar y Villa Gesell, y 37 consultorios de Mar del Plata que faltaban) y 104 fijos. Los que pagan anuncios en Google o en Instagram y Facebook van con prioridad 1 y la marca «Google Ads» o «Meta Ads» en Chapa Labs (cambio en `facundogregorini-lab/chapa-labs`, rama `claude/epic-fermi-pfi5jh`). Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Lista 4».
- [ ] **Volver a hablarles a los que pagan anuncios en Mar del Plata y Miramar (08/11)** (la marca en «Señales» ya se importó el 08/11; falta escribirles con el ángulo de anuncios): `recontactar-ads-mdp-miramar.csv` (entregado por chat) tiene 15 (11 con Google Ads, por SerpApi), con su estado y otro canal para los que ya usaron los tres WhatsApp. Para marcarlos en el panel, importar `marcar-ads-en-turnia.csv` con «Reemplazar» marcado (solo cambia «Señales»). Para repetir la búsqueda de anunciantes hace falta una clave de SerpApi propia (la usada era un secreto del entorno de la sesión de IA, no del proyecto); el lunes 9/11 tocaba repetir las búsquedas de Google con anuncios en horario de atención (ver [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md)). Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Volver a hablarles a los que pagan anuncios».
- [ ] **Lista 2 de prospección, otras ciudades (02/11), si se quiere salir de la zona:** `lista-odontologos-2-sin-repetidos.csv` (la versión anterior `lista-odontologos-bahia-laplata-costa.csv` no se importa). 1.247 personas de Tucumán, La Rioja, Bahía Blanca y La Plata, sin repetir con las listas 1 y 3: 518 con celular.

- [ ] **Cierre de la demo con «Escribirle a Axel» (05/11), probarlo en producción:** abrir una demo `/p/<código>` desde el celular (no desde el panel), hablar con Sofi hasta reservar el turno de prueba y comprobar que Sofi dice «Esto fue la demo…», que al terminar aparece la nota de Axel y que el botón abre WhatsApp con el mensaje escrito al +54 9 11 3023-5483. Desde el 07/11 `/p/<código>` es una sola pantalla con la esfera: probarla también en un iPhone (Safari), por voz y por chat. En la ficha tiene que figurar «Tocó «Escribirle a Axel»». Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Después de la demo».
- [x] **Audios de seguimiento (06/11):** Turnia envía notas nativas desde el WhatsApp terminado en 0022. Se reutilizó `n8n/waha` con su sesión `default` sin webhooks, y `WAHA_PROSPECCION` quedó en Production. Confirmada la nota de voz del 0022 al 5483. Para «Mandármelo», usar el 5483: la prueba al chat propio del 0022 quedó pendiente.
- [ ] **La secuencia a la recepción (09/11):** probar en vivo desde Chapa («Audios y mensajes»): Paso 1 a uno nuevo; cuando responda, «Leer las respuestas» y el Paso 2; cuando diga que sí, el Paso 3; el Seguimiento 3 tiene que llegar como dos mensajes. Ver `PLAN_PROSPECCION.md` → «Los mensajes».
- [x] **El cierre de la demo `/p/<código>` para la recepción (09/11):** «Reenviárselo a los doctores» (el mensaje para los doctores del Seguimiento 3) y «Escribirle a Axel» por la línea que le escribió (WAHA) o, a mano, el 5483. Falta verlo en vivo al terminar una charla. Ver `PLAN_PROSPECCION.md` → «El cierre para la recepción».
- [ ] **Chapa Labs → Turnia → Odontólogos:** verificar en vivo «Mandar audios», autorizar con la sesión de Turnia, grabar y enviar una prueba al 5483. Se elige un audio por etapa. Para el 0022, seleccionar solo los contactos iniciados desde esa cuenta.

- [ ] **Comparar las dos versiones de la demo personal (08/11), cuando B tenga 15 a 20 visitas:** el 07/11 se sacó el botón «Probar la demo» (A) y quedó una sola pantalla con la esfera (B). El embudo se reconfiguró para compararlas de punta a punta, **visitaron → hablaron con Sofi**, en PostHog (tablero «Turnia · Prospección» → «Demo personal: A contra B»), en `npm run embudo` y en Chapa Labs. Al 08/11: A 10 de 16 (63%), B 1 de 4 (25%), y 3 de los 4 de B no tocaron la esfera. Todavía es poco para decidir. Detalle en [`EMBUDO.md`](EMBUDO.md) → «Las dos versiones de la demo personal».
- [ ] **Lectura diaria de WhatsApp (08/11): falta la línea 5483.** Las respuestas de los prospectos entran solas leyendo una vez por día los chats de las dos líneas de WAHA (solo lectura, no se toca `n8n/waha`). La dispara Chapa Labs a las 8 y su botón «Leer WhatsApp ahora». Primera lectura real, 08/11:
  - **0022: funciona.** 70 personas de la base con chat; 14 contestaron (sin contar respuestas automáticas); 2 esperan respuesta. La primera pasada contó como respuesta las automáticas de WhatsApp Business y la segunda corrigió a 4 que solo tenían eso (turniasalud#151).
  - **5483 (el WhatsApp desde donde sale la prospección): no se pudo leer.** WAHA no devuelve sus chats porque esa sesión usa NOWEB sin historial. Hay que prender el store de esa sesión en WAHA (`config.noweb.store.enabled = true` y `fullSync = true`) y reiniciarla. Es un cambio en WAHA: lo decide el usuario.
  - Detalle en [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md) → «Lectura diaria de WhatsApp».
- [ ] **Chapa Labs como centro comercial (08/11):** con la base actualizada (el build aplica `supabase/schema.sql`), abrir `/prospecting` en Chapa Labs → «Hoy» con «Todas» y ejecutar una tanda real de 10 por producto: tomar, abrir WhatsApp, confirmar. Comprobar que la otra persona ve «Lo tiene …» y que el contacto aparece en Panel → Prospección. El panel de Chapa sigue abierto sin contraseña por decisión del usuario (08/11): definir el login antes de compartir el link. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «La cola, operada desde Chapa Labs».
- [ ] **Embudo semanal** (cada lunes): correr `npm run embudo` con `POSTHOG_PERSONAL_API_KEY` y `DATABASE_URL`, pegar la columna nueva en [`EMBUDO.md`](EMBUDO.md) y completar las cuentas de la semana 1, que quedaron sin dato. Marcar «Cliente» en Prospección solo cuando entra el primer pago.
- [ ] **PostHog (analítica):** una vez publicado, en el proyecto «Turnia Salud» activar Session replay, filtrar el tráfico interno (`is_internal`) y autorizar el dominio; después, armar los tableros y hacer la validación. Pasos en [`ANALITICA.md`](ANALITICA.md) (6, 7 y 8).
- [ ] **Rotar las credenciales** que quedaron expuestas durante el diagnóstico de WAHA (ver la sección «Diagnóstico histórico de vinculación WAHA» en `ESTADO_Y_PRIORIDADES.md`).
- [x] **WAHA vinculado por el usuario**, quien confirmó que funciona. No repetir el diagnóstico ni modificar su conexión. El WhatsApp general se administra en Sistema.
- [ ] Decidir si los avisos al equipo salen por email (requiere reconectar Gmail en n8n) y a quién van los avisos asistenciales.
- [ ] Opcional: un video propio para el hero, si no quiere los clips de stock (ver 4).

## 2. Prueba en vivo

- [ ] **Límites de Sofi (05/11), después del deploy:** actualizar los dos agentes: Sistema → «Crear / actualizar agente», para que Sofi tenga `silenciar_numero`, y Configuración (Guerra–Mininni) → «Crear / actualizar Sofi de esta clínica», para que las llamadas corten a los 8 minutos y tras 20 s de silencio. Probar desde otro teléfono escribiendo como vendedor («Hola, ofrecemos software para consultorios»): Sofi contesta una vez y el número aparece en Conversaciones → Números en pausa; reactivarlo al final. Detalle en `ESTADO_Y_PRIORIDADES.md` → «Límites de Sofi».
- [ ] **Turno completo por llamada en Guerra–Mininni:** el 03/11 se verificó que Sofi atiende las llamadas al número habitual, con el desvío de Movistar al destino interno de Twilio y el agente propio en ElevenLabs. Queda probar una reserva ficticia por llamada, verla en la agenda del consultorio y cancelarla.

- [ ] **Notas de voz en WhatsApp (03/11):** desde otro teléfono, mandarle un **audio** a la línea de Guerra–Mininni y confirmar que Sofi contesta con **nota de voz** que se escucha bien (y, si hay link, también por escrito); escribirle «mandámelo en audio» y confirmar lo mismo; después escribirle texto común y confirmar que vuelve a contestar con texto. Si llega texto en vez de audio, mirar en Vercel el log «No se pudo mandar la nota de voz; se entrega el texto» (voz del agente, Text to Speech o `sendVoice` de WAHA). Cada respuesta en voz consume Text to Speech de ElevenLabs.
- [x] **Línea propia de Guerra–Mininni (02/11), +54 9 11 7243-3765:** `WORKING` y cuenta correcta verificados. El usuario recibió respuestas reales de texto y audio; conversación en la ficha correcta. Con datos ficticios se comprobaron reserva, cancelación por chat con más de 24 horas, derivación a recepción con menos de 24 horas, lectura de una foto descargada de WAHA y documento guardado en la ficha. Pruebas técnicas de reserva/foto dirigidas al propio número de Sofi, con eventos entrantes firmados; falta observar una foto desde otro teléfono. Datos ficticios retirados. PR #84 publicado, 330 pruebas aprobadas. Mantener la sesión operativa; no repetir la vinculación ni pedir la terminal. La ficha del consultorio conserva su carácter de prueba.

- [x] Demo en el navegador probada en producción (24/10): lectura, chat y voz.
- [x] La demo en el navegador entra en una pantalla, en la computadora y en el celular (24/10; detalle en `ESTADO_Y_PRIORIDADES.md`).
- [ ] Que el usuario la pruebe con su propia voz y mire el interesado en Panel → Pedidos de demo (el de prueba es `prueba-claude@turnia.test`, se puede borrar). La demo arranca en voz.

Cuando el usuario elija reactivar WhatsApp desde Panel → Sistema (sin cambiar WAHA):


- [ ] `https://turniasalud.app/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`.
- [ ] **Demo con tu web** (`/probar-demo`), con el WhatsApp del usuario y datos ficticios («Prueba Turnia», DNI 11111111, particular): opciones 1/2/3, chat hasta reservar, `MENU` → audio (¿llega nota de voz?), `MENU` → llamada, `SALIR`. Medir cuánto tarda la lectura de la web con Claude. Checklist completa en `PLAN_LEAD_MAGNET.md` (paso 5 y «A verificar en vivo»).
- [ ] WhatsApp general de la demo: completar memoria y receta. **La línea propia de Guerra–Mininni ya probó texto y audio reales, y reserva, cancelación y derivación en la prueba técnica del 02/11.**
- [ ] **Probar a Sofi (03/11):** con el código del Dr. Mininni, abrir Panel → Probar a Sofi y probar ambos accesos:
  - **WhatsApp:** escanear el QR desde otro celular.
  - **En esta pantalla:** hablarle y escribirle.

  Cancelar los turnos de prueba al terminar.
- [ ] **Seguimiento cuando el paciente no contesta (Guerra–Mininni, 03/11):** confirmar en n8n que el disparador de cada 10 minutos a `/api/automations/calendario` está activo; sin él no sale ningún seguimiento. En Configuración → «Si el paciente no contesta», elegir 1 o 2 veces y las horas de espera. Probar desde otro teléfono con datos ficticios: pedir un turno, no contestar los horarios y esperar el mensaje (de 9 a 20). Contestar y ver que Sofi vuelve a mirar la agenda antes de reservar. Cancelar al final.
- [ ] **«Consulta de implantes» (Guerra–Mininni, 03/11):** después del deploy, actualizar los dos agentes (Sistema → «Crear / actualizar agente» y Configuración → «Crear / actualizar Sofi de esta clínica»). Revisar que haya una prestación de consulta de 30 minutos, sin «Solo la da el consultorio». Después, por WhatsApp y con datos ficticios, pedir «un turno para una consulta de implantes». Sofi tiene que ofrecer horarios y confirmar «Consulta de implantes», y el turno tiene que figurar así en la Agenda. Cancelarlo al final.
- [ ] **Control y limpieza en la misma visita (Guerra–Mininni):** el 03/11 se actualizaron el agente de WhatsApp y el de llamadas y se habilitó «Mantenimiento periodontal (limpieza)» de 45 minutos. Falta la prueba de punta a punta por WhatsApp con datos ficticios. Verificar una visita con la Dra. Coldeira, con las dos prestaciones consecutivas en agenda, y cancelar al final. Revisar con recepción dos turnos previos anunciados como limpieza que figuran como «Control», antes de ajustar prestación o duración.
- [ ] **Fotos por WhatsApp:** en Guerra–Mininni ya se probó descarga de WAHA, lectura de una credencial ficticia, respuesta y foto guardada en la ficha (02/11; evento entrante técnico y entrega al propio número). Completar desde otro teléfono y con los tipos orden/receta.
- [ ] Una conversación hablada completa con una persona (la llamada web solo se probó hasta el saludo).
- [ ] Anotar los resultados en `ESTADO_Y_PRIORIDADES.md` y `PLAN_LEAD_MAGNET.md`.

## 3. Panel (estado: completo y auditado)

Está en producción y probado con un recorrido de 31 comprobaciones: roles administrador/consultorio, códigos por clínica, guardado con avisos, borradores locales, historial de cambios y redirecciones de direcciones mal escritas. Lo que falta:

- [ ] El consultorio Guerra–Mininni (cliente desde el 18/11) tiene que entrar con su código y cargar sus reglas reales. El código lo crea el administrador en Panel → Configuración → «Acceso del consultorio» y se manda por WhatsApp desde ahí.
- [x] **Google Calendar** (24/10): credenciales en Vercel, reintentos en n8n y conexión probada en vivo por el usuario (demo «Marcos», el turno apareció en su calendario). Para clínicas reales falta publicar la app y pasar la verificación de Google. Ver [`GOOGLE_CALENDAR.md`](GOOGLE_CALENDAR.md).
- [ ] **Avisar al paciente cuando la clínica cancela o mueve un turno.** Hoy el panel avisa que hay que hacerlo a mano. Se puede mandar por WhatsApp cuando el canal esté conectado. Desde el 4/11, si el profesional mueve o borra el turno en su Google Calendar, el equipo recibe una tarea.
- [x] **Familias con un mismo celular** (02/11): cada persona tiene su ficha aunque compartan el celular. El agente sabe quiénes comparten el número, pregunta para quién es y pasa a la ficha del familiar con `buscar_paciente` (DNI y nombre); `registrar_paciente` con otro DNI y otro nombre crea la ficha del familiar en lugar de pisar la del dueño. El turno a mano pregunta para quién es. Detalle en `ESTADO_Y_PRIORIDADES.md`.
- [ ] **Validar la actualización de la agenda de Smile Connect en Guerra–Mininni:** el histórico ya está cargado. Al revisar el 03/11, `Panel → Configuración → Calendario → Smile Connect` mostraba sincronización activa con última actualización el 02/11 a las 21:22 (Argentina). Verificar el userscript en la computadora de recepción y comprobar que un cambio de agenda de prueba en Smile Connect se refleje en la disponibilidad que ofrece Sofi.
- [ ] **Importar la ficha completa de Guerra–Mininni** (si se prefiere revisar a mano los celulares compartidos desde el CSV de 859 filas en vez del ZIP de Smile Connect): Panel → Pacientes → Importar, con el consultorio Guerra–Mininni elegido. Código de área 11 (sugerido). Revisar en la vista previa los celulares que aparecen en más de una fila: hay casos dudosos (por ejemplo, un nombre que está contenido en otro con otro DNI, o dos apellidos parecidos sin DNI) que conviene confirmar con el consultorio. Resultado esperado: 859 filas → unas 841 fichas, 338 visitas, 23 celulares compartidos por familias y 12 fichas sin celular. Se puede deshacer.
- [ ] Probar en vivo con un celular compartido: que Sofi pregunte para quién es y pase a la ficha del familiar con su DNI.
- [x] **Fichas repetidas del consultorio Guerra–Mininni unificadas** (27/10): Mariano Mininni (5 → 1) y Juan Carlos Montes (2 → 1). Las fichas de prueba se borran desde Panel → Pacientes (casillas y «Borrar N fichas», solo el administrador).
- [ ] **Consultorios / sillones** (pedido del Dr. Mininni, 28/10; respondió el 29/10): consultorio 1, Mariano de lunes a jueves de 11 a 17; consultorio 2, Emilia de lunes a miércoles de 10 a 18 y los jueves Lara con tres turnos de endodoncia (11, 13 y 15). Nadie comparte sillón a la misma hora, así que **no hace falta el sillón como recurso**: alcanza con cargar esos horarios en Equipo y horarios (Lara con tres horarios de la duración de la endodoncia y la especialidad de esa prestación). Desde el 4/11 se puede marcar qué prestaciones hace cada profesional y horarios solo para algunas prestaciones: Lara puede hacer solo endodoncia, sin cambiarle la especialidad. El **turno con dos profesionales** (cirugía de Mariano con Emilia) ya está: «También atiende» en el turno a mano (30/10). Falta que el consultorio cargue los horarios y que el evento de Google Calendar vaya también al calendario del segundo profesional.
- [ ] **v2: recetas con RCTA** (pedido del Dr. Mininni, 28/10): que el agente pueda mandar recetas (por ejemplo, de radiografías) por la aplicación RCTA. Hoy las recetas son una tarea para el equipo.
- [x] **Sobreturnos importados desde el consultorio (Smile Connect)** (02/11): la base permite guardar sobreturnos reales importados/sincronizados desde Smile Connect y la grilla de Agenda los dibuja en paralelo; Sofi y la reserva normal siguen sin poder superponer turnos (`insertAppointment` con locks por profesional). Si más adelante se quiere un botón explícito para cargar sobreturnos a mano desde el panel de Turnia, queda como ampliación opcional.
- [x] **Aviso cuando Google pide reconectar** (18/11): la primera vez que Google rechaza el permiso (vencido o revocado), además del aviso del panel, le llega a Axel un WhatsApp desde la línea de Turnia con el nombre de la clínica y el enlace a Configuración → Calendario. Uno por caída, no uno por intento. Si se quiere que también le llegue al equipo del consultorio, sumarlo como un tipo de aviso más en «Equipo por WhatsApp» (decisión del usuario: en Guerra–Mininni sería un mensaje nuevo a su equipo).
- [ ] Mejoras posibles: roles por persona dentro de la clínica, admisión digital y cobranzas. Son ampliaciones, no arreglos.
- [x] **Campañas para activar la base** (25/10): oportunidades con valor, controles por prestación y por paciente, reglas de contacto, lista que se revisa, envío desde el WhatsApp de la clínica o con Sofi, e importación de pacientes desde Excel o CSV. Ver [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md).
- [ ] Que el usuario pruebe Campañas con la planilla real de Guerra–Mininni (ya se puede importar completa) y el envío desde su WhatsApp. Antes conviene cargar en Configuración → Prestaciones las que tienen control periódico: las prestaciones de esa planilla son texto libre («control», «instalar corona», «Control de Exodoncia»…) y solo cuentan para inactivos hasta que coincidan con una prestación de la clínica. Siguientes pasos de campañas (secuencias, respuestas marcadas a mano, automáticas por clínica, segmentos por edad) en `PLAN_CAMPANAS.md`.

- [x] **Follow-up, traído de habita. (07/11):** Panel → Follow-up, una next best action por etapa del embudo de `EMBUDO.md` con versiones (activa y a prueba 50/50), quienes esperan en cada etapa, «Ejecutar» y, por versión, ejecuciones, conversiones y tasa. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Panel → Follow-up». Falta probarlo en producción con un envío real.

## 4. Web pública (estado: home terminada)

- [x] Hero con video de fondo (cuatro clips de Mixkit con licencia libre, en `public/videos/`) y mensajes del agente sincronizados con cada persona.
- [x] «Escuchá a Sofi en acción» en una pantalla: recepcionista a la izquierda, paciente a la derecha, texto al ritmo del audio real.
- [ ] Si el usuario trae un video propio: reemplazar `public/videos/hero.mp4`, `hero.webm`, `hero-mobile.mp4` y `hero-poster.jpg`, y ajustar los tiempos de `ESCENAS` en `src/components/site/agente-en-vivo.tsx`. Cómo se armó el actual (ffmpeg, clips de 8 s, fundido de 0,6 s): [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md).
- [ ] Contenido real: casos, precios y (cuando haya) testimonios. Hoy no se inventa nada.
- [x] **Skills de diseño** instaladas en `.claude/skills` y auditoría de accesibilidad hecha (24/10): de 512 problemas a 6 decorativos. Detalle en `ESTADO_Y_PRIORIDADES.md`.
- [x] Crítica de diseño de la home y `/probar-demo` hecha y aplicada (24/10). Queda a criterio: los titulares en dos colores se repiten en casi todas las secciones (es el estilo de Assort; no se tocó).

## 5. Producto y legal (antes de usar pacientes reales)

- [ ] Cargar datos y protocolos reales de la primera clínica (no reemplazar por suposición).
- [x] **Protocolos odontológicos y reglas en el panel** (4/11). Incluye Coberturas, Turnos y urgencias, campos nuevos de Prestaciones y de Equipo, plantilla odontológica, Inicio y cambios en Google. Las reglas de Guerra–Mininni pasaron a su ficha. Ver [`PLAN_PROTOCOLOS.md`](PLAN_PROTOCOLOS.md).
- [ ] **Acceso total por WhatsApp del Dr. Mininni** (después del merge): en el panel, elegir la clínica Guerra–Mininni → Configuración → Consultorio → «Acceso total por WhatsApp» → De quién es: «Dr. Mininni», Celular: el que pasó el usuario el 5/11 → «Dar acceso». Después, Sistema → «Crear / actualizar agente», para que Sofi tenga las herramientas nuevas. El número no va al repositorio (es público).
- [ ] **Repasar el módulo odontológico con Mininni.** Ya está prendido en todos los consultorios odontológicos por decisión del usuario; el texto está en Turnos y urgencias, solo Turnia. Probar los 12 casos de «Probar a Sofi» y anotar lo que haya que ajustar.
- [ ] Opcional: «Actualizar agente» en cada clínica para que Sofi pueda mandar `cobertura` en `consultar_disponibilidad`. Sin eso, todo lo demás ya funciona.
- [ ] Revisar consentimiento, conservación de datos y textos de privacidad. No activar Zero Retention de ElevenLabs a ciegas: es incompatible con el Custom Channel (ver `PLAN_WHATSAPP.md`).
- [ ] Activar campañas (workflow n8n `g0H8xbQvRNv5FxQj`, hoy desactivado) solo después de validar canal, destinatarios y baja.
- [x] **Twilio saliente configurado** (24/10): línea propia verificada, importada en ElevenLabs y `ELEVENLABS_PHONE_NUMBER_ID` guardada en Production; despliegue Ready, salud con `llamada_telefonica: true`. La conexión final usa credenciales de la cuenta existente por elección del usuario; no una subcuenta. Detalle y alcance en `ESTADO_Y_PRIORIDADES.md`.
- [x] **Conversación telefónica real validada por el usuario** (24/10): Sofi habló y escuchó por Twilio, registro de 21 mensajes y cierre por el destinatario. ElevenLabs: 2:11 y 1.464 créditos totales; Twilio: 2:12 y US$1,0584. Cinco intentos autorizados en total; los errores manuales de variables quedaron corregidos y documentados. No reintentar lotes ni llamar de nuevo sin pedido explícito.
- [x] **Identificación de llamada confirmada por el usuario:** en el celular receptor apareció la línea de Turnia.
- [x] **Grabación nativa en Twilio solicitada** (25/10): `call_recording_enabled: true` en llamadas salientes comerciales y clínicas iniciadas por Turnia. Sin grabación global ni cambios de otras líneas; accesos a Recording Logs en el panel.
- [ ] **Ver el primer audio grabado real en Twilio** tras una llamada nueva autorizada y con saldo. Los audios viejos no grabados no se reconstruyen. La prueba de código pasó; no se hizo una llamada paga para comprobar el artefacto.
- [x] **Editor de Sofi comercial**: `/panel/comercial/configuracion`, saludo/system prompt/voz, aplicación comprobada, versiones y restauración. Fichas con bloqueo concreto y enlace para resolverlo. Guardar pausa y no llama. 232 pruebas; detalle en `COMERCIAL_AGUSTIN.md`.
- [x] **Saldo de Twilio**: el usuario confirmó el 27/10 que hay saldo (la suspensión del 24/10 quedó atrás). El panel no detecta el saldo automáticamente.
- [x] **Sofi comercial, voz y pitch**: pedido posterior del usuario de usar la voz real de la recepcionista, con agente separado y mismo ID. Panel explica pruebas al mismo número y alta de uno nuevo. No se llamó nuevamente; piloto pausado. Falta validar por teléfono el pitch nuevo y las herramientas cuando haya saldo y autorización. Ver [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Agente comercial Agustín/Mauricio probado**: el usuario autorizó **US$5/día** y una única llamada propia, ya atendida y con voz confirmada. 65 s reales (configuración de 60 s más cierre), Twilio US$0,7056 y ElevenLabs 452 créditos. El panel conserva cupo US$5 y reserva US$1, pero quedó **pausado por saldo Twilio US$0,21916**, insuficiente para otro minuto al móvil. No recargar ni tocar otros negocios. Falta saldo disponible, destinatarios revisados y prueba real de herramientas de interés/baja/end_call antes de prospectar. Estado e IDs en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Atención humana por chat** (17 y 18/11): «Pausar a Sofi» (1 hora a 3 días) y «Reactivar» en cada conversación, `pausar_chat` y `reactivar_chat` por WhatsApp para el equipo, la pausa automática cuando el equipo contesta desde el celular y, desde el 18/11, el descarte de la respuesta que Sofi estaba escribiendo cuando el equipo tomó el chat (no se manda ni queda en la charla). Sin Chatwoot.
- [ ] **Piloto de prospección telefónica**: destinatarios revisados, reglas de contacto/No Llame, baja persistente y probada, autorización manual, límite efectivo de duración/consumo y resultados. Validar que el agente pueda colgar y no afirme registrar una baja sin haberlo hecho. No reutilizar el destino de la prueba que pidió no recibir más llamadas. No activar llamadas en frío ni campañas automáticamente.

- [x] **Ficha de salud de Guerra–Mininni por chat** (04/11): hecha con la hoja en blanco que pasó el usuario. Detalle en `ESTADO_Y_PRIORIDADES.md`.
  - [x] Agentes actualizados por el usuario después del deploy (04/11): Sistema y Configuración.
  - [ ] Probar por WhatsApp con datos ficticios: paciente nuevo, reservar una consulta, recibir la plantilla en un mensaje aparte, devolverla completa y ver la ficha en Pacientes y en «Imprimir para firmar». Cancelar el turno y borrar la ficha de prueba.
  - [ ] Acordar con Mariano: ¿a los pacientes que ya venían (tienen la ficha de papel) se les ofrece una vez? Hoy no. Y si la actualización anual le sirve.
  - [ ] Más adelante: pasar las respuestas a Smile Connect, si tiene una vía soportada.

## 6. Técnico menor

- [x] **Las cuentas aparecen en `/api/metricas`** (18/11): una clínica cuenta como real si no es de una demo o si tiene un código de «Acceso del consultorio» sin revocar, la misma definición de cuenta que `scripts/embudo.mjs`. Cambian `uso` (clínicas, clínicas activas, turnos, conversaciones) y `sofi` (clínicas contra demos) en el tablero de Chapa Labs.
- [ ] `npm audit` (revisado el 18/11): 0 en producción (`--omit=dev`). En desarrollo marca 17 (11 altas) en la cadena de ESLint y de Vitest/Vite; todas se arreglan solo bajando `eslint-config-next` a 14 o `vitest` a 3, y `npm audit fix` sin `--force` no puede aplicarse. No afecta al servidor publicado. Revisar cuando salga una corrección compatible.
- [x] El reproductor de demos ya no genera el 404 de `/audios/<slug>.json` en la consola (24/10).

## Dónde está cada cosa

| Tema | Archivo |
| --- | --- |
| Registro de lo hecho y pruebas en producción | `ESTADO_Y_PRIORIDADES.md` |
| Vercel, Neon, ElevenLabs, n8n | `TRASPASO_CONFIGURACION.md` |
| WhatsApp (WAHA + Custom Channel) | `PLAN_WHATSAPP.md` |
| Web pública copycat de Assort | `PLAN_WEB_ASSORT.md` |
| Demo «Probá con tu web» | `PLAN_LEAD_MAGNET.md` |
| Campañas, importación de pacientes y CRM | `PLAN_CAMPANAS.md` |
| Google Calendar | `GOOGLE_CALENDAR.md` |
| Google Sheets | `GOOGLE_SHEETS.md` |
| Protocolos odontológicos, base común y reglas del panel | `PLAN_PROTOCOLOS.md` |
| Qué es Turnia, decisiones y arquitectura | `CONTEXTO_PROYECTO.md` |
