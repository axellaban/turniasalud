# Turnia Salud — qué falta (traspaso para la próxima IA)

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
- [x] **WAHA vinculado por el usuario**, quien confirmó que funciona. No repetir el diagnóstico ni modificar su conexión. WhatsApp está pausado en el selector de Turnia; Telegram sigue activo.
- [ ] Decidir si los avisos al equipo salen por email (requiere reconectar Gmail en n8n) y a quién van los avisos asistenciales.
- [ ] Opcional: un video propio para el hero, si no quiere los clips de stock (ver 4).

## 2. Prueba en vivo

- [ ] **Límites de Sofi (05/11), después del deploy:** actualizar los dos agentes: Sistema → «Crear / actualizar agente», para que Sofi tenga `silenciar_numero`, y Configuración (Guerra–Mininni) → «Crear / actualizar Sofi de esta clínica», para que las llamadas corten a los 8 minutos y tras 20 s de silencio. Probar desde otro teléfono escribiendo como vendedor («Hola, ofrecemos software para consultorios»): Sofi contesta una vez y el número aparece en Conversaciones → Números en pausa; reactivarlo al final. Detalle en `ESTADO_Y_PRIORIDADES.md` → «Límites de Sofi».
- [ ] **Turno completo por llamada en Guerra–Mininni:** el 03/11 se verificó que Sofi atiende las llamadas al número habitual, con el desvío de Movistar al destino interno de Twilio y el agente propio en ElevenLabs. Queda probar una reserva ficticia por llamada, verla en la agenda del consultorio y cancelarla.

- [ ] **Notas de voz en WhatsApp (03/11):** desde otro teléfono, mandarle un **audio** a la línea de Guerra–Mininni y confirmar que Sofi contesta con **nota de voz** que se escucha bien (y, si hay link, también por escrito); escribirle «mandámelo en audio» y confirmar lo mismo; después escribirle texto común y confirmar que vuelve a contestar con texto. Si llega texto en vez de audio, mirar en Vercel el log «No se pudo mandar la nota de voz; se entrega el texto» (voz del agente, Text to Speech o `sendVoice` de WAHA). Cada respuesta en voz consume Text to Speech de ElevenLabs.
- [x] **Línea propia de Guerra–Mininni (02/11), +54 9 11 7243-3765:** `WORKING` y cuenta correcta verificados. El usuario recibió respuestas reales de texto y audio; conversación en la ficha correcta. Con datos ficticios se comprobaron reserva, cancelación por chat con más de 24 horas, derivación a recepción con menos de 24 horas, lectura de una foto descargada de WAHA y documento guardado en la ficha. Pruebas técnicas de reserva/foto dirigidas al propio número de Sofi, con eventos entrantes firmados; falta observar una foto desde otro teléfono. Datos ficticios retirados. PR #84 publicado, 330 pruebas aprobadas. Mantener la sesión operativa; no repetir la vinculación ni pedir la terminal. La demo general sigue en Telegram y la ficha del consultorio conserva su carácter de prueba.

- [x] Demo en el navegador probada en producción (24/10): lectura, chat y voz.
- [x] La demo en el navegador entra en una pantalla, en la computadora y en el celular (24/10; detalle en `ESTADO_Y_PRIORIDADES.md`).
- [ ] Que el usuario la pruebe con su propia voz y mire el interesado en Panel → Pedidos de demo (el de prueba es `prueba-claude@turnia.test`, se puede borrar). La demo arranca en voz; Telegram ya no se ofrece en `/probar-demo`.

Cuando el usuario elija reactivar WhatsApp desde Panel → Sistema (sin cambiar WAHA):


