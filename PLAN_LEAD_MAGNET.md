# Lead magnet: "Probá la demo con tu web"

> Actualizado el 22/10/2026. **Código hecho y probado con WAHA, ElevenLabs, Claude y la web simulados** (`src/test/demo.integration.test.ts`, más unitarios en `src/lib/demo/*.test.ts`). Falta probarlo en vivo cuando WAHA esté conectado (ver `PLAN_WHATSAPP.md`).

## Recorrido

1. **Landing `/probar-demo`**: un campo para la web y el botón **PROBAR DEMO**. Abre `wa.me/<número del chip de WAHA o DEMO_WHATSAPP_NUMBER>` con el mensaje «¡Hola! Quiero probar la demo de Turnia. Te paso mi web: https://…». Hay accesos en el header ("Probá con tu web") y en el hero de la home.
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
- [ ] **2. Clave de Claude.** **Consola revisada el 22/10:** la cuenta tiene saldo positivo y recarga automática desactivada. No hay una clave exclusiva de Turnia en la lista. No se crearon claves ni se compraron créditos: la creación de una credencial nueva requiere confirmación de seguridad en el momento; el usuario estaba ausente. No reutilizar claves de otros proyectos. Paso pendiente: En https://console.anthropic.com → Settings → API Keys, crear `turnia-demo-web` y pegarla en Vercel → Settings → Environment Variables como `ANTHROPIC_API_KEY` (Sensitive, Production y Preview). Revisar en Billing que la cuenta tenga saldo; si no tiene, avisar al usuario (sin clave o sin saldo la demo funciona con una ficha básica). Después, **Redeploy** del último deploy de Production y esperar "Ready". Verificar: `/api/health` → `demo.claude: true`.
- [ ] **3. Permisos de ElevenLabs.** **Revisado el 22/10:** la clave existente «Turnia Salud · Vercel» tiene Text to Speech habilitado y Speech to Text en No Access. No se guardó ningún cambio: ampliar el permiso requiere confirmación de seguridad en el momento. Paso pendiente: En Developers → API Keys, la clave de `ELEVENLABS_API_KEY` necesita **Text to Speech** (respuestas en audio) y **Speech to Text** (escuchar audios). Si falta alguno y se puede editar, agregarlo. Si hay que crear una clave nueva, preguntarle al usuario.
- [ ] **4. Cuando WAHA esté conectado**. **Revisado el 22/10:** la instancia existente pertenece al entorno de otro flujo; no hay un servicio de Turnia aislado. No se cambió su sesión, sus credenciales ni su webhook. Queda preparar el servicio/sesión exclusivo de Turnia, crear el Custom Channel y vincular el chip con QR (requiere al usuario). Después: (`PLAN_WHATSAPP.md`): `/api/health` → `demo.whatsapp: true` y `whatsapp_source: "waha"`. En `https://turniasalud.vercel.app/probar-demo`, escribir "mi clinica" → pide revisar la dirección; una web válida → abre WhatsApp con «¡Hola! Quiero probar la demo de Turnia. Te paso mi web: …» dirigido al número del chip.
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
