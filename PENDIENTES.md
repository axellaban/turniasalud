# Turnia Salud — qué falta (traspaso para la próxima IA)

Actualizado: 24/10/2026 (Argentina). Este archivo junta, en un solo lugar y por prioridad, todo lo que queda. El detalle de cada tema está en los documentos enlazados. No contiene credenciales.

## Antes de empezar

1. Leé [`AGENTS.md`](AGENTS.md): esta versión de Next.js (16.4) cambia APIs. Consultá `node_modules/next/dist/docs/` antes de escribir código.
2. Leé [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md), que tiene el registro de lo hecho y prevalece sobre los documentos más viejos.
3. Ramas: se trabaja en una rama, se abre un PR contra `main`, CI (`verificar`) y Vercel tienen que dar verde, y se hace merge squash. Producción se publica sola desde `main` y cada deploy aplica `supabase/schema.sql` (idempotente) con `scripts/migrate-db.mjs`.
4. Diseño: hay skills en `.claude/skills` (`frontend-design`, `web-design-guidelines`, `react-best-practices`, `impeccable`); ver su `README.md`. Para auditar accesibilidad, axe-core está en `node_modules`.
5. Pruebas locales: `npx tsc --noEmit`, `npx eslint src`, `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run` (177 tests al 23/10) y `npx next build`. Para mirar la web, `next start` con un Postgres local; Chromium está en `/opt/pw-browsers`.

## Reglas que no se rompen

- **No contratar planes ni cargar saldo** (Vercel está en Hobby, así que Skew Protection no se activa).
- **WAHA queda exactamente como está**. El otro servicio WAHA del VPS es de otro flujo: no tocarlo.
- **HolaVeggie y las líneas existentes de Twilio están operativas:** no modificar sus números, agentes, webhooks ni credenciales. Turnia usa la misma cuenta por decisión expresa del usuario; el saldo es compartido.
- No pegar credenciales en chat, repo ni documentos.
- No regenerar los audios de la web ni cambiar permisos de ElevenLabs sin que el usuario lo pida.
- Gmail de n8n está vencido y el usuario pidió **no** reconectarlo ni reintentar envíos hasta que lo retome.
- No usar material de Assort Health (videos, fotos, textos literales). La web es un copycat de estructura, no de contenido.
- No inventar clientes, testimonios ni métricas.

## 1. Pendiente del usuario (no se puede hacer desde el código)

- [ ] **Rotar las credenciales** que quedaron expuestas durante el diagnóstico de WAHA (ver la sección «Diagnóstico histórico de vinculación WAHA» en `ESTADO_Y_PRIORIDADES.md`).
- [x] **WAHA vinculado por el usuario**, quien confirmó que funciona. No repetir el diagnóstico ni modificar su conexión. WhatsApp está pausado en el selector de Turnia; Telegram sigue activo.
- [ ] Decidir si los avisos al equipo salen por email (requiere reconectar Gmail en n8n) y a quién van los avisos asistenciales.
- [ ] Opcional: un video propio para el hero, si no quiere los clips de stock (ver 4).

## 2. Prueba en vivo

- [x] Demo en el navegador probada en producción (24/10): lectura, chat y voz.
- [ ] Que el usuario la pruebe con su propia voz y mire el interesado en Panel → Pedidos de demo (el de prueba es `prueba-claude@turnia.test`, se puede borrar). En el celular, probar la opción Telegram.

Cuando el usuario elija reactivar WhatsApp desde Panel → Sistema (sin cambiar WAHA):


- [ ] `https://turniasalud.vercel.app/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`.
- [ ] **Demo con tu web** (`/probar-demo`), con el WhatsApp del usuario y datos ficticios («Prueba Turnia», DNI 11111111, particular): opciones 1/2/3, chat hasta reservar, `MENU` → audio (¿llega nota de voz?), `MENU` → llamada, `SALIR`. Medir cuánto tarda la lectura de la web con Claude. Checklist completa en `PLAN_LEAD_MAGNET.md` (paso 5 y «A verificar en vivo»).
- [ ] WhatsApp de la clínica: texto, audio entrante (Speech to Text nunca se probó en uso real), turno, cancelación, memoria, receta y derivación a recepción.
- [ ] Una conversación hablada completa con una persona (la llamada web solo se probó hasta el saludo).
- [ ] Anotar los resultados en `ESTADO_Y_PRIORIDADES.md` y `PLAN_LEAD_MAGNET.md`.

## 3. Panel (estado: completo y auditado)

Está en producción y probado con un recorrido de 31 comprobaciones: roles administrador/consultorio, códigos por clínica, guardado con avisos, borradores locales, historial de cambios y redirecciones de direcciones mal escritas. Lo que falta:

