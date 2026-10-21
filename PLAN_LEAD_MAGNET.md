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

## Qué tiene que hacer el usuario

1. Volver a correr `supabase/schema.sql` en Neon (agrega `clinics.is_demo`, `demo_sessions`, `channel_conversations.reply_with_voice` y deja `leads.email` opcional). No hace falta `seed.sql`.
2. Terminar WAHA (chip, sesión, webhook, Custom Channel y variables: `PLAN_WHATSAPP.md`).
3. Vercel: `DEMO_WHATSAPP_NUMBER` (el número del chip) y `ANTHROPIC_API_KEY` (recomendada). Opcional: `ELEVENLABS_PHONE_NUMBER_ID`.
4. La clave de ElevenLabs (o `ELEVENLABS_TTS_API_KEY`) necesita **Text to Speech** para el modo audio y **Speech to Text** para escuchar audios.
5. Probar con un celular: abrir `/probar-demo`, mandar la web de un consultorio real y recorrer los tres modos, MENU y SALIR.

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
