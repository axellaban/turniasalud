# Lead magnet: "Probá la demo con tu web"

> 21/10/2026. **Código hecho y probado con WAHA, ElevenLabs, Claude y la web simulados** (`src/test/demo.integration.test.ts`, más unitarios en `src/lib/demo/*.test.ts`). Falta probarlo en vivo cuando WAHA esté conectado (ver `PLAN_WHATSAPP.md`).

## Recorrido

1. **Landing `/probar-demo`**: un campo para la web y el botón **PROBAR DEMO**. Abre `wa.me/<DEMO_WHATSAPP_NUMBER>` con el mensaje «¡Hola! Quiero probar la demo de Turnia. Te paso mi web: https://…». Hay accesos en el header ("Probá con tu web") y en el hero de la home.
2. **WhatsApp (WAHA → `/api/waha/webhook`)**: un mensaje con "demo/probar/prueba" + una web abre una demo (`demo_sessions`), crea el lead (`leads.source = 'demo-whatsapp'`, avisa `lead.nuevo` a n8n) y responde "Estoy leyendo tu web…". Lo demás corre con `after()` (la función tiene `maxDuration` 300 s).
3. **Lectura de la web** (`src/lib/demo/scraper.ts`): home + links del mismo sitio, primero contacto/profesionales/especialidades/coberturas; hasta 20 páginas o 35 s; sin repetir menús y pies. Guarda teléfonos, mails, WhatsApp y datos estructurados (JSON-LD). **No visita direcciones internas** (valida DNS y cada redirección).
4. **Ficha de la clínica** (`profile.ts`): con `ANTHROPIC_API_KEY`, Claude (`claude-opus-5-5`, esfuerzo bajo, salida con JSON schema, fallback de servidor) arma nombre, especialidad, dirección, horarios, coberturas, profesionales y prestaciones sin inventar datos. Sin clave o si falla: perfil básico (nombre, teléfono, especialidad probable y el texto de la web como preguntas frecuentes).
5. **Clínica temporal** (`session.ts → createDemoClinic`): `clinics.is_demo = true` con profesionales, tipos de turno y horarios (si la web no los dice: lunes a viernes 9-18, y el agente lo sabe). Cada tipo de turno tiene un profesional de su especialidad, así `consultar_disponibilidad` siempre encuentra horarios. Se borran a los 7 días con todo lo que tengan. Nunca reemplazan a la clínica real (`getClinic` y `whatsappClinic` las excluyen) y no mandan campañas.
6. **Opciones**: «1️⃣ Llamada de voz 2️⃣ Audio de WhatsApp 3️⃣ Chat» (por número o palabra). `MENU` cambia de modo y `SALIR` termina; después de SALIR, los mensajes vuelven a la clínica de siempre.
   - **Chat**: cada mensaje va al agente por el Custom Channel con las variables de la clínica de la demo y un `conversation_context` "DEMO DE TURNIA…" (lo trata como paciente; agenda de prueba; no inventa precios ni coberturas).
   - **Audio**: igual, pero las respuestas salen como **nota de voz** (Text to Speech `opus_48000_64` + `POST /api/sendVoice` de WAHA con `convert: true`). Los audios del interesado se transcriben como ya hacía el canal. Si la voz o WAHA fallan, va el texto.
   - **Llamada**: con `ELEVENLABS_PHONE_NUMBER_ID` (Twilio importado en ElevenLabs), el agente **llama al celular** (`/v1/convai/twilio/outbound-call`). Sin número, o si la llamada falla, manda un link `/probar-demo/llamada/<token>` para hablar desde el navegador (WebRTC, el mismo agente con las variables de la demo; el token vence con la demo).
7. **Límites**: 3 demos por número por día; una demo queda activa 24 h desde el último mensaje; si la lectura no termina en 4 min se avisa y se puede reenviar la web.

## Puesta en marcha (pendiente; para la próxima IA)

> El usuario prefirió no hacerlo ahora: **lo hace la próxima IA**, con computer use o la extensión del navegador, cuando él lo pida. Reglas: no mostrar ni copiar claves en el chat (se copian de un sitio y se pegan directo en el otro), tocar solo el proyecto Turnia, no contratar planes ni cargar saldo, y frenar y preguntar ante cualquier diferencia. Al terminar, marcar cada paso acá como hecho y actualizar `ESTADO_Y_PRIORIDADES.md`.

**Antes de empezar:** WAHA tiene que estar conectado con el chip (`PLAN_WHATSAPP.md`). Sin WAHA se pueden hacer los pasos 1 a 5 sin `DEMO_WHATSAPP_NUMBER`; el 6 queda para después.

