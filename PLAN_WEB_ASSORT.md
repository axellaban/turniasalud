# Plan: web de Turnia como copycat de assorthealth.com

> Traspaso del 21/10/2026. **La web ya está construida** (ver "Estado de la construcción"). Lo que sigue más abajo es el relevamiento y el plan original, que se respetó.
> Leer antes: `AGENTS.md`, `TRASPASO_CONFIGURACION.md` (estado de Neon/Vercel/ElevenLabs/n8n) y `CONTEXTO_PROYECTO.md`.

## Estado de la construcción (21/10/2026)

**Key visual igual al de Assort** (pedido del usuario): paleta en `src/app/globals.css` tomada de su CSS (`brand-600` = cobalto `#2157e1`, navy `#171729`/`#0b0d1a`, `aqua` `#32d5d8`, `emerald` `#4eb49e`, `lila`, `cielo`, `sun` naranja) y tipografía **Geist**, la misma que usa Assort. Se quitó Fraunces. El panel también quedó azul.

Hecho, con `tsc`, `eslint`, build y tests en verde (capturas revisadas a 1440 y 390 px, sin scroll horizontal):

- `src/app/(marketing)/`: layout con `SiteHeader` (header flotante con mega-menús Plataforma / Soluciones / Recursos / Empresa y menú mobile) y `SiteFooter` (CTA + columnas). `/demo`, `/panel` y `/privacidad` quedan fuera del grupo.
- **Home** (`(marketing)/page.tsx`) con las 14 secciones de Assort en su orden: hero con video, grilla de especialidades (en lugar de logos), carrusel de escenarios con métrica, banda "Probalo", diagrama del motor, rueda de capacidades, reproductor con orbe, 3 tarjetas con gradiente, banda 24/7, órbita de integraciones, 4 tarjetas de resultados, carrusel de casos con play y footer.
- **Producto**: `/plataforma`, `/recepcion`, `/activa` (plantilla `components/site/producto.tsx`, textos en `content/productos.ts`).
- **Soluciones**: `/soluciones/[slug]` (9 casos, `content/casos.ts`), `/especialidades/[slug]` (18, `content/especialidades.ts`), `/organizaciones/[slug]` (3, `content/organizaciones.ts`). Todas estáticas.
- `/escucha-a-nuestros-agentes`, `/pedi-una-demo` (formulario → tabla `leads` + evento `lead.nuevo` a n8n, con test) y `/nosotros`.
- **Demos de audio**: 7 guiones originales en `content/conversaciones.json`, reproductor `components/site/reproductor-demo.tsx` (variantes `orbe` y `tarjeta`, transcripción sincronizada) y generador `scripts/generar-audios.mjs`. Ver `public/audios/README.md`.
- **Fotos**: `public/img/*.jpg` son fotos de Unsplash (licencia Unsplash: uso comercial libre, sin atribución obligatoria). No son de Assort.

### Estado operativo del 22/10/2026

Los siete audios ya están generados y publicados, con Sol y Agustín; reproducción y transcripción verificadas. Duración total 18:09,09; Analytics de Text to Speech: 7,05K créditos. El punto 1 del plan histórico de abajo está completado. Para pendientes vigentes, prevalece `ESTADO_Y_PRIORIDADES.md`. Los ejemplos son simulados, sin testimonios ni resultados inventados.