- [ ] El consultorio Guerra–Mininni (demo conservada) tiene que entrar con su código y cargar sus reglas reales. El código lo crea el administrador en Panel → Configuración → «Acceso del consultorio» y se manda por WhatsApp desde ahí.
- [ ] Mejoras posibles: agendas externas (Google Calendar), roles por persona dentro de la clínica, admisión digital y cobranzas. Son ampliaciones, no arreglos.

## 4. Web pública (estado: home terminada)

- [x] Hero con video de fondo (cuatro clips de Mixkit con licencia libre, en `public/videos/`) y mensajes del agente sincronizados con cada persona.
- [x] «Escuchá a Sofi en acción» en una pantalla: recepcionista a la izquierda, paciente a la derecha, texto al ritmo del audio real.
- [ ] Si el usuario trae un video propio: reemplazar `public/videos/hero.mp4`, `hero.webm`, `hero-mobile.mp4` y `hero-poster.jpg`, y ajustar los tiempos de `ESCENAS` en `src/components/site/agente-en-vivo.tsx`. Cómo se armó el actual (ffmpeg, clips de 8 s, fundido de 0,6 s): [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md).
- [ ] Contenido real: casos, precios y (cuando haya) testimonios. Hoy no se inventa nada.
- [x] **Skills de diseño** instaladas en `.claude/skills` y auditoría de accesibilidad hecha (24/10): de 512 problemas a 6 decorativos. Detalle en `ESTADO_Y_PRIORIDADES.md`.
- [x] Crítica de diseño de la home y `/probar-demo` hecha y aplicada (24/10). Queda a criterio: los titulares en dos colores se repiten en casi todas las secciones (es el estilo de Assort; no se tocó).

## 5. Producto y legal (antes de usar pacientes reales)

- [ ] Cargar datos y protocolos reales de la primera clínica (no reemplazar por suposición).
- [ ] Revisar consentimiento, conservación de datos y textos de privacidad. No activar Zero Retention de ElevenLabs a ciegas: es incompatible con el Custom Channel (ver `PLAN_WHATSAPP.md`).
- [ ] Activar campañas (workflow n8n `g0H8xbQvRNv5FxQj`, hoy desactivado) solo después de validar canal, destinatarios y baja.
- [x] **Twilio saliente configurado** (24/10): línea propia verificada, importada en ElevenLabs y `ELEVENLABS_PHONE_NUMBER_ID` guardada en Production; despliegue Ready, salud con `llamada_telefonica: true`. La conexión final usa credenciales de la cuenta existente por elección del usuario; no una subcuenta. Detalle y alcance en `ESTADO_Y_PRIORIDADES.md`.
- [x] **Conversación telefónica real validada por el usuario** (24/10): Sofi habló y escuchó por Twilio, registro de 21 mensajes y cierre por el destinatario. ElevenLabs: 2:11 y 1.464 créditos totales; Twilio: 2:12 y US$1,0584. Cinco intentos autorizados en total; los errores manuales de variables quedaron corregidos y documentados. No reintentar lotes ni llamar de nuevo sin pedido explícito. Telegram sigue usando enlace web.
- [x] **Identificación de llamada confirmada por el usuario:** en el celular receptor apareció la línea de Turnia.
- [ ] **Agente comercial de Turnia**, separado de la recepcionista, con voz masculina Agustín; definir oferta y herramientas comerciales antes de prospectar. Todavía no creado.
- [ ] **Atención humana por chat**: implementar Tomar / Devolver al agente con pausa persistida y descarte de respuestas pendientes; conservar la app WhatsApp Business y WAHA, sin incorporar Chatwoot por rutina.
- [ ] **Piloto de prospección telefónica**: destinatarios revisados, reglas de contacto/No Llame, baja persistente y probada, autorización manual, límite efectivo de duración/consumo y resultados. Validar que el agente pueda colgar y no afirme registrar una baja sin haberlo hecho. No reutilizar el destino de la prueba que pidió no recibir más llamadas. No activar llamadas en frío ni campañas automáticamente.

## 6. Técnico menor

- [ ] `npm audit` marca cinco altas en la cadena de desarrollo de ESLint (`braces`). No afecta al servidor publicado; no aplicar `--force`, que baja `eslint-config-next`. Revisar cuando salga una corrección compatible.
- [x] El reproductor de demos ya no genera el 404 de `/audios/<slug>.json` en la consola (24/10).

## Dónde está cada cosa

| Tema | Archivo |
| --- | --- |
| Registro de lo hecho y pruebas en producción | `ESTADO_Y_PRIORIDADES.md` |
| Vercel, Neon, ElevenLabs, n8n | `TRASPASO_CONFIGURACION.md` |
| WhatsApp (WAHA + Custom Channel) | `PLAN_WHATSAPP.md` |
| Web pública copycat de Assort | `PLAN_WEB_ASSORT.md` |
| Demo «Probá con tu web» | `PLAN_LEAD_MAGNET.md` |
| Qué es Turnia, decisiones y arquitectura | `CONTEXTO_PROYECTO.md` |
