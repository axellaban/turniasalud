# Turnia Salud — qué falta (traspaso para la próxima IA)

Actualizado: 27/10/2026 (Argentina). Este archivo junta, en un solo lugar y por prioridad, todo lo que queda. El detalle de cada tema está en los documentos enlazados. No contiene credenciales.

## Antes de empezar

1. Leé [`AGENTS.md`](AGENTS.md): esta versión de Next.js (16.4) cambia APIs. Consultá `node_modules/next/dist/docs/` antes de escribir código.
2. Leé [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md), que tiene el registro de lo hecho y prevalece sobre los documentos más viejos.
3. Ramas: se trabaja en una rama, se abre un PR contra `main`, CI (`verificar`) y Vercel tienen que dar verde, y se hace merge squash. Producción se publica sola desde `main` y cada deploy aplica `supabase/schema.sql` (idempotente) con `scripts/migrate-db.mjs`.
4. Diseño: hay skills en `.claude/skills` (`frontend-design`, `web-design-guidelines`, `react-best-practices`, `impeccable`); ver su `README.md`. Para auditar accesibilidad, axe-core está en `node_modules`.
5. Pruebas locales: `npx tsc --noEmit`, `npx eslint src`, `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run` (177 tests al 23/10) y `npx next build`. Para mirar la web, `next start` con un Postgres local; Chromium está en `/opt/pw-browsers`.
6. Google Calendar y Google Sheets: cómo están armados y qué falta configurar en `GOOGLE_CALENDAR.md` y `GOOGLE_SHEETS.md` (usan la misma conexión con Google).

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

- [ ] **Google Sheets (prospección y pedidos de demo):** en el proyecto de Google Cloud de Calendar, habilitar **Google Sheets API** y agregar el permiso `drive.file`. Después, Panel → Prospección → Google Sheets → «Conectar con Google». Para que el permiso no venza a los 7 días, publicar la app. Pasos en [`GOOGLE_SHEETS.md`](GOOGLE_SHEETS.md). Con esto ya no hace falta lo de Apps Script. A la planilla «Interesados TurnIA» conviene sacarle la edición pública o borrarla, porque está vacía.

- [ ] **Consultorios con web:** importar `consultorios-con-web-mdp-miramar.csv` (entregado por chat) en Panel → Prospección → Importar lista, con «Reemplazar los datos de los que ya están por los del archivo» marcado. Suma 13 personas y les carga la web y el WhatsApp del consultorio a 12 que ya estaban.
- [ ] **Prospección de la semana (26 al 30/10):** importar `lista-odontologos-mdp-miramar.csv` en Panel → Prospección → Importar lista (el archivo se entregó por chat; no va al repo), poner el perfil de Turnia en su WhatsApp Business y seguir «Para hoy». Plan en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).

- [ ] **Rotar las credenciales** que quedaron expuestas durante el diagnóstico de WAHA (ver la sección «Diagnóstico histórico de vinculación WAHA» en `ESTADO_Y_PRIORIDADES.md`).
- [x] **WAHA vinculado por el usuario**, quien confirmó que funciona. No repetir el diagnóstico ni modificar su conexión. WhatsApp está pausado en el selector de Turnia; Telegram sigue activo.
- [ ] Decidir si los avisos al equipo salen por email (requiere reconectar Gmail en n8n) y a quién van los avisos asistenciales.
- [ ] Opcional: un video propio para el hero, si no quiere los clips de stock (ver 4).

## 2. Prueba en vivo

- [x] Demo en el navegador probada en producción (24/10): lectura, chat y voz.
- [x] La demo en el navegador entra en una pantalla, en la computadora y en el celular (24/10; detalle en `ESTADO_Y_PRIORIDADES.md`).
- [ ] Que el usuario la pruebe con su propia voz y mire el interesado en Panel → Pedidos de demo (el de prueba es `prueba-claude@turnia.test`, se puede borrar). La demo arranca en voz; Telegram ya no se ofrece en `/probar-demo`.

Cuando el usuario elija reactivar WhatsApp desde Panel → Sistema (sin cambiar WAHA):


- [ ] `https://turniasalud.vercel.app/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`.
- [ ] **Demo con tu web** (`/probar-demo`), con el WhatsApp del usuario y datos ficticios («Prueba Turnia», DNI 11111111, particular): opciones 1/2/3, chat hasta reservar, `MENU` → audio (¿llega nota de voz?), `MENU` → llamada, `SALIR`. Medir cuánto tarda la lectura de la web con Claude. Checklist completa en `PLAN_LEAD_MAGNET.md` (paso 5 y «A verificar en vivo»).
- [ ] WhatsApp de la clínica: texto, audio entrante (Speech to Text nunca se probó en uso real), turno, cancelación, memoria, receta y derivación a recepción.
- [ ] Una conversación hablada completa con una persona (la llamada web solo se probó hasta el saludo).
- [ ] Anotar los resultados en `ESTADO_Y_PRIORIDADES.md` y `PLAN_LEAD_MAGNET.md`.

## 3. Panel (estado: completo y auditado)