- [ ] `https://turniasalud.vercel.app/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`.
- [ ] **Demo con tu web** (`/probar-demo`), con el WhatsApp del usuario y datos ficticios («Prueba Turnia», DNI 11111111, particular): opciones 1/2/3, chat hasta reservar, `MENU` → audio (¿llega nota de voz?), `MENU` → llamada, `SALIR`. Medir cuánto tarda la lectura de la web con Claude. Checklist completa en `PLAN_LEAD_MAGNET.md` (paso 5 y «A verificar en vivo»).
- [ ] WhatsApp general de la demo: completar memoria y receta. **La línea propia de Guerra–Mininni ya probó texto y audio reales, y reserva, cancelación y derivación en la prueba técnica del 02/11.**
- [ ] **Probar a Sofi (03/11):** con el código del Dr. Mininni, abrir Panel → Probar a Sofi y probar los tres canales:
  - **WhatsApp:** escanear el QR desde otro celular.
  - **Telegram:** «Preparar el enlace», elegir chat y pedir un turno. Tiene que reservar en la agenda real.
  - **En esta pantalla:** hablarle y escribirle.

  Cancelar los turnos de prueba al terminar.
- [ ] **Seguimiento cuando el paciente no contesta (Guerra–Mininni, 03/11):** confirmar en n8n que el disparador de cada 10 minutos a `/api/automations/calendario` está activo; sin él no sale ningún seguimiento. En Configuración → «Si el paciente no contesta», elegir 1 o 2 veces y las horas de espera. Probar desde otro teléfono con datos ficticios: pedir un turno, no contestar los horarios y esperar el mensaje (de 9 a 20). Contestar y ver que Sofi vuelve a mirar la agenda antes de reservar. Cancelar al final.
- [ ] **«Consulta de implantes» (Guerra–Mininni, 03/11):** después del deploy, actualizar los dos agentes (Sistema → «Crear / actualizar agente» y Configuración → «Crear / actualizar Sofi de esta clínica»). Revisar que haya una prestación de consulta de 30 minutos, sin «Solo la da el consultorio». Después, por WhatsApp y con datos ficticios, pedir «un turno para una consulta de implantes». Sofi tiene que ofrecer horarios y confirmar «Consulta de implantes», y el turno tiene que figurar así en la Agenda. Cancelarlo al final.
- [ ] **Control y limpieza en la misma visita (Guerra–Mininni):** el 03/11 se actualizaron el agente de WhatsApp y el de llamadas y se habilitó «Mantenimiento periodontal (limpieza)» de 45 minutos. Falta la prueba de punta a punta por WhatsApp con datos ficticios. Verificar una visita con la Dra. Coldeira, con las dos prestaciones consecutivas en agenda, y cancelar al final. Revisar con recepción dos turnos previos anunciados como limpieza que figuran como «Control», antes de ajustar prestación o duración.
- [ ] **Fotos por WhatsApp:** en Guerra–Mininni ya se probó descarga de WAHA, lectura de una credencial ficticia, respuesta y foto guardada en la ficha (02/11; evento entrante técnico y entrega al propio número). Completar desde otro teléfono y con los tipos orden/receta. Por Telegram ya se puede probar en la demo.
- [ ] Una conversación hablada completa con una persona (la llamada web solo se probó hasta el saludo).
- [ ] Anotar los resultados en `ESTADO_Y_PRIORIDADES.md` y `PLAN_LEAD_MAGNET.md`.

## 3. Panel (estado: completo y auditado)

Está en producción y probado con un recorrido de 31 comprobaciones: roles administrador/consultorio, códigos por clínica, guardado con avisos, borradores locales, historial de cambios y redirecciones de direcciones mal escritas. Lo que falta:

