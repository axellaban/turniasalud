# Turnia Salud — estado operativo y prioridades

Actualización: 22/10/2026 (Argentina). Este registro prevalece sobre los pendientes históricos de los otros documentos. No contiene credenciales.

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

- [ ] Chip de prueba y sesión de WAHA en el VPS, acceso y variables `WAHA_*`.
- [ ] Crear Custom Channel en el agente y cargar sus valores en los campos correctos de Vercel, sin mostrarlos en chat ni en documentación.
- [ ] Configurar webhook HMAC y elegir WAHA en el panel. La configuración observada todavía indica Meta y no tiene las seis variables de WAHA/Custom Channel.
- [ ] Probar texto, audios entrantes, turnos, cancelación, memoria, recetas y derivación a recepción con el número de prueba. Permiso Speech to Text pendiente de verificación.
- [ ] Definir los destinos de avisos asistenciales; la autorización de email de esta sesión es para pedidos comerciales de demo, no para enviar datos de pacientes.
- [ ] Activar campañas solamente después de validar el canal, los destinatarios y la baja de mensajes. Workflow `g0H8xbQvRNv5FxQj` continúa desactivado.

## Prioridad 2b: lead magnet "Probá la demo con tu web" (después de WAHA)

- [x] Landing `/probar-demo`, flujo por WhatsApp, lectura de la web, ficha con Claude, clínica temporal y modos llamada/audio/chat. Tests de integración con servicios simulados. Detalle en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md).
- [x] Unido a `main` (PR #6) y publicado: `/api/health` → `demo.base: true` (la base se actualizó sola en el deploy). El número de la landing sale solo de WAHA.
- [ ] **Lo que queda lo hace la próxima IA** con computer use cuando el usuario lo pida: cargar `ANTHROPIC_API_KEY` en Vercel, revisar los permisos de ElevenLabs y, con WAHA conectado, probar los tres modos. Checklist en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md#puesta-en-marcha-lo-que-queda-para-la-próxima-ia).

## Prioridad 3: primera clínica y ampliaciones

- Cargar datos y protocolos reales de la clínica; hoy sigue el centro ficticio de demo. No reemplazar datos por suposición.
- Hacer una conversación hablada completa con una persona, comprobar una herramienta y el registro final; el circuito de reserva por chat ya tuvo una prueba anterior exitosa.
- Revisar acceso, consentimiento, conservación de datos y los textos de privacidad antes de usar pacientes reales. No activar Zero Retention a ciegas: el plan de Custom Channel documenta incompatibilidad.
- Configurar derivación telefónica si se elige teléfono de recepción. Agendas externas, roles por clínica, admisión digital y cobranzas son ampliaciones posteriores.
- Video propio del hero, casos reales y precios: pendientes de contenido; la web usa una foto de respaldo.

## Continuidad sin computer use

El código y los tests se pueden continuar desde el repositorio. Los accesos a consolas permanecen en las sesiones del navegador del usuario. n8n permite buscar los workflows por MCP, pero su detalle no está habilitado por MCP; se editó desde la UI sin ampliar ese acceso. No tocar proyectos ajenos a Turnia ni contratar planes. Las credenciales no se copian a este documento.

## Referencias de esta entrega

- App: https://turniasalud.vercel.app/panel/demos
- PR integrado: https://github.com/axellaban/turniasalud/pull/5
- CI aprobado (98 tests): https://github.com/axellaban/turniasalud/actions/runs/39685558750
- Producción comprobada: https://vercel.com/labans-projects-c5c64fdc/turniasalud/2FEsHc3xyKH8A7GPSTUhAo4Sr3HY
- Ejecución de email pendiente de reconexión: https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q/executions/50206