Está en producción y probado con un recorrido de 31 comprobaciones: roles administrador/consultorio, códigos por clínica, guardado con avisos, borradores locales, historial de cambios y redirecciones de direcciones mal escritas. Lo que falta:

- [ ] El consultorio Guerra–Mininni (demo conservada) tiene que entrar con su código y cargar sus reglas reales. El código lo crea el administrador en Panel → Configuración → «Acceso del consultorio» y se manda por WhatsApp desde ahí.
- [x] **Google Calendar** (24/10): credenciales en Vercel, reintentos en n8n y conexión probada en vivo por el usuario (demo «Marcos», el turno apareció en su calendario). Para clínicas reales falta publicar la app y pasar la verificación de Google. Ver [`GOOGLE_CALENDAR.md`](GOOGLE_CALENDAR.md).
- [ ] **Avisar al paciente cuando la clínica cancela o mueve un turno.** Hoy el panel avisa que hay que hacerlo a mano. Se puede mandar por WhatsApp cuando el canal esté conectado.
- [ ] **Familias con un mismo celular.** Hoy un celular es un paciente: si una madre saca turno para dos hijos, quedan en la misma ficha. Hace falta «titular y familiares» (cambia el esquema y cómo el agente identifica al paciente). Desde el 27/10, `buscar_paciente` ya no mezcla fichas en ese caso: le pide al agente derivar a recepción.
- [ ] **Unificar las fichas repetidas del consultorio Guerra–Mininni** (Mariano Mininni, Juan Carlos Montes) desde Panel → Pacientes → ficha → «Unificar en esta ficha», y borrar las de prueba (Martina López, «Sin nombre» DNI 30111222) cuando haya cómo.
- [ ] **Sobreturnos** (dos pacientes a la misma hora con el mismo profesional). Hoy la base lo impide a propósito. El panel ya puede dar turnos fuera de horario, en días bloqueados u ocupados en Google («Darlo igual»).
- [ ] **Aviso cuando Google pide reconectar** (permiso vencido o revocado). Hoy solo se ve en el panel; podría ir por n8n a la clínica.
- [ ] Mejoras posibles: roles por persona dentro de la clínica, admisión digital y cobranzas. Son ampliaciones, no arreglos.
- [x] **Campañas para activar la base** (25/10): oportunidades con valor, controles por prestación y por paciente, reglas de contacto, lista que se revisa, envío desde el WhatsApp de la clínica o con Sofi, e importación de pacientes desde Excel o CSV. Ver [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md).
- [ ] Que el usuario pruebe Campañas con una planilla real de un consultorio (por ejemplo, Guerra–Mininni) y el envío desde su WhatsApp. Siguientes pasos de campañas (secuencias, respuestas marcadas a mano, automáticas por clínica, segmentos por edad) en `PLAN_CAMPANAS.md`.

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
- [x] **Grabación nativa en Twilio solicitada** (25/10): `call_recording_enabled: true` en llamadas salientes comerciales y clínicas iniciadas por Turnia. Sin grabación global ni cambios de otras líneas; accesos a Recording Logs en el panel.
- [ ] **Ver el primer audio grabado real en Twilio** tras una llamada nueva autorizada y con saldo. Los audios viejos no grabados no se reconstruyen. La prueba de código pasó; no se hizo una llamada paga para comprobar el artefacto.
- [x] **Editor de Sofi comercial**: `/panel/comercial/configuracion`, saludo/system prompt/voz, aplicación comprobada, versiones y restauración. Fichas con bloqueo concreto y enlace para resolverlo. Guardar pausa y no llama. 232 pruebas; detalle en `COMERCIAL_AGUSTIN.md`.
- [ ] **Saldo de Twilio (actualización 24/10, tarde)**: la consola muestra suspensión por fondos y **−US$0,49524**. Resolver con el titular, sin recargas del agente ni cambios en HolaVeggie. El saldo positivo de notas anteriores quedó desactualizado. El panel no detecta el saldo automáticamente.
- [x] **Sofi comercial, voz y pitch**: pedido posterior del usuario de usar la voz real de la recepcionista, con agente separado y mismo ID. Panel explica pruebas al mismo número y alta de uno nuevo. No se llamó nuevamente; piloto pausado. Falta validar por teléfono el pitch nuevo y las herramientas cuando haya saldo y autorización. Ver [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Agente comercial Agustín/Mauricio probado**: el usuario autorizó **US$5/día** y una única llamada propia, ya atendida y con voz confirmada. 65 s reales (configuración de 60 s más cierre), Twilio US$0,7056 y ElevenLabs 452 créditos. El panel conserva cupo US$5 y reserva US$1, pero quedó **pausado por saldo Twilio US$0,21916**, insuficiente para otro minuto al móvil. No recargar ni tocar otros negocios. Falta saldo disponible, destinatarios revisados y prueba real de herramientas de interés/baja/end_call antes de prospectar. Estado e IDs en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
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
| Campañas, importación de pacientes y CRM | `PLAN_CAMPANAS.md` |
| Google Calendar | `GOOGLE_CALENDAR.md` |
| Google Sheets | `GOOGLE_SHEETS.md` |
| Qué es Turnia, decisiones y arquitectura | `CONTEXTO_PROYECTO.md` |