- [ ] El consultorio Guerra–Mininni (demo conservada) tiene que entrar con su código y cargar sus reglas reales. El código lo crea el administrador en Panel → Configuración → «Acceso del consultorio» y se manda por WhatsApp desde ahí.
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
- [ ] **Aviso cuando Google pide reconectar** (permiso vencido o revocado). Hoy solo se ve en el panel; podría ir por n8n a la clínica.
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
- [x] **Conversación telefónica real validada por el usuario** (24/10): Sofi habló y escuchó por Twilio, registro de 21 mensajes y cierre por el destinatario. ElevenLabs: 2:11 y 1.464 créditos totales; Twilio: 2:12 y US$1,0584. Cinco intentos autorizados en total; los errores manuales de variables quedaron corregidos y documentados. No reintentar lotes ni llamar de nuevo sin pedido explícito. Telegram sigue usando enlace web.
- [x] **Identificación de llamada confirmada por el usuario:** en el celular receptor apareció la línea de Turnia.
- [x] **Grabación nativa en Twilio solicitada** (25/10): `call_recording_enabled: true` en llamadas salientes comerciales y clínicas iniciadas por Turnia. Sin grabación global ni cambios de otras líneas; accesos a Recording Logs en el panel.
- [ ] **Ver el primer audio grabado real en Twilio** tras una llamada nueva autorizada y con saldo. Los audios viejos no grabados no se reconstruyen. La prueba de código pasó; no se hizo una llamada paga para comprobar el artefacto.
- [x] **Editor de Sofi comercial**: `/panel/comercial/configuracion`, saludo/system prompt/voz, aplicación comprobada, versiones y restauración. Fichas con bloqueo concreto y enlace para resolverlo. Guardar pausa y no llama. 232 pruebas; detalle en `COMERCIAL_AGUSTIN.md`.
- [x] **Saldo de Twilio**: el usuario confirmó el 27/10 que hay saldo (la suspensión del 24/10 quedó atrás). El panel no detecta el saldo automáticamente.
- [x] **Sofi comercial, voz y pitch**: pedido posterior del usuario de usar la voz real de la recepcionista, con agente separado y mismo ID. Panel explica pruebas al mismo número y alta de uno nuevo. No se llamó nuevamente; piloto pausado. Falta validar por teléfono el pitch nuevo y las herramientas cuando haya saldo y autorización. Ver [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Agente comercial Agustín/Mauricio probado**: el usuario autorizó **US$5/día** y una única llamada propia, ya atendida y con voz confirmada. 65 s reales (configuración de 60 s más cierre), Twilio US$0,7056 y ElevenLabs 452 créditos. El panel conserva cupo US$5 y reserva US$1, pero quedó **pausado por saldo Twilio US$0,21916**, insuficiente para otro minuto al móvil. No recargar ni tocar otros negocios. Falta saldo disponible, destinatarios revisados y prueba real de herramientas de interés/baja/end_call antes de prospectar. Estado e IDs en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [ ] **Atención humana por chat**: implementar Tomar / Devolver al agente con pausa persistida y descarte de respuestas pendientes; conservar la app WhatsApp Business y WAHA, sin incorporar Chatwoot por rutina.
- [ ] **Piloto de prospección telefónica**: destinatarios revisados, reglas de contacto/No Llame, baja persistente y probada, autorización manual, límite efectivo de duración/consumo y resultados. Validar que el agente pueda colgar y no afirme registrar una baja sin haberlo hecho. No reutilizar el destino de la prueba que pidió no recibir más llamadas. No activar llamadas en frío ni campañas automáticamente.

- [x] **Ficha de salud de Guerra–Mininni por chat** (04/11): hecha con la hoja en blanco que pasó el usuario. Detalle en `ESTADO_Y_PRIORIDADES.md`.
  - [x] Agentes actualizados por el usuario después del deploy (04/11): Sistema y Configuración.
  - [ ] Probar por WhatsApp con datos ficticios: paciente nuevo, reservar una consulta, recibir la plantilla en un mensaje aparte, devolverla completa y ver la ficha en Pacientes y en «Imprimir para firmar». Cancelar el turno y borrar la ficha de prueba.
  - [ ] Acordar con Mariano: ¿a los pacientes que ya venían (tienen la ficha de papel) se les ofrece una vez? Hoy no. Y si la actualización anual le sirve.
  - [ ] Más adelante: pasar las respuestas a Smile Connect, si tiene una vía soportada.

## 6. Técnico menor

- [ ] **Las cuentas no aparecen en `/api/metricas`:** cuenta clínicas y uso solo con `is_demo` falso, y las cuentas de los consultorios son clínicas conservadas (`is_demo` verdadero). Contarlas por su código de acceso, como `scripts/embudo.mjs`. Ver [`EMBUDO.md`](EMBUDO.md), «Pendiente para medir mejor».
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
| Protocolos odontológicos, base común y reglas del panel | `PLAN_PROTOCOLOS.md` |
| Qué es Turnia, decisiones y arquitectura | `CONTEXTO_PROYECTO.md` |