### Pendiente histórico
1. **Generar los audios** desde **Panel → Configuración → Audios de la web** (botón "Generar los 7 que faltan"). Se generan en Vercel con ElevenLabs Text to Dialogue (`eleven_v3`) y las 2 voces favoritas (Sofi = la femenina; o `VOZ_AGENTE` / `VOZ_PACIENTE`), se guardan en la tabla `web_audios` y se sirven en `/api/audios/<slug>.mp3|json` (con Range). Requisitos: haber corrido `schema.sql`; que la clave tenga **Text to Speech** y **Voices: Read** (la actual "Turnia Salud · Vercel" no tiene Text to Speech: editarla en ElevenLabs o crear otra y cargarla en Vercel como `ELEVENLABS_TTS_API_KEY`); créditos para ~17.600 caracteres (la clave tiene tope de 10.000: subirlo o generar en dos tandas). Mientras no haya audio, el reproductor muestra la conversación como lectura animada ("Ver la conversación"), sin cartel de "próximamente". `scripts/generar-audios.mjs` sigue sirviendo para generarlos en una computadora y subirlos a `public/audios/`.
2. **Video del hero** (**hecho**): `public/videos/hero.mp4`, `hero.webm`, `hero-mobile.mp4` (recorte vertical) y `hero-poster.jpg`. Son cuatro clips de Mixkit con **Stock Video Free License** (uso comercial, sin atribución; se verificó en cada página que el aviso fuera «Free» y no «Restricted»), uno por mensaje del agente, de 8 s con fundido de 0,6 s: 49920 (mujer con celular rojo), 100325 (hombre preocupado), 100318 (mujer en living colorido, espejado) y 39803 (hombre con auriculares). Los mensajes cambian a los 0,3 / 7,7 / 15,1 / 22,5 s (`agente-en-vivo.tsx`). Para cambiarlo por un video propio, reemplazar los archivos y ajustar esos tiempos. Los videos de Assort no se copian.
3. Revisar los textos con el usuario. Verificar las líneas de ayuda de salud mental citadas en `content/especialidades.ts` (0800-999-0091 y 135) antes de publicar.
4. ~~Volver a correr `supabase/schema.sql` en Neon~~: hecho, y desde el 22/10/2026 cada deploy de producción lo aplica solo (`scripts/migrate-db.mjs`).
5. Opcional: blog, casos de clientes reales cuando existan, página de precios.

## Pedido del usuario

