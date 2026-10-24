# Lead magnet: "Probá la demo con tu web"

> Actualizado el 22/10/2026. **Código hecho y probado con WAHA, ElevenLabs, Claude y la web simulados** (`src/test/demo.integration.test.ts`, más unitarios en `src/lib/demo/*.test.ts`). Falta probarlo en vivo cuando WAHA esté conectado (ver `PLAN_WHATSAPP.md`).

## Demo en el navegador (24/10/2026)

- **`/probar-demo` pide la web** (o el nombre del consultorio si no tiene; ver abajo). En la computadora la demo sigue **en el navegador**. En el celular, si Telegram o WhatsApp están activos, se elige entre **navegador** y ese chat. Si el chat está pausado, también va al navegador: la demo ya no depende de WAHA.
- **Navegador** (`src/lib/demo/web.ts`, `/api/demo/iniciar` con `via: "navegador"`, `/api/demo/web/<token>`, página `/probar-demo/sesion/<token>`): crea el interesado (`leads.source = 'demo-web'`, con email, aviso `lead.nuevo` a n8n) y una `demo_sessions` con `chat_id = 'web:…'`. La lectura de la web y la clínica temporal son las mismas (`analyzeDemo` con `after()`, `maxDuration` 300 s), sin mandar mensajes. La página muestra el progreso, después lo que leyó (especialidad, dirección, profesionales, turnos) y deja **chatear** (URL firmada de ElevenLabs, solo texto) o **hablar** (token WebRTC) con el agente y las variables de la demo.
- **Límites:** el mismo freno por origen que el paso a Telegram (30 por hora por IP, 1000 en total), el límite diario por persona del panel (por email) y **6 conversaciones por demo**, reservadas de forma atómica y devueltas si falla el proveedor. Dura 24 h desde el último uso. Cambiar el canal de chat en el panel no corta estas demos.
- **Sin email y sin web (24/10):** `/probar-demo` ya no pide email (el pedido de demo queda con la web o el nombre del consultorio; si llega un email válido por la API, se guarda). Si el consultorio no tiene web, se prueba con su nombre y especialidad: `/probar-demo?nombre=Consultorio+Arroyo&dir=Córdoba+3380,+Mar+del+Plata&esp=Odontología`. No se lee ninguna web ni se usa Claude: `manualProfile` arma la ficha con nombre, dirección, horario de ejemplo (lunes a viernes de 9 a 18) y turnos de la especialidad (en odontología: primera vez, limpieza, control y urgencia). Va siempre al navegador. Columnas nuevas `demo_sessions.manual_name`, `manual_address`, `manual_specialty`.
- **Link personalizado (24/10):** `/probar-demo?web=miclinica.com.ar` llega con la web escrita y el foco en el email; una dirección inválida se ignora. Es el link que se manda en la prospección a consultorios.
- **Telegram con email:** el email viaja en `demo_handoffs.email` y queda en el pedido de demo cuando la persona toca Iniciar (`attachLeadEmail`).
- Probado con `src/test/demo-web.integration.test.ts` y **en producción el 24/10** con la web de Guerra–Mininni: lectura con Claude en 15 s (cuatro odontólogos y seis prestaciones), chat con respuesta real de Sofi al pedido de limpieza y voz conectada. La prueba encontró que el primer mensaje no se mandaba (arreglado en el PR #30). Quedó un interesado de prueba `prueba-claude@turnia.test` en Pedidos de demo: se puede borrar.

## Recorrido

1. **Landing `/probar-demo`** (por chat; para el navegador ver arriba): web, email y el botón **Probar la demo**. Abre `wa.me/<número del chip de WAHA o DEMO_WHATSAPP_NUMBER>` con el mensaje «¡Hola! Quiero probar la demo de Turnia. Te paso mi web: https://…». Hay accesos en el header ("Probá con tu web") y en el hero de la home.
2. **WhatsApp (WAHA → `/api/waha/webhook`)**: un mensaje con "demo/probar/prueba" + una web abre una demo (`demo_sessions`), crea el lead (`leads.source = 'demo-whatsapp'`, avisa `lead.nuevo` a n8n) y responde "Estoy leyendo tu web…". Lo demás corre con `after()` (la función tiene `maxDuration` 300 s).
3. **Lectura de la web** (`src/lib/demo/scraper.ts`): home + links del mismo sitio, primero contacto/profesionales/especialidades/coberturas; hasta 20 páginas o 35 s; sin repetir menús y pies. Guarda teléfonos, mails, WhatsApp y datos estructurados (JSON-LD). **No visita direcciones internas**: valida DNS y cada redirección y fija la conexión a las IP públicas validadas. Descarga hasta 2 MB descomprimidos por página (también sin `Content-Length`); DNS, cuerpo y redirecciones comparten el plazo de 8 s por página y el presupuesto global de 35 s.
4. **Ficha de la clínica** (`profile.ts`): con `ANTHROPIC_API_KEY`, Claude (`claude-opus-5-5`, esfuerzo bajo, salida con JSON schema, fallback de servidor) arma nombre, especialidad, dirección, horarios, coberturas, profesionales y prestaciones sin inventar datos. Sin clave o si falla: perfil básico (nombre, teléfono, especialidad probable y el texto de la web como preguntas frecuentes).
5. **Clínica temporal** (`session.ts → createDemoClinic`): `clinics.is_demo = true` con profesionales, tipos de turno y horarios (si la web no los dice: lunes a viernes 9-18, y el agente lo sabe). Cada tipo de turno tiene un profesional de su especialidad, así `consultar_disponibilidad` siempre encuentra horarios. Al preparar una nueva clínica de demo se limpian las que tienen más de 7 días, con sus datos asociados; no hay un cron de borrado diario. Nunca reemplazan a la clínica real (`getClinic` y `whatsappClinic` las excluyen) y no mandan campañas.
6. **Opciones**: «1️⃣ Llamada de voz 2️⃣ Audio de WhatsApp 3️⃣ Chat» (por número o palabra). `MENU` cambia de modo y `SALIR` termina; después de SALIR, los mensajes vuelven a la clínica de siempre.
   - **Chat**: cada mensaje va al agente por el Custom Channel con las variables de la clínica de la demo y un `conversation_context` "DEMO DE TURNIA…" (lo trata como paciente; agenda de prueba; no inventa precios ni coberturas).
   - **Audio**: igual, pero las respuestas salen como **nota de voz** (Text to Speech `opus_48000_64` + `POST /api/sendVoice` de WAHA con `convert: true`). Los audios del interesado se transcriben como ya hacía el canal. Si la voz o WAHA fallan, va el texto.
   - **Llamada**: con `ELEVENLABS_PHONE_NUMBER_ID` (Twilio importado en ElevenLabs), el agente **llama al celular** (`/v1/convai/twilio/outbound-call`). Sin número, o si la llamada falla, manda un link `/probar-demo/llamada/<token>` para hablar desde el navegador (WebRTC, el mismo agente con las variables de la demo; el token vence con la demo).
7. **Límites**: 3 demos por número en las últimas 24 h, con lock transaccional por teléfono para que mensajes simultáneos no superen la cuota. El ID del mensaje original evita crear otra demo si WAHA reintenta. El análisis se reclama una sola vez antes de consultar Claude. Máximo 3 llamadas por demo, compartidas entre navegador y teléfono; los fallos antes de entregar el token o iniciar la llamada devuelven ese intento. `MENU`, `SALIR` o el vencimiento desactivan el link mientras no esté en modo llamada. Una demo queda activa 24 h desde el último mensaje; si la lectura no termina en 4 min se avisa y se puede reenviar la web.
8. **Benchmark del lector con webs reales** (22/10/2026, sin Claude ni gasto de sus API):

   | Web | Páginas | Tiempo | Caracteres para la ficha |
   |---|---:|---:|---:|
   | fleni.org.ar | 20 | 5,67 s | 90.000 |
   | cemic.edu.ar | 20 | 1,85 s | 70.576 |
   | dentalcenter.com.ar | 20 | 9,03 s | 34.623 |
   | sanatorioguemes.com.ar → sitio.sg.com.ar | 8 | 35,01 s | 34.255 |

   Son tiempos de lectura desde esta computadora, no del flujo completo en Vercel. En Güemes se alcanzó el presupuesto y se devolvió lo leído. Sin Claude, las especialidades inferidas de centros grandes son aproximadas; esto no valida la precisión de la ficha ni reemplaza la prueba con modelo.

## Revisión y endurecimiento del 22/10/2026

- Lectura acotada por bytes y tiempo, DNS fijo por conexión, bloqueo de direcciones reservadas y variantes IPv6 mapeadas; teléfonos y URLs con escapes incompletos no abortan todo el sitio.
- Reintentos y concurrencia: una sesión por mensaje, un interesado por teléfono y un solo análisis. Si llega `SALIR` mientras Claude responde, no se crea una clínica huérfana ni se revive la demo.
- Cuota de llamadas atómica, enlaces inactivos fuera de modo llamada y devolución del intento cuando falla el proveedor. Si una llamada telefónica ya salió, un fallo del aviso de WhatsApp no vuelve a dispararla.
- La captura temporal usada para pedir permiso de micrófono se cierra antes de iniciar el SDK, también si luego falla el pedido del token.
- Textos públicos ajustados: secciones principales de la web, tiempo aproximado y ejemplos simulados. El menú de WhatsApp pide datos ficticios y aclara que la agenda es de prueba.
- Verificación local: **137 tests correctos**, con Postgres 17 descartable y proveedores simulados; TypeScript, lint y build correctos. La CI repite la integración en Postgres 16.
- No se consumieron créditos de Anthropic ni de ElevenLabs en estas pruebas; la lectura de webs públicas fue real.
- **Publicado:** [PR #9](https://github.com/axellaban/turniasalud/pull/9), merge `e8f171c`; [CI aprobada con 137 tests](https://github.com/axellaban/turniasalud/actions/runs/39718368347); [deploy de producción confirmado por Vercel](https://vercel.com/labans-projects-c5c64fdc/turniasalud/3WMXBJUTw8ro8hQhFfkXtxxprweE). Comprobados por HTTP: textos nuevos en las dos landing, `database: "ok"`, siete audios intactos y controles de login/token. `demo.whatsapp` y `demo.claude` siguen en `false`, según los bloqueos siguientes.
- La Mac se bloqueó durante el cierre; para retomar las consolas el usuario debe desbloquearla. No se intentó eludir ese bloqueo.

## Puesta en marcha (lo que queda para la próxima IA)

> El usuario prefirió no hacerlo él: **lo hace la próxima IA**, con computer use o la extensión del navegador, cuando él lo pida. Reglas: no mostrar ni copiar claves en el chat (se copian de un sitio y se pegan directo en el otro), tocar solo el proyecto Turnia, no contratar planes ni cargar saldo, y frenar y preguntar ante cualquier diferencia. Al terminar, marcar cada paso acá y actualizar `ESTADO_Y_PRIORIDADES.md`.

**Ya resuelto desde el código (22/10/2026), no hace falta hacerlo a mano:**
- [x] Código unido a `main` con el PR https://github.com/axellaban/turniasalud/pull/6 (se publica solo en Vercel).
- [x] **Base:** cada deploy de producción aplica `schema.sql` solo (`scripts/migrate-db.mjs`). No hay que entrar a Neon.
- [x] **Número de WhatsApp de la landing:** sale solo del chip conectado a WAHA (`GET /api/sessions/{session}` → `me.id`). `DEMO_WHATSAPP_NUMBER` queda opcional, solo para forzar otro número.
- [x] **Estado visible:** Panel → Configuración → "Demo con tu web" y `https://turniasalud.vercel.app/api/health` → `demo: { base, whatsapp, whatsapp_source, claude, llamada_telefonica }`.
- [x] Avisos: un interesado es un solo pedido en Panel → Pedidos de demo, con lo que probó (web, estado, conversaciones). Las clínicas de demo no mandan eventos a n8n (turnos, tareas, conversaciones); solo llega `lead.nuevo` la primera vez.

**Lo que queda (no se puede hacer sin entrar a las consolas):**

- [x] **1. Comprobar el deploy.** Verificado el 22/10/2026 desde fuera (sin consola): después del merge del PR #6, `https://turniasalud.vercel.app/api/health` respondió `database: "ok"` y `demo.base: true` (la base se actualizó sola en el build de producción), `/probar-demo` responde 200 con "se habilita en breve" (falta WAHA), la home muestra "Probalo con tu web" y `POST /api/demo/llamada` con un token inválido devuelve 404. Si en un deploy futuro `/api/health` no responde o el build falla, mirar el log en Vercel: `[db] No se pudo actualizar la base…`.
- [x] **2. Clave de Claude cargada.** El usuario completó la carga en Vercel el 22/10. `/api/health` devuelve `demo.claude: true`. Todavía falta una extracción real con Claude para confirmar la credencial, el acceso al modelo y el consumo efectivo.
- [x] **3. Permisos de ElevenLabs.** Speech to Text → Access habilitado y guardado en la clave existente, con confirmación explícita del usuario. Mensaje «API key updated successfully» y persistencia comprobada al reabrir. Text to Speech sigue habilitado; límite de 25.000 créditos conservado.
- [x] **4a. Preparar WAHA y Custom Channel.** Con las dos confirmaciones explícitas del usuario, se creó únicamente `n8n/turnia-waha`: 512 MB, 0,5 CPU, claves y almacenamiento propios, URL `https://n8n-turnia-waha.b6mgbu.easypanel.host`, sesión `default`, motor NOWEB. El otro servicio quedó intacto. Se creó «Turnia · WhatsApp WAHA» y el trigger User message de ElevenLabs, respuesta a `/api/elevenlabs/canal`. Se guardaron las seis variables obligatorias y `WAHA_SESSION` como secretos de Production y se comprobó el redeploy Ready. Proveedor WAHA guardado en el panel. El webhook global tiene evento `message`, HMAC y reintentos; receptor comprobado con evento inocuo firmado (200 ignorado) y sin firma (401). `/api/health`: `database: "ok"`, `configured.waha: true`, `demo.claude: true`.
- [ ] **4b. Vincular el teléfono y habilitar la landing.** La API de la sesión llegó a `SCAN_QR_CODE` después de reiniciarla, sin teléfono vinculado; el usuario todavía no colocó el chip. Activar WhatsApp en el celular, entrar al dashboard del **nuevo** servicio con los campos privados de **n8n → turnia-waha → Environment** y vincular `default` mediante QR (reiniciar esa sesión si venció). Ver `PLAN_WHATSAPP.md`. Confirmar `WORKING`; luego `/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`. No forzar un número ficticio en `DEMO_WHATSAPP_NUMBER`. En `https://turniasalud.vercel.app/probar-demo`, una web válida debe abrir WhatsApp con el mensaje de demo dirigido al número del chip.
- [ ] **5. Prueba real** (con el WhatsApp del usuario, no el del chip): mandar la demo con la web de un consultorio real y esperar las opciones 1/2/3 (puede tardar un par de minutos; medir el tiempo real). Con datos ficticios ("Prueba Turnia", DNI 11111111, particular): **3** chat hasta reservar un turno; `MENU` → **2** audio (¿llega nota de voz o texto?); `MENU` → **1** llamada (¿llama o manda link?; si es link, probar la llamada en el navegador); `SALIR` → mensaje final. En `/panel/demos` tiene que aparecer el interesado una sola vez, con origen `demo-whatsapp`, y "Lo que probó en la demo" con las conversaciones. Anotar los resultados en la sección siguiente.
- [ ] Opcional, solo si el usuario lo pide: `ELEVENLABS_PHONE_NUMBER_ID` (número de Twilio importado en ElevenLabs) para que la opción "Llamada" llame al celular.

## A verificar en vivo

- Que WAHA (Core o Plus, y su motor) acepte `sendVoice` con `convert: true`. Si no, el modo audio contesta con texto (queda en el log "no se pudo mandar la nota de voz").
- Tiempo real de lectura + Claude en webs grandes: falta medirlo con una clave de Turnia. El lector tiene un presupuesto de 35 s y el cliente Claude, 90 s con un reintento. Webs hechas solo con JavaScript pueden traer poco texto: la demo igual arranca con el perfil básico.
- Llamada por Twilio a celulares argentinos (`+549…`): costo por minuto y que Twilio tenga habilitado el destino.
- El aviso `lead.nuevo` de n8n: estos interesados no tienen email (el payload trae `email: null`, `telefono`, `organizacion`, `mensaje`, `origen: "demo-whatsapp"` y `web`, con la misma forma que el formulario). El aviso publicado incluye un enlace al panel, sin texto libre ni datos clínicos. Gmail está vencido y el usuario pidió dejarlo pendiente; no reconectar ni reintentar hasta que lo retome.

## Costos aproximados por demo

- Claude: con 20.000 tokens de entrada y 2.000 de salida, Opus 5.5 ≈ US$0,12 a tarifa estándar de US$4/US$20 por millón ([documentación oficial, consultada 22/10/2026](https://platform.claude.com/docs/en/models/opus-5-5/overview)). Es un ejemplo calculado, **no consumo medido**; tokens de razonamiento, reintentos y fallback pueden aumentarlo.
- ElevenLabs: minutos del agente en la conversación, más TTS de cada respuesta en modo audio.
- Twilio: minutos de llamada saliente (solo si se configura el número).