- [ ] **1. Publicar el código.** Está en la rama `claude/zealous-hamilton-qw7l41` (commit "Lead magnet: probar la demo…") y Vercel publica desde `main`. Abrir el PR desde https://github.com/axellaban/turniasalud/compare/main...claude/zealous-hamilton-qw7l41, esperar el check **CI** en verde y unirlo. Si el CI falla, no unir: revisar el log.
- [ ] **2. Base (Neon).** En el proyecto de Turnia (rama `br-cold-wildflower-b6ubnhi1`, base `neondb`, rol `neondb_owner`), SQL Editor: correr el `supabase/schema.sql` completo de `main` (es idempotente) o solo el bloque final "Lead magnet" (`clinics.is_demo`, `demo_source_url`, `channel_conversations.reply_with_voice`, `leads.email` opcional y la tabla `demo_sessions`). Si falla porque no existe `channel_conversations`, antes hay que correr el schema completo. Verificar: `select (select count(*) from demo_sessions) as demos, exists (select 1 from information_schema.columns where table_name = 'clinics' and column_name = 'is_demo') as columna_ok;` → `0, true`. **No** correr `seed.sql`.
- [ ] **3. Clave de Claude.** En https://console.anthropic.com → Settings → API Keys, crear `turnia-demo-web` y pegarla en Vercel como `ANTHROPIC_API_KEY` (Sensitive, Production y Preview). Revisar que la cuenta tenga saldo; si no tiene, avisar al usuario (sin clave o sin saldo la demo funciona con un perfil básico de la clínica).
- [ ] **4. Vercel → proyecto `turniasalud` → Settings → Environment Variables.**
  - `DEMO_WHATSAPP_NUMBER`: el número del chip de WAHA con código de país, sin `+` ni espacios (ej. `5491122223333`). **Preguntárselo al usuario.** Sin esta variable la landing muestra "se habilita en breve".
  - Opcional, solo si el usuario lo pide: `ELEVENLABS_PHONE_NUMBER_ID` (número de Twilio importado en ElevenLabs) para que la opción "Llamada" llame al celular. Sin esto manda un link para hablar desde el navegador.
  - Después: **Redeploy** del último deploy de Production y esperar "Ready".
- [ ] **5. Permisos de ElevenLabs.** En Developers → API Keys, la clave de `ELEVENLABS_API_KEY` necesita **Text to Speech** (respuestas en audio) y **Speech to Text** (escuchar audios). Si falta alguno y se puede editar, agregarlo. Si hay que crear una clave nueva, preguntarle al usuario.
- [ ] **6. Verificación y prueba real.**
  - `https://turniasalud.vercel.app/api/health` → `database: "ok"`.
  - `https://turniasalud.vercel.app/probar-demo`: escribir "mi clinica" → tiene que pedir revisar la dirección; escribir una web válida → abre WhatsApp con «¡Hola! Quiero probar la demo de Turnia. Te paso mi web: …» dirigido al número del chip.
  - Con el WhatsApp del usuario (no el del chip) mandar la demo con la web de un consultorio real. Esperar las opciones 1/2/3 (hasta ~1 minuto).
  - Probar los tres modos con datos ficticios ("Prueba Turnia", DNI 11111111, particular): **3** chat hasta reservar un turno; `MENU` → **2** audio (¿llega nota de voz o texto?); `MENU` → **1** llamada (¿llama o manda link?; si es link, probar la llamada en el navegador); `SALIR` → mensaje final.
  - En `/panel/demos` tiene que aparecer el interesado con origen `demo-whatsapp`, su teléfono y su web.
  - Anotar acá lo que haya que verificar en vivo (sección siguiente).

## A verificar en vivo

- Que WAHA (Core o Plus, y su motor) acepte `sendVoice` con `convert: true`. Si no, el modo audio contesta con texto (queda en el log "no se pudo mandar la nota de voz").
- Tiempo real de lectura + Claude en webs grandes (objetivo: menos de 1 minuto). Webs hechas solo con JavaScript pueden traer poco texto: la demo igual arranca con el perfil básico.
- Llamada por Twilio a celulares argentinos (`+549…`): costo por minuto y que Twilio tenga habilitado el destino.
- El aviso `lead.nuevo` de n8n: estos interesados no tienen email; revisar que el correo del workflow muestre el teléfono y la web.
- Los eventos de turnos de la demo (`turno.reservado`, etc.) también llegan a n8n con el `clinic_id` de la demo: hoy esas ramas no envían nada.

## Costos aproximados por demo

- Claude: ~20.000 tokens de entrada y ~2.000 de salida con Opus 5.5 ≈ US$0,12.
- ElevenLabs: minutos del agente en la conversación, más TTS de cada respuesta en modo audio.
- Twilio: minutos de llamada saliente (solo si se configura el número).