La web pública (https://turniasalud.vercel.app) tiene que replicar la web y los flujos de https://www.assorthealth.com: secciones, páginas, menús, interacciones y demos de audio. La idea es copiar primero y adaptar después. Se puede usar REA (https://github.com/morluto/rea, un MCP de ingeniería inversa) si hace falta.

Para las demos de audio el usuario pidió **la misma conversación que Assort, pero en español y con nuestras voces**. Marcó **2 voces como favoritas** en ElevenLabs para eso.

### Criterio acordado sobre qué se copia

| Sí se replica | No se copia tal cual |
|---|---|
| Estructura, orden de secciones, menús, páginas, componentes, animaciones e interacciones (reproductor con orbe, rueda de capacidades, diagrama del motor, carruseles) | Videos, fotos, logos e íconos de Assort |
| Los mismos escenarios de cada demo de audio, con guion propio en rioplatense | Textos traducidos literalmente, transcripciones de sus audios |
| | Testimonios, logos de clientes y métricas de Assort (en Turnia serían afirmaciones falsas) |
| | Sellos SOC 2, HIPAA y KLAS (Turnia no los tiene) |

**Motivo:** derechos de autor de sus piezas, y no publicar afirmaciones falsas sobre clientes o resultados. Donde Assort muestra prueba social, Turnia pone contenido honesto: capacidades, lo que se mide en el panel y especialidades. Se mantiene la marca y la paleta verde de Turnia. Avisarle al usuario si alguna sección queda distinta por esto.

---

## Estructura de la home de Assort (relevada con capturas, 1440 px)

1. **Header** blanco flotante con sombra: logo · Platform ▾ · Solutions ▾ · Customers · Resources ▾ · Company ▾ · botón azul "Get a demo". Mega-menús:
   - **Platform:** Overview, Concierge, Activate.
   - **Solutions:** By Use Cases (9), By Specialties (17), By Organization Types (FQHC, Health Systems, Multi-Specialty).
   - **Resources:** Customer Stories, Patient Feedback, Blog, KLAS, Webinars.
   - **Company:** About, Events, Press, Careers, Get a Demo, Contact.
2. **Hero** a todo ancho con video de fondo y overlay oscuro a la izquierda.
   - Píldora "4.3/5 · 344K Patient Ratings".
   - H1 "Every Patient, Precisely Guided", subtítulo y botón blanco "See it in action →".
   - Videos: `hero-1920` y `hero-mobile-540`, en mp4/webm.
3. **Logos de clientes**: grilla de 5×6 en gris + "Trusted by Thousands of Providers Across **23+ Specialties and Fortune 20 Enterprises**" + botón "See all customer stories".
4. **Carrusel de testimonios**, en fondo celeste: cita y persona a la izquierda; a la derecha, la métrica grande en azul ("89% Reduction in hold times") y "Read story". Abajo, tabs con logos.
5. **Banda "Get a Demo with Our Voice AI"** con gradiente verde agua: botón "Try it now 📞" y "Or, call +1 …".
6. **"Navigate the Most Complex Real-World Care Protocols"**: diagrama del motor Synapse.
   - Izquierda, tarjetas de entrada: historial y plantillas, SOPs y árboles de decisión, grabaciones y reglas de derivación.
   - Centro, tarjeta oscura: stats 300M+ / 62K+ / 1.6M+, barra "Intelligence & Insights" y grilla "Edge Case Library" de 4×5 especialidades con íconos.
   - Derecha, tarjetas naranjas: flujos por organización/especialidad y feedback continuo.
7. **"Streamline Every Step of the Care Journey"**: rueda vertical animada de capacidades (Eligibility, Patient Intake, Fax & Referral, Payment Resolution, Task Management, Waitlist, Medication Refills…). El ítem central se resalta y hay un botón "Explore more".
8. **"AI Agents Platform / from First Call to Follow Up"** (segunda línea en azul) + tarjeta grande "Watch Assort in action": gradiente lavanda y un **orbe azul con ondas** en el centro. Al darle play se reproduce una llamada; su home usa el video `Assort_Video_Health_Call_x2.webm`.
9. **Tres tarjetas con gradiente**: verde "Built for Specialty Precision", lila "Personalize Every Patient Conversation", naranja "Orchestrate the Full Patient Journey". Cada una con ilustración 3D.
10. **Banda verde "4.3/5 The Patient Verdict"**: carrusel de reseñas con puntos.
11. **"Integrations into Your Existing EHR & PMS"**: logos alrededor de un círculo central (Epic, athena, Oracle, NextGen, eCW, ModMed, Nextech, Veradigm, Greenway, AdvancedMD).
12. **"Real Results Across Real Practices"**: 4 tarjetas de colores (verde, violeta, celeste, naranja) con métricas.
13. **Carrusel de videos de casos de clientes**: tarjeta central grande con foto, título y botón play circular blanco; tabs con logos abajo.
14. **Footer oscuro**: CTA "Ready to Transform Patient Access with Assort?" + botón verde agua. Columnas: Platform, Use Cases + Organization Types, Specialties, Resources + Company. Sellos SOC2/HIPAA/KLAS, redes y legales.

### Otras plantillas (capturas tomadas; volver a sacarlas con el script de abajo)

- **Producto** (`/concierge`, `/activate`): hero, "el problema" en 3 columnas, "Introducing X" con 3 pilares, 3 métricas, secciones alternadas con 3 bullets y link "Explore …", canales (Phone / Chatbot / Online Scheduling, o Phone / Text / Email), "How it works" en 6 pasos, testimonio y CTA.
- **Caso de uso** (`/patient-scheduling`, etc.): hero + formulario "Get a Demo", 3 bloques de 3 beneficios, "Why Assort" con 3 bullets, testimonios, **FAQ de 5 preguntas** y CTA. Los textos completos de las 9 páginas de casos de uso ya se bajaron una vez (ver "Herramientas usadas").
- **Especialidad** (`/dermatology`, etc.): hero específico, flujos de la especialidad, demo de audio y FAQ.
- **"Listen to Our Voice Agents"**: tarjetas por especialidad con título, descripción, botón "Play Demo" y duración.
  - En `/listen-to-our-voice-agents-in-action`: Pediatrics 04:48, Primary Care 04:00, OB/GYN 02:30.
  - En `/listen-to-our-voice-agents-in-action-cardio-derm-gastro`: Cardiología, Dermatología, Gastroenterología.
  - Sus audios son MP3 en `cdn.prod.website-files.com`: `pediatrics-audio.mp3`, `primaryCare-audio.mp3`, `Obgyn smaller.mp3`, `Dermatology Demo.mp3`, `GI Demo.mp3`, `Cardio Demo.mp3`. **No re-alojarlos.** Escucharlos solo como referencia de escenario.

---

## Plan de implementación (próxima IA)

### 1. Estructura del sitio
- Mover la landing a un route group `src/app/(marketing)/` con `layout.tsx` compartido: header con mega-menús (client component) y footer grande.
- `/demo` y `/panel` quedan fuera, protegidos por `src/proxy.ts`.
- Mapa de rutas en español:

| Ruta | Equivalente en Assort |
|---|---|
| `/` | home |
| `/plataforma` | platform |
| `/recepcion` | concierge |
| `/activa` | activate |
| `/soluciones/[slug]` | 9 casos de uso: `turnos`, `triage`, `admision`, `fuera-de-horario`, `seguimiento-proactivo`, `recetas`, `derivaciones`, `cobranzas`, `tareas` |
| `/especialidades/[slug]` | 17 especialidades |
| `/organizaciones/[slug]` | `caps-centros-de-salud`, `sanatorios-y-redes`, `multiespecialidad` |
| `/escucha-a-nuestros-agentes` | listen-to-our-voice-agents |
| `/pedi-una-demo` | book-a-demo |
| `/nosotros` | about |

- **Pedí una demo:** formulario que guarda leads en una tabla nueva `leads` (agregar a `schema.sql` y a los permisos de `neon-access.sql`) y avisa por `notifyN8n("lead.nuevo")`.
- **Contenido por datos:** `src/content/site.ts` con menús, casos de uso, especialidades y FAQs (textos propios en rioplatense, con los mismos puntos de mensaje que Assort) y `src/content/conversaciones.ts` con los guiones.
- **Componentes** en `src/components/site/`: `SiteHeader`, `SiteFooter`, `HeroVideo`, `CarruselMetricas`, `BandaProbalo`, `MotorProtocolos`, `RuedaCapacidades`, `ReproductorDemo` (orbe), `TarjetasGradiente`, `OrbitaIntegraciones`, `TarjetasResultados`, `CarruselCasos`, `PlantillaCasoDeUso`, `Faq`.

### 2. Contenido honesto en lugar de la prueba social de Assort
| Sección de Assort | Contenido para Turnia |
|---|---|
| Logos de clientes | Grilla de especialidades y tipos de centro |
| Testimonios y métricas | Carrusel de "lo que medís en el panel" (contención, turnos dados por IA, recuperados por campañas, tiempo de respuesta), sin números inventados |
| Stats del motor | Cifras reales del producto: 8 herramientas, 17 especialidades, 24/7, WhatsApp + voz + web |
| Integraciones | Solo lo real: WhatsApp Business, telefonía Twilio/SIP, n8n, Google Calendar (vía n8n), API propia |
| Patient Verdict | Reemplazar por una banda de "24/7 · respuesta en segundos", hasta tener reseñas reales |
| Videos del hero y de casos | `<video>` que apunta a `/videos/hero.mp4` y `/videos/hero-mobile.mp4` con un póster en gradiente de respaldo. El usuario sube sus propios videos a `public/videos/` |

### 3. Reproductor de demos de audio
- **Componente `ReproductorDemo`:**
  - Orbe con barras animadas mientras suena, play/pausa, duración y barra de progreso.
  - Transcripción sincronizada línea por línea, a partir del JSON de segmentos.
  - Si todavía no existe el MP3, mostrar el guion y "Audio próximamente".
- **Guiones** (escritos por nosotros, voseo, contexto argentino con obras sociales, DNI y PAMI). Mismos escenarios que Assort:
  1. **Home:** paciente pide turno y renovación de receta en la misma llamada (es el "How it works" de Concierge).
  2. **Pediatría:** madre o padre saca turno para su hijo, preguntas sobre vacunas y fiebre, con triage.
  3. **Clínica médica:** seguimiento, derivación a especialista y consultas generales.
  4. **Ginecología y obstetricia:** turnos de control prenatal y verificación de cobertura.
  5. **Dermatología:** control de lunares y cobertura por profesional.
  6. **Gastroenterología:** preparación para videocolonoscopía e indicaciones previas.
  7. **Cardiología:** turno con estudios previos (electrocardiograma o ecocardiograma) y síntoma de alarma derivado al 107.
- **Generador** `scripts/generar-audios.mjs`:
  - Lee `src/content/conversaciones.ts` (o un JSON equivalente).
  - Usa `POST https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps` (modelo `eleven_v3`, `language_code: "es"`). El body lleva `inputs: [{text, voice_id}]` con un máximo de unos 2.000 caracteres por request; partir el guion en bloques y encadenarlos con `previous_request_ids`.
  - La respuesta trae `audio_base64` y `voice_segments` (`start_time_seconds`, `end_time_seconds`, `dialogue_input_index`). Concatenar los MP3, sumar el offset de tiempos y escribir `public/audios/<slug>.mp3` y `public/audios/<slug>.json` (líneas con inicio y fin).
  - **Voces:** detectar las 2 favoritas con `GET /v2/voices?page_size=100` buscando las que tengan `favorited_at_unix` distinto de null, o tomarlas de `VOZ_AGENTE` / `VOZ_PACIENTE`. Imprimir nombres e IDs para que el usuario confirme cuál es la de la agente.
  - **Opcional:** filtro de voz telefónica con `audio_effects.filter_preset_id` (los IDs válidos salen de `GET /v1/audio-effects/catalog`).
  - **Corre en la máquina del usuario** con `ELEVENLABS_API_KEY` del `.env.local`. La clave restringida actual tiene permisos de ElevenAgents/Voices/Webhooks: **verificar que también tenga Text to Speech**, o crear otra.

### 4. Estilo
- Mantener la paleta verde de Turnia y Geist como tipografía.
- Para parecerse a Assort, usar sans en los títulos grandes en lugar de Fraunces: titulares de 48 a 56 px con segunda línea de color, mucho aire, tarjetas con radio de 16 a 24 px, gradientes suaves y header flotante.
- Revisar mobile a 390 px sin scroll horizontal, y modo claro y oscuro si aplica.

### Herramientas usadas en esta investigación
- **Descarga de HTML a texto:** bajar con `curl` (el proxy del entorno en la nube permite `assorthealth.com`) y convertir con un parser HTML simple. WebFetch no resolvía DNS en ese entorno.
- **Capturas:** Playwright con `chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } })`, scroll progresivo y `fullPage: true`. El sitio de Assort usa animaciones al hacer scroll.

---

## Otros pendientes conversados en esta sesión

- **Computer use / navegador del usuario:** la sesión en la nube **no** puede controlar la computadora ni el navegador logueado del usuario. Para configurar consolas (Vercel, Neon, ElevenLabs, Meta), seguir desde una sesión local (Claude Desktop o `claude remote-control`), o pedir las credenciales como secrets del entorno, nunca por chat.
- **Neon `jwk not found`** (detalle en `TRASPASO_CONFIGURACION.md`). Hipótesis a probar:
  1. **Clave estática en `apikey`:** `src/lib/supabase.ts` crea el cliente una sola vez y le pasa `neonServerToken()` como clave. supabase-js usa ese valor fijo en el header `apikey`, mientras `Authorization` sí se renueva con `accessToken`. En un proceso que vive más de 5 minutos, `apikey` queda vencido. Probar no mandar `apikey` (fetch propio que lo quite) o crear el cliente por request.
  2. **Caché negativa de JWKS en Neon:** algún nodo de Neon puede haber guardado el JWKS de cuando el endpoint no existía o devolvía 503. Encaja con la alternancia de éxitos y errores. Probar con otro `kid` (`turnia-server-v2`) para forzar que lo vuelva a pedir.
  3. **Plan B:** conexión Postgres directa con `@neondatabase/serverless`. Implica reescribir las consultas de supabase-js a SQL parametrizado; es un cambio grande, hacerlo solo si lo anterior falla.
