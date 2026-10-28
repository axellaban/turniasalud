# Turnia Salud — estado operativo y prioridades

Actualización: 28/10/2026 (Argentina). Este registro prevalece sobre los pendientes históricos de los otros documentos. No contiene credenciales. **La lista consolidada de lo que falta está en [`PENDIENTES.md`](PENDIENTES.md).**

## Vista previa de las demos en WhatsApp, guardada en la base — 28/10/2026

- **Problema:** algunos links de demo (por ejemplo `/p/monte-xbm`) seguían saliendo sin imagen en WhatsApp. La imagen se guardaba en la caché de Vercel, que se pierde en cada deploy y no siempre quedaba armada: cuando faltaba, armarla tardaba 2,5 a 4 s y WhatsApp no la esperaba.
- **Ahora:** la imagen de cada uno queda guardada en la base (`sales_outreach_previews`) y se sirve desde `/p/<código>/vista-previa?v=<versión>`, que sale en menos de un segundo y después queda en la CDN. La versión cambia cuando cambian el nombre, el tratamiento, el consultorio o la especialidad, o el dibujo (`DISENO` en `src/lib/sales/demo-preview.ts`). Mientras se rearma, sale la anterior.
- Se arma al importar, al editar y al saludar; las que faltan, en segundo plano cada vez que se abre Panel → Prospección (hasta 40 s por vez). Después del deploy, **abrir Panel → Prospección una vez** arma las de todos.
- WhatsApp recuerda la vista previa de un link en el celular que la pidió: un link que ya salió sin imagen puede seguir así un rato en ese celular.
- 1 prueba nueva (303 en total), TypeScript, ESLint y build.

## Paciente que vuelve: con nombre y DNI alcanza — 28/10/2026

- **Feedback del Dr. Mininni:** «para retomar una conversación te pide la fecha de cumpleaños; no tiene sentido si ya le pasás nombre y DNI». El paciente escribió «soy Jorge Martínez 32064291» y Sofi igual le pidió la fecha de nacimiento.
- **Ahora:** `buscar_paciente` confirma con DNI + nombre y apellido, como la recepción. La fecha de nacimiento queda como segunda oportunidad: solo se pide si el nombre no coincide (apodo, segundo nombre) o si la ficha no tiene nombre. Si tampoco coincide, sigue sin mostrar la ficha ni decir qué falló. Si el paciente ya dio nombre y DNI en el primer mensaje, el prompt le indica buscarlo enseguida.
- Pruebas actualizadas (302 en total), TypeScript y ESLint. **Hace falta «Crear / actualizar agente»** después del deploy para que ElevenLabs tome el prompt y la descripción nueva de la herramienta (los mensajes que devuelve la herramienta cambian solos con el deploy).
- **Mismo feedback, sin tocar todavía:** (1) los **dos sillones** (en Smile Connect cada profesional tiene un sillón por defecto y en el turno se elige profesional y consultorio): hoy la agenda es por profesional y no hay consultorios; ver `PENDIENTES.md`. (2) Integración con **RCTA** para mandar recetas (por ejemplo, de radiografías): queda para v2.

## Prueba completa por chat y ajuste del prompt — 27/10/2026

- **Probado en producción por chat** (Guerra–Mininni): reconoce por celular, reserva, reprograma y cancela (Valeria Soto); reconoce por DNI y aplica «menos de 24 hs → secretaria» con tarea (Mininni); paciente nuevo con reserva, centro de Rx según cobertura (TcMax para Swiss Medical) y cancelación; precio solo de la primera consulta; ortodoncia derivada; conducto sin obra social; urgencia según el protocolo; ficha sin fecha de nacimiento reconocida por nombre (Diego Romero).
- **Corregido en el prompt:** con un paciente nuevo, confirmaba el turno antes de pedir los datos que la clínica exige para agendar (nacimiento, mail, alergias) y los pedía después. Ahora no ofrece ni reserva hasta tenerlos. Tampoco vuelve a saludar después del primer mensaje.
- Hace falta «Crear / actualizar agente» después del deploy.

## Borrar fichas de pacientes — 27/10/2026

- **Pedido:** limpiar las fichas de prueba del consultorio Guerra–Mininni y dejar solo los mejores casos.
- **Panel → Pacientes** (solo el administrador; el acceso del consultorio sigue sin poder borrar): casillas por ficha, «Seleccionar todas» y «Borrar N fichas», con confirmación. En la ficha, «Borrar ficha».
- Se borran la ficha y todo lo suyo: turnos, conversaciones, pedidos, lista de espera, campañas, visitas y otros números. Antes se sacan del Google Calendar del profesional los eventos de sus turnos; si alguno no se puede sacar, el aviso lo dice.
- Mismo día: se unificaron las fichas repetidas (Mininni 5 → 1, Montes 2 → 1) con «Unificar en esta ficha».
- 2 pruebas nuevas (301 en total), TypeScript y ESLint.

## Pacientes que ya existen: por DNI y sin fichas repetidas — 27/10/2026

- **Pedido (consultorio Guerra–Mininni):** «aunque ya figuro como paciente, cuando pido un turno nuevo me pide todos los datos nuevamente». En las pruebas, el agente pedía DNI y fecha de nacimiento pero no encontraba la ficha: solo reconocía al paciente por el número. Cada conversación web creaba una ficha nueva (Mariano Mininni tenía 6).
- **Herramienta nueva `buscar_paciente`** (son 10): con DNI y fecha de nacimiento (o nombre y apellido si la ficha no tiene fecha) confirma quién es y une la conversación a su ficha. Si no coincide, no devuelve datos ni dice qué falló. Si el número ya es la ficha de otra persona, no las mezcla (sigue pendiente «familias con un mismo celular»).
- **Otros números del paciente** (`patient_phones`): el número desde el que se identificó queda apuntando a su ficha; todas las búsquedas por teléfono lo usan. `registrar_paciente` con un DNI que ya está en otra ficha hace la misma verificación: si confirma, se une; si no, el DNI no se guarda.
- **Cambio de cobertura:** borra el plan y el afiliado de la anterior y le pide al agente los nuevos.
- **Contexto del paciente:** dice qué datos faltan, cuándo vino por última vez (turnos atendidos o visitas importadas) y que no pregunte si ya vino. Sin ficha, indica usar `buscar_paciente` si dice que ya es paciente.
- **Prompt:** las instrucciones de la clínica mandan sobre las generales; si piden usted, se usa usted desde el primer mensaje. Saludo neutro: «¿En qué puedo ayudar?».
- **Panel → Pacientes:** la lista marca «N fichas con este DNI» y la ficha ofrece «Unificar en esta ficha» (pasa turnos, conversaciones, pedidos, visitas y campañas; completa datos; los números de las repetidas siguen llevando a la que queda).
- 9 pruebas nuevas (299 en total), TypeScript y ESLint. Ya se tocó «Crear / actualizar agente» (10 herramientas) y se probó en producción: reconoce por DNI, por nombre si la ficha no tiene fecha, no muestra datos si no coinciden, no pregunta si ya vino, cobertura no aceptada → particular y trato de usted.

## Google Sheets con un botón — 26/10/2026

- **Pedido:** otra forma de llevar los datos a Google Sheets, sin pegar código (lo de Apps Script), que sirva también para que cada clínica conecte su planilla. Se arranca con la de prospección del usuario.
- **Cómo:** «Conectar con Google» en Panel → Prospección → Google Sheets, con el mismo OAuth de Calendar (estado firmado, tokens cifrados, misma vuelta `/api/google/callback`). Pide solo `drive.file`, que no es sensible: Turnia ve únicamente las planillas que crea ella.
- **Qué hace:** crea «Turnia · Prospección y pedidos de demo» en el Drive del usuario, con dos pestañas, y la reescribe completa después de cada cambio (`after()`), una copia por vez. Si se borra una pestaña, vuelve en la próxima copia. Si se borra la planilla, el panel ofrece crear otra; si Google pide reconectar, «Reconectar».
- **Para clínicas:** la conexión (`sheets_connections`) es por dueño. Falta el selector de una planilla existente y la importación de pacientes e historial desde ahí (`GOOGLE_SHEETS.md`).
- Si falta habilitar Google Sheets API, el panel lo dice y ofrece «Crear la planilla». Desconectar no revoca el permiso si la misma cuenta tiene Calendar conectado: Google revoca todo junto. Calendar hace lo mismo al revés.
- Probado con Google simulado (7 pruebas nuevas):
  - la conexión y las dos pestañas;
  - la copia después de cada cambio, y una copia por vez;
  - la pestaña borrada y la planilla borrada;
  - la API sin habilitar;
  - reconectar y desconectar.
- Calendar sigue igual. 290 pruebas, TypeScript, ESLint y build.
- **Pendiente del usuario:** habilitar Google Sheets API y el permiso `drive.file` en el proyecto de Calendar y tocar «Conectar con Google». Para que el permiso no venza a los 7 días, publicar la app.

## Prospección: consultorios con web y «celular del consultorio» — 26/10/2026

- **Pedido:** integrar los consultorios del tablero viejo (el de la otra cuenta) que no se contactaron. Su base no se puede leer desde esta cuenta: se rearmaron los de Mar del Plata y Miramar con web leyendo cada web (dueños, profesionales, WhatsApp, Instagram) y Páginas Amarillas. Los celulares del Círculo de ese tablero ya están en la lista de 407.
- **Archivo** `consultorios-con-web-mdp-miramar.csv` (fuera del repo, entregado por chat): 25 filas. 12 ya estaban en la lista: se les carga la web (su demo pasa a leerla), el nombre real del consultorio y, si la web lo da, el WhatsApp del consultorio. 13 son nuevas: 5 dueños de consultorios con web y 8 de Páginas Amarillas con fijo (3 de Mar del Plata y 5 de Miramar). Quedaron afuera las redes y prepagas, las webs que ya no existen y un consultorio sin dueño identificable.
- **Panel:** el tipo de teléfono suma **«Celular del consultorio»** (el WhatsApp de su web, lo lee la recepción): recibe el mensaje para la recepción, como el fijo, y tiene su filtro. Importar suma la casilla **«Reemplazar los datos de los que ya están por los del archivo»**: sin marcarla, solo se completa lo que falta, como antes. El nombre, el estado y los contactos no cambian nunca, y las notas nuevas se suman sin repetirse.
- Corregido: el mensaje a la recepción decía «Le armé a el Dr. …» (ahora «al Dr. …») y el guion de llamada, «de el Dr. …».
- Probado: importando la lista de 407 y después este archivo en un panel local (13 nuevas y 12 actualizadas, sin perder un contacto ya hecho), axe sin problemas y sin scroll horizontal a 390 px. 283 pruebas, TypeScript, ESLint y build.
- **Pendiente del usuario:** importar el archivo con la casilla marcada.

## Pedidos de demo → Google Sheets — 25/10/2026

- **Pedido:** que cada pedido del formulario «Pedí una demo» aparezca en una planilla de Google, directo y sin n8n.
- **Cómo:** una aplicación web de Apps Script dentro de la planilla del usuario recibe los pedidos. Google no deja escribir en una planilla desde un servidor solo con el link (aunque tenga edición pública): hace falta algo que escriba con la cuenta del dueño. El código sale de Panel → Pedidos de demo → «Copiar a Google Sheets» (`/panel/demos/planilla`) con la clave ya puesta (derivada de `SESSION_SECRET`, no se guarda). El usuario lo pega en Extensiones → Apps Script, lo implementa como aplicación web («Yo» / «Cualquier persona») y pega la URL `/exec` en el panel: se guarda en `sales_settings.leads_sheet_url` y se prueba.
- **Qué se copia:** cada pedido nuevo (formulario y quienes prueban la demo en el navegador, WhatsApp o Telegram), los cambios de estado y notas del panel (se actualiza la misma fila por ID) y los borrados. «Copiar los pedidos que ya hay» trae los anteriores. Corre después de responder (`after`): si la planilla falla, el pedido igual queda en Turnia y el error se ve en el panel.
- La planilla tiene datos de contacto de personas: no hace falta que sea pública (el script escribe como su dueño). Se recomendó sacar la edición pública del link que pasó el usuario.
- Código en `src/lib/leads-sheet.ts`; el código de Apps Script se prueba en Node con una hoja simulada (`src/lib/leads-sheet.test.ts`) y la integración en `src/test/leads-sheet.integration.test.ts`. 282 pruebas, TypeScript, ESLint y build.
- **Pendiente del usuario:** conectar su planilla desde el panel (cinco pasos, una sola vez).

## Prospección: tratamientos en la demo y «Deshacer contacto» — 25/10/2026

- **Pedido:** que la demo de cada link use lo que sabemos del odontólogo, y poder sacar el «Contactado» de las pruebas.
- **Tratamientos:** el link pasa la especialidad de la ficha (de Doctoralia en 208 de los 407) como `servicios`; `manualProfile` suma un turno de primera vez por tratamiento reconocido (implantes, ortodoncia, estética/blanqueamiento, endodoncia, odontopediatría, prótesis/rehabilitación, periodoncia, cirugía), los pone en la bio del profesional y en las preguntas frecuentes. La página `/p/<código>` y la vista previa de WhatsApp muestran un ejemplo sobre su tratamiento principal. Columna nueva `demo_sessions.manual_services`. Código en `src/lib/demo/dental-services.ts`.
- **Ninguno de la lista tiene web cargada** (el Círculo no la trae): todos usan la demo sin web. Si se carga la web en la ficha, la demo la lee al tocar «Probar la demo».
- **Deshacer contacto** (fila y ficha): borra el último mensaje, llamada o visita y recalcula el seguimiento; sin contactos vuelve a «Por contactar» y sale de la meta del día.
- Validación: 276 pruebas, TypeScript, ESLint y build. En el navegador: demo de un odontólogo con implantes (8 turnos, bio y preguntas frecuentes con sus tratamientos), páginas y vistas previas, y deshacer un contacto (la meta vuelve a 0 y reaparece en la cola).

## Prospección a odontólogos de Mar del Plata y Miramar — 25/10/2026

- **Pedido:** seguir la prospección del tablero viejo (artefacto de la otra cuenta, sin créditos) llegando a **quien decide** y no a la recepción, con la meta de **250 primeros contactos en la semana del 26 al 30/10** en Mar del Plata y Miramar. Estrategia, plan por día y mensajes en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).
- **El tablero viejo no se puede leer desde esta cuenta** (la base del artefacto es de la otra organización): ni la lista ni los estados. Quien ya recibió mensaje se reconoce al abrir el chat y se marca «Ya le había escrito».
- **Lista nueva, de personas:** 407 odontólogos del listado público del Círculo Odontológico de Mar del Plata, cruzados con Doctoralia (especialidades, opiniones, agenda online, si pagan la plataforma, Dr./Dra.). 139 con celular propio, 32 que comparten el celular de un consultorio (14 números), 196 con fijo y 40 sin teléfono. Nombres con partículas y compuestos revisados («María de los Ángeles», «San Martín», «del Curto»); el cruce exige que coincidan nombre y apellidos en los dos sentidos. Se entregó como CSV al usuario: **no está en el repo**.
- **Panel → Prospección** (`/panel/prospeccion`, solo administrador): importación (CSV o celdas; reimportar solo completa lo que falta), cola «Para hoy» (seguimientos que vencieron y nuevos por prioridad hasta la meta diaria, un número compartido una sola vez), botón de WhatsApp con el mensaje armado (WhatsApp Web en la compu, la app en el celular; registra el contacto y programa el seguimiento: 2 y 4 días hábiles, tres mensajes como máximo), Instagram (copia el mensaje y abre el chat), llamada con guion, estados, ficha editable, notas e historia, y mensajes y metas editables.
- **Demo personal por odontólogo:** `/p/<código>` con su nombre, la vista previa de WhatsApp con su consultorio en el chat (`src/lib/sales/demo-preview.ts`) y un botón que arranca la demo sin web con su consultorio, su dirección y **su nombre como profesional** (`demo_sessions.manual_professional`). La página avisa cuando la abre (no cuenta si la abre Axel desde el panel) y `/api/demo/iniciar` con `ref` deja la demo en su ficha y pasa el seguimiento a hoy.
- **Baja:** «Pidió no recibir más» lo saca de la cola para siempre y lo suma a `sales_suppressions` (tampoco lo llama Sofi).
- Tablas nuevas `sales_outreach` y `sales_outreach_events`; `sales_settings` suma mensajes y metas. Código en `src/lib/sales/outreach*.ts` y `src/app/panel/(app)/prospeccion/`.
- Validación: 13 pruebas nuevas (7 de integración con Postgres), 272 en total; TypeScript, ESLint y build. Recorrido en el navegador con la lista real en una base local: importación de las 407, cola, WhatsApp (mensaje y link correctos), «Ya le había escrito», seguimiento del día, ficha, interesados, mensajes, página pública en escritorio y celular, vista previa e inicio de la demo desde el link (queda registrada). axe sin problemas y sin scroll horizontal.
- **Pendiente del usuario:** importar la lista en producción, poner el perfil de Turnia en su WhatsApp Business y arrancar el lunes con «Para hoy».

## Teléfono editable y guion breve — 25/10/2026

- Pedido: escribir el teléfono en un campo y reducir la mezcla de instrucciones; **saludo inicial intacto**. La última prueba del usuario (13:23, 63 s) mostró el desvío: aceptó un control y el prompt lo llevaba a vender Turnia.
- Campo «Teléfono a llamar» y «Guardar número» en la ficha. No llama al guardar. Un borrador sin guardar deshabilita la llamada. Cambiar de número conserva contexto e historial, invalida la revisión del destino anterior y vuelve a pedir revisión del nuevo. Se bloquean bajas, formatos ambiguos, llamada activa y formularios viejos; la confirmación de llamada está vinculada al teléfono mostrado.
- El editor de revisión se remonta al cambiar el teléfono para no conservar en pantalla la autorización anterior. La acción de revisión valida también el teléfono esperado. No se trasladan permisos entre destinos.
- Prompt predeterminado y reglas agregadas reducidos. Ya no se fuerza una secuencia comercial sobre una demostración de seguimiento. Se mantienen límites de herramientas, no inventar disponibilidad, no confirmar reservas inexistentes, bajas y cierre. Los identificadores internos siguen en los parámetros automáticos de herramientas; no hace falta incluirlos en el texto que lee el modelo.
- Contexto dinámico reducido a clínica y notas; se quitó la oferta fija con «Axel» que contradecía «Facu». La respuesta de la herramienta de seguimiento es neutral y no afirma reservar turnos.
- Validación: 259 pruebas locales, 39 específicas de Comercial/bloqueos tras los ajustes, TypeScript, ESLint y build; navegador local confirma borrador bloqueado, teléfono guardado y revisión anterior limpiada.
- Aplicación en producción: editar solo el system prompt, conservar exactamente saludo y voz, guardar versión y comprobar ElevenLabs; simplificar también las notas de la ficha de prueba. Mantener el cupo autorizado de US$5 y sus reservas, sin llamar ni recargar. No se modifica la recepcionista clínica ni WAHA.

## Nombre de la clínica en la llamada comercial — 25/10/2026

- El usuario escuchó «Consultorio de prueba de Axel» porque `business_name` salía de la ficha comercial, no de la clínica seleccionada en el encabezado. Se conserva esa separación para no cambiar un destinatario comercial al navegar entre clínicas.
- El nombre se puede editar desde «Editar datos y revisión del contacto». La ficha muestra «Nombre que dirá Sofi» y una vista previa del saludo con el nombre real sustituido. La creación de contactos usa la misma etiqueta para evitar guardar alias de prueba que luego se pronuncien.
- Guardar el nombre no aplica cambios al agente ni inicia llamadas. La próxima solicitud usa el nombre actualizado; las llamadas anteriores conservan el nombre que tenían al iniciarse y el teléfono de destino se mantiene.
- Corrección solicitada en esta ficha: «Consultorio Odontológico Dr. Guerra y Dr. Mininni». No se modifica el saludo personalizado ni la configuración clínica.

## Comercial: llamada lista y contexto en un solo lugar — 25/10/2026

- El usuario no podía habilitar otra prueba: ElevenLabs devolvía `status: initiated` pero `metadata.phone_call.call_result: no_answer`, duración 0 y sin stream. El panel solo reconocía `done`/`failed` y mantenía la llamada bloqueada.
- `refreshSalesCall` concilia también `no_answer`, `busy` y `failed` **solo** si el agente, ID del intento y conversación coinciden, es Twilio saliente al mismo teléfono, sigue `initiated`, no tiene stream, duración ni transcripción. Se conserva la reserva de US$1. No se libera por tiempo transcurrido ni se reintenta.
- Panel comercial: contactos primero; cupo diario y guion general separados. Agregar otro número queda plegado para no pedir datos de nuevo al repetir una prueba.
- Ficha: control de llamada arriba, estado concreto y confirmación individual. Datos del consultorio guardados y editor plegable; guion general en su propio enlace. Cupo editable en la misma ficha. Llamada pendiente con «Comprobar si ya terminó» en ambas pantallas, sin circular entre enlaces `#pendiente`.
- Se conserva el saludo personalizado **versión 2** y el cupo ya autorizado de US$5 del usuario. No se cambió configuración en ElevenLabs, WAHA, clínica, Twilio ni otro negocio; no se inició ninguna llamada.
- Pruebas de conciliación: terminales sin respuesta/ocupado/fallo; se rechazan destinatario distinto, stream activo, dirección entrante, SIP, otro ID y llamadas con duración. Los controles de gasto, baja, revisión y no duplicación siguen vigentes.
- Validación: 254 pruebas con Postgres local, TypeScript, ESLint y build correctos; ficha revisada en navegador local sin llamar.
- Fuente del campo `call_result`: [ElevenLabs, cambios de API](https://elevenlabs.io/docs/changelog/2026/10/12).

## Logo nuevo — 25/10/2026

- **Pedido del usuario:** un logo más profesional, tomando como referencia el de Assort.
- **De Assort se tomaron solo los principios, no su figura** (sigue la regla de no usar su material):
  - el isotipo va suelto, sin el cuadrado de fondo;
  - la marca va en dos pesos: «Turnia» en negrita y «Salud» liviano;
  - todo de un solo color, con el espaciado ajustado.
- **Isotipo:** una burbuja de conversación con la T calada, que une turnos y WhatsApp.
  - Está definido una sola vez en `MARK_PATH` (`src/components/logo.tsx`) y se reutiliza en el header, el panel, el footer y las miniaturas para compartir (`src/lib/og.tsx`).
  - `LogoMark` queda como ícono de app (cuadrado azul) para los avatares y el encabezado del panel en el celular.
- **Íconos:**
  - `src/app/icon.svg` y `favicon.ico` (16, 32 y 48 px): el isotipo azul sin fondo.
  - `src/app/apple-icon.png` (180 px): el ícono de iOS.
  - Las miniaturas usan Geist Light y Bold (`src/assets/og`, licencia OFL incluida).
- **Miniaturas para compartir:** las de la home, especialidades, soluciones y organizaciones llevan el logo nuevo, incluido el avatar del chat de especialidades. WhatsApp, LinkedIn y otras redes guardan las miniaturas viejas un tiempo: un link compartido antes puede seguir mostrando el logo anterior.
- **Kit de marca en `public/marca/`** (se descarga desde `turniasalud.vercel.app/marca/…`):
  - `turnia-perfil.png`: 640×640, la foto de perfil para WhatsApp Business, Telegram y redes;
  - `turnia-logo.png` y `turnia-logo-blanco.png`: el logo horizontal sobre transparente;
  - `turnia-isotipo.svg`: el isotipo solo.
- **Queda a mano del usuario:** cambiar la foto del bot @TurnIA_salud_bot (con BotFather), la del WhatsApp Business de Turnia y las de las redes, si tienen el logo viejo. No se pueden cambiar desde el código.
- **Validación:** build, TypeScript, ESLint y 245 pruebas. Revisado en el header de la compu y del celular (también sobre el video), en el panel, en el footer, en las miniaturas y en el favicon, sobre claro y oscuro.

## Campañas para activar la base — 25/10/2026

- **Pedido del usuario:** mejorar la UX/UI y las funciones de Panel → Campañas para activar la base dormida (controles trimestrales, semestrales, chequeos programados), pensando el negocio con Assort Activate como referencia, y decidir qué hacer con un CRM. Después propuso abrir WhatsApp desde el panel con el mensaje escrito: quedó como el modo principal de envío.
- **Decisión:** sin CRM externo. Turnia es el CRM de pacientes, y la base entra por la agenda propia y por una importación desde Excel o CSV. Los conectores con sistemas de gestión quedan para más adelante. Detalle, referencia de Assort y hoja de ruta en [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md).
- **Campañas:**
  - Arriba, la base para volver a agendar, con su valor según los precios de referencia.
  - Oportunidades con «Revisar y enviar»: controles vencidos, inactivos, ausentes, lista de espera, recordatorios y encuestas.
  - Frecuencia del control de cada prestación (mensual a cada 2 años) y reglas de contacto: meses para contar como inactivo y tope de mensajes por paciente.
  - Historial con embudo: enviados, respondieron, sacaron turno y valor.
- **Cada campaña:**
  - La lista queda guardada y se revisa: quitar, volver a sumar o actualizar.
  - Envío **desde el WhatsApp de la clínica**: abre WhatsApp Web o la app con el mensaje escrito y lo marca como enviado.
  - Envío **con Sofi** (de a 50, por Meta o WAHA, cuando WhatsApp esté conectado).
  - Mensaje editable con `{nombre}` y `{detalle}`. Un turno sacado por cualquier vía después del mensaje cuenta como resultado.
- **Pacientes:**
  - Importación con reconocimiento de columnas, vista previa, una fila por paciente o por visita, confirmación de consentimiento y opción de deshacer.
  - «Próximo control» por paciente y visitas importadas en la ficha.
- **No se activó nada:** WhatsApp sigue pausado para Sofi, el workflow de campañas de n8n sigue desactivado, no se envió ningún mensaje y no se tocaron WAHA ni ElevenLabs.
- **Validación:**
  - 244 pruebas (12 nuevas de campañas e importación), TypeScript, ESLint y build.
  - En el navegador local: importación de 30 pacientes, oportunidades, campaña con envío desde WhatsApp Web (enlace abierto y paciente marcado), en compu y en celular, sin scroll horizontal.
  - axe sin problemas en Campañas, la campaña e Importar.

## Grabaciones telefónicas en Twilio — 25/10/2026

- Pedido explícito: poder ver en Twilio las llamadas grabadas de **Sofi comercial y Sofi de turnos**.
- Confirmado en la API oficial de ElevenLabs: el cuerpo de `/v1/convai/twilio/outbound-call` admite **`call_recording_enabled: true`**, que pide grabación nativa a Twilio. Se agregó en los **dos** caminos salientes de Turnia: `src/lib/sales/service.ts` (comercial) y `startPhoneCall` de `src/lib/elevenlabs.ts` (callback/demos clínicas). No requiere nuevas credenciales ni configurar números o webhooks de HolaVeggie.
- Destino: **Twilio → Monitor → Logs → Call recordings / Recording Logs**. Accesos también en la ficha comercial y en Configuración clínica (solo administrador). La confirmación manual comercial indica que se autoriza una llamada grabada.
- Alcance: **llamadas telefónicas nuevas iniciadas por Turnia**. Las conversaciones web/Telegram no pasan por Twilio y no aparecen allí; los registros previos sin audio no se pueden reconstruir. Esto no incorpora una línea entrante ni modifica las llamadas del operador móvil. Las llamadas que alguien dispare manualmente fuera de Turnia necesitan su propia opción de grabación.
- El audio se solicita en **Twilio**. `privacy.record_voice` de ElevenLabs es independiente y se dejó como estaba; no se activó una segunda copia allí ni grabación global de la cuenta. No se modificó la recepcionista clínica, WAHA, Telegram ni otro negocio.
- Costos publicados consultados el 25/10: **US$0,0025/min** por grabación y **US$0,0005/min/mes** por almacenamiento, más impuestos si corresponden. No se activó transcripción paga, recarga automática ni cambio de plan. No se inició una llamada real desde esta tarea.
- Validación: 232 pruebas, incluidas verificaciones de `call_recording_enabled` en las dos solicitudes reales de código con proveedor simulado y conservación de no-duplicación. TypeScript, ESLint y build correctos. **Pendiente validar el primer audio real en Twilio** después de una llamada autorizada y con saldo disponible. No afirmar que existe una grabación nueva antes de verla.
- Editor previo: PR #51 integrado en `main`, deploy de producción Ready. Primera configuración guardada desde el panel el 25/10: **versión 1**, voz de Sofi, prompt y conexiones comprobados en ElevenLabs, piloto pausado. La configuración clínica comparada por hash antes/después siguió idéntica. Borradores/guardado/restauración ya estaban probados con proveedor simulado; no se alteró el pitch con textos de prueba en producción.
- Fuentes: [ElevenLabs / Twilio outbound-call](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call), [Twilio / grabaciones](https://www.twilio.com/docs/voice/api/recording), [Twilio / tarifas](https://www.twilio.com/en-us/voice/pricing/us).


## Editor de Sofi comercial y bloqueos claros — 24/10/2026

- Pedido: incorporar el editor propuesto y resolver la confusión del botón de llamada desactivado. Nuevo `/panel/comercial/configuracion`: saludo, system prompt y voz editables, guardado/aplicación con comprobación real en ElevenLabs, historial y restauración de versión anterior. No se necesita editar el repo para cambiar el pitch.
- Persistencia en `sales_settings` + `sales_config_versions`. Migración aditiva/idempotente en el despliegue, sin seed de producción. El texto editado se conserva al sincronizar voces y se valida antes de llamar; cada intento registra versión. Formularios obsoletos no pisan cambios nuevos. Si hay fallo parcial del proveedor se marca `needs_sync` y se bloquean llamadas hasta una nueva aplicación correcta.
- La ficha de contacto explica cada bloqueo y enlaza a su solución; incluye revisión vencida y llamadas pendientes de cualquier ficha. Guardar configuración pausa y conserva el cupo; habilitar llamadas sigue siendo un paso separado con confirmación individual.
- Se mantienen agente comercial separado, herramientas de resultado/baja/cierre y límite remoto de 60 s más despedida. Recepcionista clínica, WAHA, Telegram y conexiones de HolaVeggie no se modifican. No se inician llamadas ni recargas en esta implementación.
- **Twilio, lectura solicitada por el usuario:** consola muestra cuenta suspendida por falta de fondos y saldo **−US$0,49524** (reemplaza el saldo positivo del registro anterior). Se abrieron llamadas y grabaciones; última llamada visible de Turnia **19:03:19 Argentina, completada, 63 s**, iniciada fuera de esta tarea. No habilitar ni recargar automáticamente la cuenta compartida.
- Validación: **232 pruebas** (21 comerciales + 4 bloqueos), TypeScript, ESLint y build. En navegador local: validación con borrador conservado, guardado y restauración del saludo/voz con proveedor simulado. Detalle y uso en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).

## Revisión de turnos, cambios y cancelaciones — 25/10/2026

Pedido del usuario: revisar todo el circuito de turnos y calendario. Lo que probó él funcionaba; esto es lo que se encontró y se arregló.

**Errores que había**
- **Coberturas con mayúsculas:** «osde» no coincidía con «OSDE» y el turno se rechazaba («no atiende por osde»). Ahora se comparan sin mayúsculas, tildes ni espacios, y el turno guarda el nombre como lo cargó la clínica.
- **Reintento del agente:** si ElevenLabs repetía `reservar_turno` después de que el primero había entrado, el segundo decía «se acaba de ocupar» (era el propio turno del paciente). Ahora devuelve el turno que ya estaba.
- **Cancelar desde el panel** no avisaba a n8n ni le ofrecía el hueco a la lista de espera (el agente sí). Ahora hacen lo mismo.
- **Reprogramar con otro profesional** no revisaba si atiende la cobertura del paciente.
- **Turnos pasados** se podían cancelar o reprogramar. Ahora no: se marcan como atendidos o ausentes.
- **Dos cambios a la vez** (paciente y panel) podían pisarse. Ahora el segundo recibe «ya no está activo».
- **Atendido o Ausente en un turno futuro:** se podía marcar por error, sin deshacer.

**Casos que no estaban contemplados**
- Un paciente con **dos turnos a la misma hora** (con distintos profesionales): ahora no se permite.
- **Dos turnos de lo mismo:** se da, pero el agente recibe un aviso para preguntarle si quiere los dos. El panel lo muestra.
- **El panel no podía reprogramar:** ahora la ficha tiene «Reprogramar», con los horarios libres del día y la opción de otro profesional de la misma especialidad. Abre la ficha del turno nuevo.
- **Fuera de horario, día bloqueado u ocupado en Google:** desde el panel se puede «Darlo igual». El agente nunca. Otro turno de Turnia en ese horario no se puede superponer nunca.
- **Turnos pasados sin marcar:** sin la marca no andan las encuestas, el recall ni el seguimiento de ausentes, y nadie los marcaba. La Agenda los avisa arriba («Marcar todos como atendidos», con confirmación) y los resalta en la grilla.
- **Marcas equivocadas:** «Era ausente», «Era atendido» y «Quitar la marca».
- **Cancelados:** ya no desaparecen de la Agenda. Se listan debajo de la grilla, con su ficha.
- **Cancelar pide confirmación** y un motivo opcional. Avisa que el paciente no recibe un mensaje automático.
- **Turno a mano:**
  - Al escribir el celular reconoce al paciente: completa nombre y cobertura y muestra sus próximos turnos.
  - Rechaza celulares sin código de área, porque a esos no les llegan los recordatorios.

**Quedan como propuestas** (en `PENDIENTES.md`): avisar al paciente cuando la clínica cancela o mueve, familias con un mismo celular, sobreturnos y aviso cuando Google pide reconectar.

Código:
- `src/lib/agent/service.ts`: `assertBookable` con `force`, `acceptedCoverage`, `upcomingOf`, `cancelClinicAppointment` y `rescheduleClinicAppointment`.
- `src/app/panel/actions.ts`: `changeAppointmentStatus`, `markDayAttended`, `rescheduleFromPanel` y `lookupPatient`.
- `src/app/panel/(app)/agenda/`: `appointment-actions.tsx` y `slot-picker.tsx`.

Pruebas: 223 en verde, con un caso de integración que recorre todo lo de arriba. Revisado en el navegador en local.

## Sofi comercial · voz y pitch revisados — 24/10/2026

- Pedido posterior: **misma voz de Sofi**, pitch de venta mejorado y cómo disparar pruebas desde el panel. Prevalece sobre el nombre/voz Agustín–Mauricio del registro histórico de abajo.
- Comercial se presenta como **Sofi**; conserva el agente separado `agent_4501m5qvpjwrfcxrafq64zmx0y0q`. «Usar la voz de Sofi y aplicar pitch» lee la voz real de la recepcionista **principal**, no la de la clínica seleccionada en el navegador, y actualiza únicamente el comercial. Voz principal leída por API: `ijxn8I4NzJccD2Sa7lcj` (Turnia · Sol - Warm Publicity). El agente clínico se protege de modificaciones.
- Saludo más corto y sin repetición ante el «sí»; una pregunta de atención de mensajes, beneficio concreto, demo personalizada + charla con Axel. Respeta rechazo/baja, no inventa precios ni datos de la web, no vocaliza acotaciones y busca cerrar antes de 45 s. Sigue límite remoto 60 s más despedida (puede facturar dos minutos Twilio).
- Panel explica mismo número vs número nuevo, ofrece «Abrir ficha y llamar» y accesos directos a contactos, alta y cupo. La ficha propia ya existe; no hay que duplicarla. Reabrir/confirmar para otra prueba; actualizar primero cualquier intento pendiente.
- **Sin llamadas nuevas**, sin recargas. Piloto pausado, cupo US$5 y reserva US$1 conservados; último saldo Twilio US$0,21916. Falta saldo disponible y autorización/destinatarios para otra prueba; el pitch nuevo todavía no se validó por teléfono. No tocar WAHA, HolaVeggie ni herramientas clínicas.
- Validación: **217 pruebas** (15 comerciales), TypeScript, ESLint y build. Migración de nombre/voz en el mismo agente, solo lectura de clínica, pausa y conservación del presupuesto probadas. Uso y antecedentes en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md), que conserva su nombre de archivo histórico.

## Agustín · preparación del piloto comercial — 24/10/2026

- **Actualización posterior:** el usuario autorizó **US$5/día** y una única prueba propia al teléfono terminado en 4245. Se ejecutó **una llamada**, atendida, con Agustín/Mauricio; confirmó que la voz se escuchó bien. **65 s reales**, cierre automático por duración (configurado 60 s + ~5 s de despedida), Twilio **US$0,7056**, ElevenLabs **452 créditos**. Resultado/transcripción en Comercial. Conversación `conv_1901m5qwas11fwbs64wsk8kemn5e`. No hubo uso de herramientas de interés/baja/end_call: validar esas partes en otra prueba autorizada.
- **Estado final vigente:** Twilio mostró **US$0,21916** de saldo compartido tras la prueba, insuficiente para otro minuto al móvil. Piloto **pausado**, cupo **US$5** conservado y **US$1 reservado** por el intento. Sin recargas, sin cambios de planes, WAHA/HolaVeggie intactos y ninguna llamada a prospectos. El usuario deberá resolver saldo y elegir los próximos destinatarios. El permiso nuevo fue una prueba propia puntual, no una autorización para prospectar al mismo teléfono ni repetir automáticamente. Cierre detallado en `COMERCIAL_AGUSTIN.md`.
- **Cierre:** Agustín creado y configurado en producción con la voz **Mauricio**, elegida por el usuario. Agente `agent_4501m5qvpjwrfcxrafq64zmx0y0q`. Panel → Comercial (`/panel/comercial`) publicado (PR #41 + #44). **Pausado / US$0 / ninguna llamada nueva**: el usuario definirá gasto después. Falta autorizar y probar una llamada con Agustín, luego revisar destinatarios del piloto.
- Pedido: vender Turnia a consultorios odontológicos con Agustín. Oferta confirmada: **demo personalizada y después charla con Axel**. Gasto: **preparar todo; definir después**. No autoriza llamadas nuevas.
- Código de **Panel → Comercial**: agente separado, contexto editable por consultorio, revisión de contacto, cupo diario inicialmente cero/pausado, confirmación individual, límite remoto de 60 s, reserva preventiva de US$1 por intento, historial/transcripción y bajas persistidas por teléfono. Sin campañas automáticas. Detalle de uso, costos y límites en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- Herramientas comerciales separadas de las clínicas. Webhook firmado se enruta sin crear pacientes. No se modifican WAHA, el selector Telegram, Sofi ni conexiones/números de otros negocios.
- Pruebas: **213 en verde**, 13 comerciales, typecheck, ESLint y build. Navegador local: guardado, bloqueo con cupo cero y baja. Producción: agente y voz guardados persisten al recargar, pausa y cupo cero; validación previa a llamar pasó contra la API real. Límites remotos: 60 s, concurrencia 1, sin bursting ni cola, 20 conversaciones/día. Análisis predeterminado efectivo `gemini-2.5-flash`. Sofi conserva exactamente su configuración (hash antes/después). Base `ok`, Telegram activo, WhatsApp pausado.
- La creación real expuso dos restricciones de ElevenLabs, **resueltas**: `analysis_llm: gpt-4.1-mini` rechazado con 422 (se hereda el predeterminado), y la voz «Agustin De Angelis - Confident and Happy» rechazada con `400 / voice_live_moderated_not_allowed`. Se agregó selector con validación previa. El usuario eligió **Mauricio**, masculina argentina, sin moderación en vivo y tarifa estándar; se agregó y aplicó únicamente al agente comercial. No se quitó moderación ni se clonó la voz bloqueada. Detalle operativo en `COMERCIAL_AGUSTIN.md`.

## Telefonía saliente con Twilio — 24/10/2026

- Se revisó la cuenta Twilio existente: **Pay-as-you-go**, dos números activos con sus rutas de voz y mensajes hacia Chatwoot. El usuario indicó que HolaVeggie está operativo: **no modificar esos números, agentes, webhooks ni credenciales existentes**. Se comprobó al terminar que las dos líneas y sus URLs originales seguían presentes.
- El usuario verificó por SMS su línea de WhatsApp Business de Turnia como **Verified Caller ID**. No se compró ni portó un número; WhatsApp Business y WAHA no se modificaron. Este identificador sirve para llamadas telefónicas salientes; las llamadas entrantes a la línea siguen en su operador habitual.
- En ElevenLabs se importó **«Turnia · llamadas salientes»**. La pantalla ofrece **Outbound call**; asignar agente entrante está deshabilitado, coherente con un número propio verificado.
- Se creó con autorización una clave **Restricted** «Turnia · ElevenLabs · salientes» con lectura/listado de números e identificadores y lectura/creación de llamadas (seis permisos, sin modificar ni comprar líneas). La importación con esa clave falló con Twilio **8011 / no requested permission**. **La conexión final no usa esa clave restringida**; quedó creada y sin usar para esta conexión.
- El formulario de ElevenLabs exige además el Auth Token de cuenta para importar por API key. Se propuso una subcuenta; el usuario prefirió expresamente continuar con la cuenta existente. La importación final usa **Account SID + Auth Token de esa cuenta**, cargados únicamente en los campos privados de ElevenLabs. **Su alcance es general, no limitado a Turnia.** No se creó subcuenta ni se rotaron credenciales de otros servicios. No copiar valores al repo, chat o logs.
- Vercel / **turniasalud / Production**: agregada `ELEVENLABS_PHONE_NUMBER_ID` y redesplegada la versión actual `c29d1fb` (#32), sin cambios de código. [Despliegue Ready](https://vercel.com/labans-projects-c5c64fdc/turniasalud/98HS96po4c6Fg5PcYvuDhp1NTHQ6).
- Verificación pública después del despliegue: `/api/health` → **`database: "ok"`, `demo.llamada_telefonica: true`, `demo.canal: "telegram"`, `demo.telegram: true`, `demo.whatsapp: false`**. El indicador telefónico confirma configuración, **no una llamada real**. No se cambió el selector de canal.
- Voice Geographic Permissions de Twilio: **Argentina ya estaba habilitada**; consulta de solo lectura, sin cambios.
- **Llamada real validada por el usuario:** la última prueba llegó al teléfono indicado, Sofi se escuchó y hubo conversación de ida y vuelta. El usuario confirmó que **en el celular apareció la línea de Turnia**. ElevenLabs registra **2:11, 21 mensajes, 877 créditos de conversación + 587 de LLM = 1.464 créditos** (LLM mostrado: US$0,12). Twilio registra **2:12, Completed y US$1,0584**; el destinatario cortó. La transcripción termina con `Remote party ended call`. No convertir los créditos a dólares sin verificar el plan. Los cargos de Twilio se redondean: el intento previo de 1 segundo muestra US$0,3528.
- Se hicieron **cinco intentos autorizados** en total: dos desde el botón rápido sin contexto (0 segundos), uno con contexto que sonó pero no fue atendido (confirmado por el usuario), un reintento que se cortó por `clinic_id` vacío (1 segundo, 3 créditos de ElevenLabs) y la prueba corregida exitosa. No se recargó saldo ni cambiaron planes; el saldo de Twilio sigue compartido. **No iniciar más llamadas ni reintentar los lotes de prueba por rutina.** No hubo llamadas a prospectos.
- Diagnóstico de la prueba manual: **Outbound call → Send Test Call** omite el contexto y falla con **`Missing required dynamic variables in first message: {'agent_name', 'clinic_name'}`**. El primer CSV dejó `clinic_id` vacío y falló con **`Missing required dynamic variables in tools: {'clinic_id'}`**. Se corrigió y prevalidó que las nueve variables del prompt y herramientas tuvieran valor, incluyendo el UUID de la clínica demo del seed. El código de Turnia ya envía esas variables en `startPhoneCall`; los errores pertenecieron a la preparación manual. No repetir el botón rápido con este agente.
- La prueba exitosa usó ElevenLabs → Outbound con **un solo destinatario**, contexto técnico explícito y sin usar herramientas clínicas ni crear reservas. Lote `btcal_1801m5qg9j1xfv2t9zete9076ajc`, conversación `conv_9301m5qg9jpwe83sf1146rb4hdh9`. Se aceptaron los términos de comunicaciones salientes con autorización expresa del usuario; un rechazo inicial de aceptación se resolvió al enviar de nuevo, sin crear llamadas duplicadas. No se cambió el prompt, la voz ni la configuración del agente.
- **Límite de la prueba clínica anterior:** validó telefonía y conversación, no ventas, reservas, transferencia ni persistencia de bajas. El guion técnico pedía no usar herramientas clínicas. Hubo una petición de no recibir más llamadas y el agente luego corrigió que no podía registrarla: no reutilizar ese destino para prospección. Posteriormente el usuario pidió expresamente una única prueba comercial propia al mismo teléfono: ver el cierre de Agustín arriba. El intento clínico de colgar mediante herramienta fue abandonado por nueva intervención del usuario; esa llamada terminó cuando este cortó. Antes del piloto comercial real, probar baja persistente y `end_call`.
- El flujo de callback ya existente en `src/lib/demo/session.ts` llama por Twilio solo para sesiones de WhatsApp cuando se elige llamada y hay número configurado. Telegram conserva la llamada web. Esta configuración no agrega una campaña comercial, un control humano por chat ni llamadas nativas de WhatsApp.
- Agente comercial separado **Agustín** ya preparado (ver cierre arriba), conservando la voz de Sofi. Queda pendiente **Tomar / Devolver al agente** para atención humana y la prueba del piloto con gasto/destinatarios autorizados. La voz comercial finalmente elegida es **Mauricio**, porque la primera voz intentada no admite agentes en vivo. El saludo comercial explica identidad de IA y motivo de la llamada.

## /demo con el diseño de /probar-demo — 24/10/2026

- **Pedido del usuario:** que /demo (Panel → Configuración → «Probar por voz o texto en el navegador») se vea igual que la demo de /probar-demo.
- **La conversación ahora es un componente compartido:** `src/components/demo/conversacion-demo.tsx`, con la esfera en `orbe-voz.tsx`. Lo usan las dos páginas.
- **/demo pasó a la web pública** (`src/app/(marketing)/demo/`, misma dirección). Tiene el mismo header y la misma pantalla completa:
  - Arranca en voz con la esfera; el chat queda a un toque.
  - Muestra la ficha de la clínica elegida en el panel.
  - Tiene un campo opcional para probar como un paciente que ya existe, por su celular.
  - Enlaza a la Agenda para ver los turnos que se reservaron.
- Sigue pidiendo la sesión del panel: sin sesión manda al login.

## Agenda como calendario — 24/10/2026

- **Pedido del usuario:** ver la agenda como Google Calendar, con lo completo que está cada día.
- **Vista Semana** (por defecto en la compu): una columna por día y las horas hacia abajo, con cada turno en su horario.
  - Los turnos llevan el color del profesional.
  - El estado se ve en el bloque: confirmado relleno, pendiente punteado, atendido atenuado con ✓, ausente en rojo y tachado.
  - Los turnos superpuestos van lado a lado.
- **Vista Día:** una columna por profesional (hasta 5). En el celular siempre se ve un día, con la semana arriba para elegirlo.
- **Encabezado de cada día:** turnos y **porcentaje de ocupación**, en una barra azul, ámbar desde 50% y roja desde 85%. Sale de los minutos con turno sobre los minutos de atención, sin contar lo bloqueado. También dice «No atiende» o «Bloqueado».
- **En la grilla:**
  - Fuera de horario en gris.
  - Feriados y bloqueos rayados en ámbar, con su motivo.
  - Lo ocupado en Google Calendar rayado en gris, al filtrar por un profesional.
  - Línea roja de la hora actual.
- **Filtro por profesional** con su color.
- **Tocar un turno** abre su ficha a la derecha:
  - Datos, estado y si ya está en Google Calendar.
  - Escribirle por WhatsApp.
  - Atendido, Ausente y Cancelar.
- **Tocar un hueco libre** abre «Agregar turno a mano» con ese día, hora y profesional ya elegidos.
- Código:
  - `src/app/panel/(app)/agenda/page.tsx`
  - `src/app/panel/(app)/agenda/calendar-grid.tsx`
  - `src/lib/agenda-layout.ts` (carriles, ocupación, horas visibles; con pruebas).

## Turno a mano en la Agenda — 24/10/2026

- **Pedido del usuario:** el campo de hora rechazaba casi todo («Ingresá un valor válido»: el selector nativo exigía múltiplos de 5 minutos).
- **Ahora** se elige prestación, profesional y día, y aparecen los **horarios libres** de ese día como botones (mañana y tarde), con el horario de atención del profesional.
  - Ya descuentan turnos, feriados, bloqueos y lo ocupado en Google Calendar.
  - Sin anticipación mínima, a diferencia del agente.
- Flechas para pasar de día. Si ese día no atiende o está completo, lo dice y ofrece el día siguiente.
- «Otro horario» permite escribir la hora: entiende 9:15, 915, 19 hs o 7:30 pm. Si no la entiende, lo dice.
- El botón muestra el turno elegido («Reservar lun 26/10 · 08:40»). Los errores se muestran en palabras del panel, no del agente.
- Código: `freeSlotsOnDay` en `src/lib/agent/service.ts`, `loadDaySlots` en `src/app/panel/actions.ts`, `parseClockTime` en `src/lib/time.ts`, `src/app/panel/(app)/agenda/manual-form.tsx`.
- Pruebas: 202 en verde, con casos nuevos del turno a mano y de la lectura de horas.

## Google Calendar — 24/10/2026

- **Código hecho** con un calendario por profesional, a pedido del usuario. Detalle y pasos en `GOOGLE_CALENDAR.md`.
- **Conexión:** Configuración → Calendario conecta la cuenta de Google de la clínica (OAuth con estado firmado y tokens cifrados). Ahí se elige el calendario de cada profesional.
- **Lectura:** lo ocupado en Google deja de ofrecerse. Al reservar se consulta Google en el momento.
- **Escritura:** cada turno se escribe como evento («Turno: prestación · Nombre I.»), se mueve al reprogramar y se borra al cancelar. Si Google falla, el turno se da igual y el evento se reintenta (`/api/automations/calendario`).
- **Pruebas:** 193 de integración en verde (8 nuevas del calendario con Google simulado) y 4 unitarias.
- **Falta:**
  - Que el usuario cree las credenciales en Google Cloud y las cargue en Vercel.
  - La automatización de reintentos en n8n.
  - Para clínicas reales, la verificación de la app en Google.

## Demo en el navegador a pantalla completa — 24/10/2026

Pedido del usuario: que toda la demo (`/probar-demo/sesion/<token>`) entre en una pantalla, en la computadora y en el celular.

- **Lista para probar:** ocupa exactamente el alto de la pantalla debajo del header (`100dvh - 4.5rem`). Los mensajes se desplazan dentro de la conversación (sin mover la página) y quedan pegados abajo, como en WhatsApp.
  - **Computadora:** ficha y frases de ejemplo a la izquierda (columna de 340 px, con scroll propio si no entra), conversación a la derecha y «Pedí una demo guiada» al lado del título. Alineada con los bordes del header.
  - **Celular:** la ficha pasa a una hoja que sube desde abajo («Lo que leímos de tu web», `<dialog>` nativo: se cierra con Esc, con la X o tocando afuera). Las frases de ejemplo aparecen como botones en la conversación vacía. Apenas empieza la charla, el título se guarda (queda para lectores de pantalla) y la conversación gana lugar. `interactive-widget=resizes-content` solo en esta página: en Android el teclado achica la pantalla y el chat queda entero arriba.
  - **Voz:** botón grande «Llamar a Sofi» en el centro; durante la llamada, abajo, el estado («Te escucho…» / «Sofi está hablando…») y «Cortar». En la columna, las frases pasan a «Decile, por ejemplo» (antes eran botones desactivados).
  - Detalles: «Te queda 1 conversación» en singular; en demos sin web la ficha dice «La ficha de tu consultorio».
- **Mientras se lee la web y avisos:** también entran en una pantalla. En el celular se omite la ilustración del navegador (decorativa) y el detalle de cada paso; en pantallas muy bajas, el dato del estudio.
- **Arranca en voz** (pedido del usuario): «Voz» es la primera opción y la que viene elegida. La llamada tiene una esfera animada al estilo del modo de voz de ChatGPT (`orbe-voz.tsx`): nubes de colores que giran adentro (cian, violeta, rosa y blanco), respira en reposo, gira un anillo al conectar y, en la llamada, sigue el volumen real (el de Sofi cuando habla y el del micrófono cuando escucha, con `getOutputVolume`/`getInputVolume` del SDK). Después de la primera prueba del usuario («reacciona poco») tiene ganancia automática (se ajusta al volumen de cada parlante y micrófono), crece hasta un 28 %, late como una gota, saca ondas en cada golpe de voz y cambia de tono: cian cuando habla Sofi, violeta cuando habla el paciente. Se anima con `requestAnimationFrame` sin re-renderizar React y queda quieta con «reducir movimiento». Su tamaño se ajusta al alto disponible (container query). En la llamada: botón para silenciar el micrófono y «Cortar». Los errores de micrófono salen en castellano y sugieren el chat.
- **Telegram fuera de `/probar-demo`** (pedido del usuario): en el celular solo se ofrece navegador o WhatsApp. El bot de Telegram y el selector de canales del panel no se tocaron.
- **Video del hero con ahorro de batería** (el usuario lo vio quieto en su iPhone, con la batería en modo ahorro): iOS no arranca solo ningún video así, y la home se quedaba en la foto para siempre. Ahora el primer toque en la página lo pone en marcha y los mensajes vuelven a seguirlo (`agente-en-vivo.tsx`). Probado simulando el bloqueo en Chromium: antes, quieto aun después de tocar; ahora arranca con el toque.
- **Header:** a 360 px «Pedí una demo» se partía en dos líneas y el header medía 92 px; ahora queda en una línea y mide 72 px en todos los anchos.
- **Verificado** con el build de producción y la API y el WebSocket de ElevenLabs simulados en Playwright: 1920×1000, 1440×800, 1280×680, tablet 820×1180, celular 412×780, 390×664, 360×640, 360×560, apaisado 740×360 y con teclado (390×380). En todos, la demo termina justo en el borde inferior y sin scroll horizontal. axe sin violaciones (chat, voz y la hoja de la ficha). 188 tests en verde. Falta que el usuario la pruebe en su celular con una conversación real.

## Prospección a consultorios odontológicos — 24/10/2026

- **Base:** 96 consultorios odontológicos de Argentina con web propia (30 A, 41 B, 25 C; 83 con WhatsApp tomado de los botones `wa.me` de su web). Se leyó cada web para puntuar cuánto se va a lucir la demo (texto legible, profesionales, tratamientos), si atiende sábados y si trabaja con obras sociales. Quedaron afuera las webs sin texto legible, franquicias y redes grandes.
- **Canal:** WhatsApp desde el número personal o Business del usuario, de a uno (no el chip de WAHA). Instagram y email para los que no tienen WhatsApp. Seguimiento el lunes de 9:30 a 11.
- **Mensaje:** pregunta según el momento («si hoy sábado a la tarde un paciente les escribe para pedir turno, ¿quién le contesta?»), qué es Sofi y el link `/probar-demo?web=<su web>`. Sin precios ni datos inventados.
- **Tablero:** artefacto privado del usuario con la lista, el botón de WhatsApp con el mensaje armado y el estado de cada consultorio: https://claude.ai/artifact/1NwvGAsbxdtkbGLpRBHyKf . Los datos de contacto no se guardan en el repo.
- **Código:** `/probar-demo?web=` llega con la web escrita y el foco en el email (rama `claude/determined-turing-ota3pm`). Para medir: Panel → Pedidos de demo muestra la web y el email de cada uno que probó.

## Crítica de diseño de la home y /probar-demo, y demo en el navegador — 24/10/2026

- **Crítica** con `impeccable critique` (sin subagentes ni detector, aclarado en el informe): 21/32. Copia en `.impeccable/critique/2026-10-24-home-y-probar-demo.md`.
- **Arreglado:**
  - Las ★★★★★ del hero se sacaron y, a pedido del usuario, volvieron como estaban.
  - «Probalo ahora» y «Probá el agente» llevaban a `/demo`, que pide sesión del panel: un visitante veía «Ingresá al panel». Ahora todos van a `/probar-demo`. La banda final queda con «Probalo con tu web» y «Pedí una demo guiada», en azul, y no aparece en `/probar-demo`.
  - «Ver todas las especialidades» abre el índice nuevo `/especialidades` (antes, Clínica médica).
  - La tarjeta oscura del motor ya no repite las especialidades: muestra lo que el agente recuerda de cada paciente. «9 acciones sobre la agenda» pasó a «3 canales».
  - «Conectado a los canales» sin jerga (Postgres, SIP, n8n, webhooks, ElevenLabs); Google Calendar figura como «Próximamente» porque todavía no está.
  - El texto de pediatría ya no dice «una mamá» sobre la foto de un papá.
- **«Lo que dicen los números»** (como «Real Results» de Assort): 24/7 propio y tres números de estudios publicados, cada uno con su enlace:
  - 23 % de ausentismo promedio (Dantas y otros, Health Policy, 2018).
  - 29,5 % de los turnos autogestionados se piden fuera de horario (North y otros, JMIR Medical Informatics, 2021).
  - −29 % de ausencias con recordatorios automáticos (Hasvold y Wootton, J Telemed Telecare, 2011).

  Los números de la captura de Assort son de sus clientes, no de la industria: no se usaron.
- **`/probar-demo` en el navegador** (pedido del usuario): web + email; en computadora directo al navegador, en celular elige navegador o Telegram. Detalle en `PLAN_LEAD_MAGNET.md`. La página tiene los tres pasos y un ejemplo de conversación.
- Pruebas: 184 en verde (7 nuevas de la demo en el navegador). axe en las páginas nuevas: solo los bordes decorativos de la rueda.
- **Verificado en producción:** demo en el navegador de punta a punta (lectura con Claude en 15 s, chat con Sofi y voz). El primer mensaje del chat no se mandaba; se arregló en el PR #30 y se volvió a probar. Interesado de prueba: `prueba-claude@turnia.test`.

## Skills de diseño y auditoría de accesibilidad — 24/10/2026

- **Skills instaladas en `.claude/skills`** (con el OK del usuario): `frontend-design` (Anthropic), `web-design-guidelines` y `react-best-practices` (Vercel) e `impeccable` (pbakaus). Origen, commit, licencia y cambios en `.claude/skills/README.md`. `impeccable` va sin `scripts/` (su lanzador baja y ejecuta un binario); `web-design-guidelines` lee una copia local de las reglas.
- **Auditoría con axe-core** (WCAG 2.2 AA + buenas prácticas) en 27 páginas, escritorio 1366 y celular 390, con la web y el panel corriendo sobre el build de producción: **512 problemas antes, 6 después**. Los 6 que quedan son el desvanecido de los bordes de la rueda «Simplificá cada paso» (decorativo: `aria-hidden` y fuera del orden de tabulación).
- **Contraste:** los grises de texto (`brand-900/50`, `/55`, `/45`…, `brand-950/40`…) pasaron a `/65`; `tinta/70-80` a `tinta`; títulos del menú del panel a `brand-200/75`. Tokens nuevos `emerald-700` y `sun-700` para texto verde y naranja (`sun-600` y `emerald` no llegan a 4,5:1). Las tarjetas verdes y naranjas de la home y de producto usan texto oscuro.
- **Otros:** puntos de la banda 24/7 con área táctil de 32 px; la banda, el carrusel de destacados y la rueda se pausan con foco de teclado (antes solo con el mouse); `transition-all` reemplazado por propiedades explícitas; selector de clínica del panel con rótulo en celular; orden de títulos corregido en el formulario de demo y en «Escuchá a nuestros agentes»; foco visible en el campo de `/probar-demo`.
- **Arreglo chico:** el reproductor ya no pide `/audios/<slug>.json` (404) antes de `/api/audios`. `next.config.ts` anota al compilar qué audios hay en `public/audios`, que siguen teniendo prioridad.
- **Verificado en producción** (PR #27, 24/10): home, `/probar-demo`, «Escuchá a nuestros agentes», odontología, «Pedí una demo» y login del panel, en 1366 y 390. Sin errores 4xx (el 404 de audios desapareció) y axe solo marca los bordes decorativos de la rueda en la home.

## Guardar prestación y profesional — 23/10/2026

- «Guardar prestación» y «Guardar profesional» no avisaban nada: si un dato era inválido (precio con letras, duración fuera de 5–480, nombre vacío) se descartaba en silencio y parecía que no guardaba. Ahora cada edición responde «Prestación guardada ✓» / «Profesional guardado ✓» y se cierra, o muestra el error exacto sin perder lo escrito. Si la clínica elegida cambió en otra pestaña, también lo avisa ahí mismo.
- Probado en navegador (precio inválido → error y valores intactos; precio válido → guardado, se cierra y persiste al recargar) y con test de integración.
- Si alguien tenía el panel abierto durante un deploy, conviene recargar una vez.

## Home: video del hero y llamada en una pantalla — 23/10/2026

- **Video del hero publicado** (`public/videos/`): cuatro clips de Mixkit con licencia libre para uso comercial, uno por mensaje del agente, con fundido entre personas. Hay versión de escritorio (mp4 y webm, 1080p, ~4 y ~2 MB), un recorte vertical para el celular y un póster con el primer cuadro. No se usó el video de Assort (tiene derechos). Detalle de los clips y cómo reemplazarlos en [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md).
- **Celular igual que Assort**: el hero ocupa toda la pantalla, con la cara arriba y el texto abajo sobre un velo que oscurece hacia abajo. La barra queda transparente sobre el video, con el logo en blanco y solo el menú; al bajar vuelve a la barra blanca con «Pedí una demo». El menú del celular suma «Probá la demo con tu web» y «Pedí una demo». Revisado en 390×844 y 375×667.
- **Mensajes sincronizados** con cada persona (0,3 / 7,7 / 15,1 / 22,5 s, en `agente-en-vivo.tsx`). Con «reducir movimiento», el video queda quieto y los mensajes rotan solos.
- **«Escuchá a Sofi en acción»** (variante `escena`, datos en `src/content/escena-home.ts`): Sofi a la izquierda con su objetivo, el paciente a la derecha con los datos que detecta el agente, el orbe al centro y el texto al ritmo del audio real. «Miralo en acción» baja directo a la tarjeta (`#llamada`), que entra completa en la pantalla: medido en 1440×900, 1366×650, 1280×720, 1024×700 y 390×844. Audio comprobado en producción.
- **Skew Protection de Vercel**: no está disponible en el plan actual (Hobby) y no hace falta contratarlo. El panel ya cubre el caso: `deploymentId`, aviso «Hay una versión nueva del panel» con recarga y borrador recuperado.

## Límite de demos por persona — 23/10/2026

- El mensaje «Ya probaste varias demos hoy» salía al llegar a 3 demos por persona por día; ese tope estaba fijo en el código. Ahora se ajusta en **Panel → Sistema → Demo con tu web → «Demos por persona por día»**. Por defecto no hay límite (0), así que se desbloqueó apenas se publicó. Cada demo lee una web y usa créditos de Claude: si la landing recibe abusos, poner un tope (por ejemplo, 5).
- El freno del formulario público subió de 10 a 30 enlaces por origen por hora y sigue el tope global de 1000 por hora. Los enlaces de «Probar este perfil» no cuentan.

## Direcciones mal escritas y verificación del guardado — 23/10/2026

- `/panel/clinica` (en singular) daba el 404 negro de Next. Ahora las variantes habituales redirigen a la sección correcta: `clinica`, `demo`, `paciente`, `conversacion`, `chats`, `tarea`, `campana`, `config`, `inicio`, con o sin tilde. Las direcciones inexistentes muestran una página propia con «Ir al panel». Después del login, `next` solo acepta secciones reales; si no, va a Inicio.
- **Guardado verificado contra el build de producción** (`next start`). Se completaron los 14 campos de las reglas más zona horaria y coberturas (quitar y agregar), se guardó en ~0,1 s, se recargó y cada valor persistió. La web se guarda normalizada, con «/» final. También persistieron: editar profesional, quitar horario, desactivar/activar, editar precio y duración, quitar bloqueo y el historial de cada sección. El recorrido completo de 31 comprobaciones también pasó sobre ese build.

## Segunda auditoría del panel — 23/10/2026

- **Seguridad**
  - Las sesiones de administrador quedan atadas a `PANEL_PASSWORD`: al cambiarla en Vercel se cierran todas las sesiones abiertas con la anterior. Antes seguían valiendo hasta 14 días. Este deploy pide volver a ingresar una vez. Las sesiones de los consultorios no se ven afectadas: esas se cortan con «Revocar».
  - Login y cierre de sesión rechazan formularios enviados desde otro sitio (verificación de Origin).
  - El proxy manda a Inicio, sin cargar la página, al consultorio que intenta abrir Clínicas, Pedidos de demo o Sistema. La página igual lo verifica.
  - Al salir se borran los borradores guardados en el navegador.
- **Experiencia**
  - Cada página del panel tiene su título de pestaña.
  - Esqueleto de carga al navegar.
  - Login con «Mostrar» y una ayuda para el código del consultorio.
  - El código se puede mandar por WhatsApp con un mensaje listo.
  - Bienvenida al consultorio en Configuración, sin la etiqueta interna «Demo conservada».
  - Cambiar de clínica conserva la pestaña.
  - En el celular, la pestaña activa queda a la vista.
  - Textos de «Lectura de la web» sin jerga interna.
- **Validación**
  - 175 pruebas (incluye las del proxy, Origin y contraseña rotada), TypeScript, lint y build.
  - Recorrido completo en Chromium con 31 comprobaciones, como administrador en escritorio y como consultorio en celular, dos veces seguidas y sin errores de página. Cubre crear clínica, completar la ficha al 100 %, equipo, prestaciones, bloqueos con error y con éxito, turno manual, código y WhatsApp, cambio de clínica, Sistema, Tareas, ingreso del consultorio, bloqueo de secciones, cierre de sesión y el historial visto por el administrador.
- **Pendiente del usuario** (no se puede hacer desde el código):
  - ~~activar Skew Protection~~: no disponible en el plan Hobby; queda cubierto por el aviso de versión nueva;
  - rotar las credenciales que quedaron expuestas en el diagnóstico de WAHA (ver la sección del 23/10).

## Auditoría del panel: arreglos — 23/10/2026

Hecho por prioridad después de auditar el flujo completo (código y navegador):
1. **No se pierde lo escrito.** Antes, si guardar fallaba (web o zona horaria mal escritas), React vaciaba el formulario. Los formularios del panel se envían ahora sin ese reseteo automático. Las reglas, además, guardan un **borrador en el navegador**: después de una recarga, un corte o un deploy, se ofrece «Recuperarlos». El borrador queda atado a la revisión de la ficha y no pisa cambios guardados por otra persona.
2. **El agente toma los cambios en la charla abierta.** Cada conversación guarda la revisión de la ficha con la que empezó (`channel_conversations.context_revision`). Si la ficha cambia, el próximo mensaje arranca una conversación nueva de ElevenLabs con los datos actuales y un resumen de lo último que se habló. Ya no hace falta esperar 15 minutos ni escribir MENU.
3. **Deploys.** `deploymentId` usa `VERCEL_DEPLOYMENT_ID`: una pestaña vieja se recarga al navegar. Si una acción quedó desfasada, el panel muestra «Hay una versión nueva del panel» con un botón para recargar, y el borrador se recupera. *Skew Protection* requiere plan Pro de Vercel; con Hobby no se activa y no se contrata.
4. Cambiar de clínica en el selector con cambios sin guardar ahora pide confirmación.
5. Login con límite: 10 intentos fallidos por origen cada 15 minutos (`login_failures`, solo hash del origen). Si la base no responde, no bloquea.
6. **Ficha completa al X %** en Inicio y en Reglas, con lo que falta y un enlace a cada dato. El consultorio que entra con su código va directo a Configuración.
7. En el celular, «Ficha completa» y «Probar el agente» quedan antes del formulario. Después de guardar, la barra ofrece «Probar los cambios».
8. **Historial de cambios** (`clinic_changes`): quién (Turnia o el nombre del acceso del consultorio), qué sección y cuándo. Se ve en Reglas («Últimos cambios») y en Clínicas («Última edición»).
- Menores:
  - zona horaria como lista;
  - coberturas como etiquetas;
  - Tareas con pestañas Pendientes/Resueltas y «Resolver sin respuesta» diferenciado;
  - campañas deshabilitadas con aviso en las demos;
  - sin emojis en el panel;
  - sesión y clínica leídas una vez por página.
- Validación: 171 pruebas, TypeScript, lint y build. Recorrido en Chromium de cada arreglo, sin errores de página.

## Rediseño del panel y acceso propio del consultorio — 23/10/2026

- **Login sin 404** ([PR #18](https://github.com/axellaban/turniasalud/pull/18), en producción): el login y el cierre de sesión son formularios comunes hacia `/api/panel/login` y `/api/panel/logout`, no Server Actions. Una pestaña abierta antes de un deploy ya no termina en 404. Con la sesión vigente, `/panel/login?next=…` lleva directo al destino. Link fijo: `https://turniasalud.vercel.app/panel/login?next=/panel/clinicas`.
- **Acceso del consultorio**: en Configuración → Reglas del consultorio, el administrador crea un código (formato `XXXX-XXXX-XXXX-XXXX`) para la clínica seleccionada. Se muestra una sola vez; en la base se guarda solo su hash (`clinic_access`). El consultorio entra en el mismo login con ese código y **solo ve y edita su clínica**. No ve Clínicas, Pedidos de demo ni Sistema, no cambia el canal, no crea agentes ni borra fichas. «Revocar» lo corta en el acto. Borrar la clínica borra sus accesos. Las sesiones de administrador existentes siguen valiendo.
- **Navegación**: barra lateral agrupada en «Consultorio» y «Turnia» (solo administrador). En el celular, barra inferior con Inicio, Agenda, Chats, Tareas y «Más». El selector de clínica del encabezado cambia al elegir y se queda en la misma sección.
- **Configuración en pestañas**: Reglas del consultorio · Equipo y horarios · Prestaciones · Feriados y bloqueos · Lectura de la web. Las reglas tienen una barra fija de guardado que avisa si hay cambios sin guardar y pide confirmación antes de salir. Lo técnico (canal, Telegram, agente de ElevenLabs, WAHA, URLs, audios de la web y estado) pasó a **[Panel → Sistema](https://turniasalud.vercel.app/panel/sistema)**, solo administrador.
- **Otras pantallas**:
  - Inicio muestra primero lo de hoy, y la puesta en marcha técnica solo al administrador. Los porcentajes con menos de 5 casos se muestran como «—».
  - La Agenda tiene una franja semanal con la cantidad de turnos por día y el turno manual plegado.
  - Clínicas es una lista compacta con filtros Todas / Conservadas / Temporales.
  - Prestaciones es una lista con precio y edición en el lugar.
  - Horarios se ven en una grilla semanal.
- Validación local: **170 pruebas**, TypeScript, lint y build correctos. Recorrido en Chromium con escritorio (1440 px) y celular (390 px), sin errores ni desborde horizontal: cambio de clínica, aviso de cambios sin guardar, guardado, creación del código, ingreso como consultorio, bloqueo de las secciones del administrador y revocación.

## Borrado de fichas y enlaces de perfil de 7 días — 23/10/2026

- `/panel/clinicas`: cada ficha de demo tiene «Borrar ficha» (con confirmación; borra agenda de prueba, pacientes, conversaciones y lecturas). «Borrar demos temporales» elimina todas las demos sin conservar; la principal nunca se puede borrar. Si la ficha borrada estaba seleccionada, el panel vuelve a la principal.
- «Probar este perfil» genera un enlace que vale **7 días** y se puede usar varias veces, desde cualquier chat. Antes vencía a los 15 minutos y quedaba atado al primer chat que lo usaba. La migración extiende a 7 días desde su creación los enlaces de perfil ya emitidos. La limpieza de enlaces de la landing ya no borra enlaces de perfil vigentes.


- Implementado `/panel/clinicas`: listado, búsqueda, creación manual y selector de clínica. Configuración, agenda, pacientes, conversaciones y tareas consultan la clínica seleccionada; los webhooks siguen resolviendo su clínica sin usar la selección del administrador.
- Configuración permite editar el contexto completo de cada ficha: identidad, dirección, web, zona horaria, horarios, coberturas, FAQ, políticas, urgencias, fuera de horario, derivación, formas de pago e instrucciones adicionales. También profesionales, prestaciones, precios, indicaciones, horarios y bloqueos. Las conexiones generales se administran desde la clínica principal; guardar contexto no modifica proveedor, claves, número, voz ni templates.
- Guardar, conservar, leer la web o preparar una prueba protege el perfil de la limpieza de demos de siete días (`retained_at`). Conserva `is_demo`: su agenda sigue siendo simulada y no envía avisos ni campañas a pacientes.
- Las nuevas extracciones guardan en Neon `clinic_imports`: URL, fecha, texto por página y ficha estructurada. Las demos anteriores conservan su ficha pero no tienen archivado el texto original. Se puede leer su web ahora para guardar una nueva referencia; no presentarla como la lectura histórica.
- «Leer web y revisar propuesta» guarda una propuesta sin sobrescribir contexto. Cada campo se aplica por selección explícita; el reemplazo opcional de catálogo desactiva el anterior y conserva turnos e historial. Una revisión desactualizada o de otra clínica se rechaza. Límite de tres lecturas por clínica/hora.
- «Probar este perfil» genera un enlace (hoy de 7 días, ver arriba) al canal habilitado para usar la misma clínica y sus correcciones, sin re-scrapear ni crear otra ficha. Telegram requiere tocar Start. La llamada privada de `/demo` también usa el perfil seleccionado y el agente compartido, sin crear agentes en ElevenLabs. Desde la auditoría del 23/10 el agente toma el contexto editado en el próximo mensaje.
- Validación local: **161 pruebas**, TypeScript, lint y build correctos con Node 24 y Postgres descartable; APIs externas simuladas. Revisión con Chrome: guardar y recargar, cambiar entre clínicas, aplicar solo dirección y conservar pagos/instrucciones manuales. Migración aditiva en el build de producción; sin `seed.sql`.
- WAHA, su sesión y servicio, credenciales, webhook y despliegue no se modificaron. Telegram sigue seleccionado. n8n continúa despublicado; Gmail y campañas siguen pospuestos. No se regeneraron audios ni se modificó ElevenLabs ni planes.
- Publicado por [PR #14](https://github.com/axellaban/turniasalud/pull/14), merge `a8d64bd`. CI y Vercel aprobados; producción [7AGU3CRKJpf4jdT8g9Xd6H3JMuM1](https://vercel.com/labans-projects-c5c64fdc/turniasalud/7AGU3CRKJpf4jdT8g9Xd6H3JMuM1). Comprobación real: panel autenticado con Clínicas y selector, `/api/health` 200 con `database: "ok"`, cuatro fichas y canal Telegram; webhooks WAHA/ElevenLabs sin firma 401.
- En producción se conservó **Guerra–Mininni creado el 23/10 a las 16:22 Argentina**, asociado a la última prueba de audio y llamada. Se guardó una nueva lectura de **1 página a las 16:42**: texto/fuente visibles y propuesta pendiente, sin aplicar datos ni reemplazar catálogo. «Probar este perfil» generó correctamente un enlace a @TurnIA_salud_bot, sin iniciar mensajes. Para probar ahora, generar uno nuevo desde ese botón (vence en 15 minutos).
- Hay tres fichas homónimas de Guerra–Mininni provenientes de pruebas anteriores: no se borraron ni fusionaron. Selector y listado muestran fecha de creación y referencia corta para distinguirlas; la ficha conservada es la de 16:22. Al abrirla desde Pedidos de demo se sincroniza la selección visible. Completar manualmente horarios reales, coberturas, políticas y pagos que la web no publica; no inventarlos ni tratar la agenda simulada como disponibilidad real.
- El servidor y Postgres locales de prueba quedaron detenidos. El recorrido de reutilizar una ficha y sus correcciones se probó con proveedores simulados; el enlace real quedó preparado, y la prueba conversacional humana de **ese nuevo enlace** queda disponible para el usuario. Las pruebas previas de audio y llamada por Telegram ya estaban confirmadas.

## Canales y demo con Telegram — 23/10/2026

**Este bloque prevalece sobre todo el registro histórico que sigue.** El usuario resolvió WAHA por su cuenta y confirmó que funciona. Instrucción expresa: **dejar WAHA exactamente como está**; no cambiar motor, imagen, sesión, credenciales, webhook, conexión ni despliegue. La imagen derivada de la rama histórica `codex/waha-qr-refresh` no es la configuración actual y no se debe desplegar.

- La integración conversacional real es **WAHA → Turnia en Vercel → Custom Channel de ElevenLabs → Turnia → WAHA**. n8n solo recibe eventos de aviso. Despublicar n8n no pausa al bot.
- Pausa urgente inicial: dos reglas temporales Deny en Vercel (`/api/waha/webhook` y `/api/elevenlabs/canal`). **Ambas ya están desactivadas y publicadas**, porque la pausa ahora la controla el selector del código. Las rutas responden 401 sin firma; no hay que reactivarlas para operar. No se modificó WAHA ni otras reglas de seguridad.
- Objetivo confirmado: `/probar-demo` recibe la web del interesado, abre el canal elegido, lee esa web, arma una clínica temporal y permite chat, notas de voz de ElevenLabs o llamada. Para Telegram la llamada es mediante el enlace web existente; la API de bots no inicia llamadas nativas.
- Bot elegido por el usuario: **@TurnIA_salud_bot**. Confirmó que guardó `TELEGRAM_BOT_TOKEN` como Secret de Production en Vercel y realizó un redeploy. No se copió su valor al chat, repositorio ni entorno local.
- Código integrado en `main`: [PR #12](https://github.com/axellaban/turniasalud/pull/12), merge `9a86c7e`. **146 pruebas correctas** con Postgres local descartable y también CI con Postgres 16; TypeScript, lint y build correctos, servicios externos simulados. Incluye: selector **Pausado / Telegram / WhatsApp** en Panel → Configuración, adaptador de Telegram, webhook autenticado, enlace `/start` con token opaco para asociar la web, mismo agente y TTS/STT de ElevenLabs. La nueva tabla `messaging_settings` comienza en **pausado**. Cambiar de canal termina las demos previas y descarta respuestas pendientes mediante una revisión persistida.
- Producción [81bacckz7sk8br9SwHfFgiT7rG37](https://vercel.com/labans-projects-c5c64fdc/turniasalud/81bacckz7sk8br9SwHfFgiT7rG37), **Ready / Production / Current**. La migración creó las tablas y arrancó en Pausado. Después de la autorización específica del usuario, se conectó el bot desde el panel y se guardó **Telegram**. Telegram confirmó el webhook y el panel conservó la elección tras recargar.
- Comprobación HTTP: `/api/health` devuelve 200, `database: "ok"`, `demo.canal: "telegram"`, `demo.telegram: true`, `demo.base: true`, `demo.whatsapp: false`. Esta última significa WhatsApp pausado; **no indica que WAHA perdió la conexión**. No se consultó ni cambió la sesión de WAHA en esta implementación.
- **Uso cotidiano:** [Panel → Sistema](https://turniasalud.vercel.app/panel/sistema) (antes en Configuración), tarjeta «Canal de la demo y del agente» → elegir Pausado / Telegram / WhatsApp → **Guardar canal**. No requiere redeploy, cambio de webhook de WAHA, n8n ni nueva credencial. Cambiar termina las demos anteriores; arrancar otra desde la landing.
- Bot conectado con `getMe` + `setWebhook` + comprobación `getWebhookInfo`: solo acepta @TurnIA_salud_bot y rechaza sobrescribir otro webhook. El token permanece en Vercel; el webhook valida un secreto derivado exclusivo. Solo admite chats privados. No se borró la cola de Telegram.
- La landing se verificó en producción: ingresada la URL elegida por el usuario, «Probar demo» abrió `t.me/TurnIA_salud_bot?start=…`, con token opaco válido por 15 minutos. **Telegram exige tocar Iniciar / Start desde la cuenta del usuario**; no es un borrador de WhatsApp. El enlace debe generarse otra vez desde la landing si vence.
- El workflow [Turnia · Eventos (avisos al equipo)](https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q) permanece despublicado, sin nodos modificados, ejecuciones ni envíos. Gmail, campañas y destinatarios asistenciales siguen pendientes por elección del usuario.
- Web elegida para probar: **Consultorio Odontológico Dr. Guerra y Dr. Mininni**, `https://lab-orpin-five.vercel.app/consultorio/`. Lectura visual comprobada: Aráoz 2879, 1° D, Buenos Aires; odontología integral, rehabilitación oral, operatoria y mantenimiento periodontal; equipo Guerra, Mininni, Coldeira y Fernández. No se envió nada a los contactos de esa web.
- **Prueba real ya observada en el panel:** demo iniciada 23/10 a las 15:32 Argentina, leyó **1 página**, armó «Consultorio Odontológico Dr. Guerra y Dr. Mininni», usuario eligió **audio**. A las 15:33 se registró una nota de voz entrante transcripta y una respuesta del agente al pedido de turno de prueba con el Dr. Guerra. Esto confirma entrada Telegram, lectura de la web, perfil/clínica temporal, STT, Custom Channel y callback real del agente. No se contactó a la clínica real.
- **Validación humana confirmada el 23/10:** el usuario confirmó que el bot ofreció las tres opciones y que la respuesta llegó como **nota de voz de Sofi y se escucha bien**. Queda validado en producción el recorrido landing → Telegram → lectura de la web → selección de audio → transcripción → agente → voz de ElevenLabs → Telegram.
- **Llamada web confirmada el 23/10:** el usuario probó la opción de llamada y confirmó que funciona.
- **Pruebas reales pendientes:** información de la web (dirección/tratamientos/equipo), MENU → chat y SALIR. La reserva sigue probada solo con proveedores simulados; usar datos ficticios en la prueba real. Registro en [Pedidos de demo](https://turniasalud.vercel.app/panel/demos?q=Telegram). El filtro por el dominio deja de encontrar la demo cuando la organización se actualiza al nombre de la clínica; usar Telegram o Guerra. WhatsApp permanece pausado y la conexión de WAHA se conserva.
- No regenerar los siete audios de la web ni modificar permisos/voces de ElevenLabs. No contratar planes. El servicio Postgres local usado en las pruebas quedó detenido.

## Diagnóstico histórico de vinculación WAHA del 23/10 (superado por la configuración del usuario)

- El usuario ya tiene la línea activada en WhatsApp Business en un iPhone. Confirmó que puede vincularla con WhatsApp Web oficial, pero WAHA muestra en el teléfono «no se pueden vincular dispositivos en este momento». Hay dos dispositivos vinculados y el rechazo de WEBJS fue inmediato. No hay evidencia suficiente para atribuirlo a una cuenta nueva, una prohibición o un passkey.
- Se trabajó únicamente sobre **`n8n/turnia-waha`**. No se modificaron `n8n/waha`, amoblaia, Supabase, ElevenLabs ni los audios. No se enviaron mensajes ni se contrataron planes.
- Se probó NOWEB con `WAHA_NOWEB_WA_VERSION=auto-web` y se comprobó en registros que tomó una versión más reciente. El iPhone rechazó QR y código, incluido un código solicitado con formato internacional correcto. GOWS 2026.9.2 tampoco se vinculó. Su registro mostró `Event=timeout`, `Error=null`, sin un motivo específico de rechazo ni desafío de passkey. Se comprobó por hash que el QR del dashboard coincidía con el de la API; eso no equivale a una vinculación.
- Motor actual **WEBJS**, basado en la imagen oficial WAHA 2026.9.2 CORE con Chromium. Límites actuales: **0,5 CPU / 768 MB** dentro del mismo VPS; se amplió solamente el límite de memoria de Turnia desde 512 MB. Se conservaron dominio, almacenamiento, webhook y valores privados existentes. No se observaron reinicios ni `OOMKilled` en las comprobaciones efectuadas.
- **Error real encontrado en WEBJS:** `TypeError: window.require(...).Cmd.refreshQR is not a function`. La captura de Chromium mostraba «Select to reload QR code» mientras el dashboard aún decía `SCAN_QR_CODE`. No pedir escaneos basándose solo en ese estado.
- Se creó y desplegó una imagen derivada con un cambio puntual de esa llamada al método `WAWebLaunchSocketUtils.refreshQR`, que la propia biblioteca instalada ya usa en otro flujo. [Dockerfile y comprobaciones](infra/waha/Dockerfile), [explicación y operación](infra/waha/README.md). El contenedor desplegado confirmó cero llamadas antiguas y dos al método nuevo; el build incluye comprobación de sintaxis. Después del despliegue hubo un timeout al esperar el estado inicial; se cerró el intento nunca vinculado y se reinició únicamente `default` para probar desde un perfil limpio. La API empezó a entregar QR diferentes y no reapareció el error de refresco en los registros nuevos revisados.
- **Segundo hallazgo:** el PNG del diálogo abierto del dashboard no coincidía con el PNG actual de la API. Al tocar el botón de actualización junto a «QR» se comprobó que ambos hashes coincidían. El diálogo abierto puede conservar una referencia anterior: actualizarlo antes de pedir un escaneo y mantenerlo vigente durante la prueba.
- En el intento con la imagen actualizada, el usuario informó que el iPhone pasó a **«Iniciando sesión»**. A las **12:44:50 Argentina**, WAHA registró cierre de sesión y desconexión, con motivo **`LOGOUT`**, y cerró Chromium. La API confirmó **`FAILED`, sin cuenta vinculada**. Se pidió al usuario el resultado final en el teléfono y que no repitiera el escaneo. No afirmar que el canal quedó conectado.
- Última comprobación de producción: `database: "ok"`, `configured.waha: true`, `demo.base: true`, `demo.claude: true`, **`demo.whatsapp: false`**. Ningún motor llegó a `WORKING`; la demo completa y el intercambio real de mensajes siguen pendientes.
- **Credenciales:** durante el diagnóstico se mostraron accidentalmente valores privados en salidas de herramientas. No están en este repositorio. Deben rotarse en los servicios correspondientes y sus destinos privados al cerrar la configuración, con intervención del usuario para el cambio de credenciales. No volver a emitir el entorno completo, ni incluir claves en capturas, documentación o chat.
- Gmail y campañas siguen pospuestos. No regenerar audios ni cambiar ElevenLabs sin que el usuario lo retome.

## Actualización posterior del 22/10: infraestructura WAHA y Custom Channel preparados

Este bloque prevalece sobre las comprobaciones anteriores de esta misma fecha:
- El usuario cargó la clave de Anthropic en Vercel. Comprobado `/api/health`: `database: "ok"`, `demo.base: true`, `demo.claude: true`, `demo.whatsapp: false`. La presencia de la variable no confirma todavía una extracción real con Claude.
- Speech to Text habilitado y guardado en la clave existente «Turnia Salud · Vercel», después de la confirmación explícita del usuario. ElevenLabs mostró «API key updated successfully» y, al reabrir la clave, Speech to Text → Access seguía seleccionado. Text to Speech y los demás permisos no se cambiaron; límite de 25.000 créditos conservado.
- El usuario todavía no puso el teléfono de Turnia. Se puede preparar la infraestructura; la vinculación y prueba de WhatsApp requieren el QR y ese celular.
- WAHA existente: Easypanel confirma `n8n/waha`, habilitado, imagen `devlikeapro/waha:noweb`, con almacenamiento persistente. Esto no confirma que una sesión esté conectada. No se modificó ese servicio ni se copiaron sus credenciales a otro proyecto.
- Easypanel rechazó crear otro proyecto con `You are not allowed to create more projects`. Después de la **autorización explícita del usuario**, se creó únicamente `n8n/turnia-waha`, con imagen `devlikeapro/waha:noweb`, volúmenes propios `/app/.sessions` y `/app/files`, claves nuevas y límites de **0,5 CPU / 512 MB**. No se modificaron los otros servicios. Verificados límites y 1 contenedor activo de 1 esperado.
- Servicio exclusivo: `https://n8n-turnia-waha.b6mgbu.easypanel.host`. Sesión `default`, motor NOWEB, inicio automático y webhook global de evento `message` a `https://turniasalud.vercel.app/api/waha/webhook`, con HMAC y reintentos. La API autenticada respondió 200. Sin teléfono, se encontró `FAILED`; un reinicio exclusivo de esta sesión la llevó a **`SCAN_QR_CODE`**, sin `me.id`. Esto comprueba que puede pedir vinculación, **no que WhatsApp esté conectado**. Si vence el QR, reiniciar esa sesión cuando el usuario tenga el teléfono listo.
- Custom Channel de ElevenLabs: conexión **«Turnia · WhatsApp WAHA»** y trigger **User message** creados con confirmación explícita. Reply Webhook URL: `https://turniasalud.vercel.app/api/elevenlabs/canal`. Las tres credenciales generadas se cargaron directamente en Vercel como secretos de Production.
- Vercel: guardadas `WAHA_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC`, `WAHA_SESSION=default`, `ELEVENLABS_CHANNEL_URL`, `ELEVENLABS_CHANNEL_SECRET` y `ELEVENLABS_CHANNEL_SIGNING_SECRET`, todas como secretos de Production. [Redeploy comprobado Ready](https://vercel.com/labans-projects-c5c64fdc/turniasalud/5LeKt2uu348Lem2R4SzrqYoRAvFm). Panel → Configuración: proveedor WAHA guardado y persistencia comprobada al recargar; seis variables obligatorias en verde.
- Verificación después del deploy: `/api/health` → `database: "ok"`, `configured.waha: true`, `demo.base: true`, `demo.claude: true`, `demo.whatsapp: false`. Un evento sintético `session.status`, que el receptor ignora sin enviar mensajes, respondió 200 con HMAC correcto y 401 «Firma inválida» sin firma. No se probó todavía una entrega real de mensajes desde WAHA ni una respuesta de ElevenLabs.
- Para retomar: colocar el chip y activar WhatsApp en el celular, abrir el dashboard del **nuevo** servicio, entrar con los campos `WAHA_DASHBOARD_USERNAME` / `WAHA_DASHBOARD_PASSWORD` de **n8n/turnia-waha → Environment** y vincular `default` con el QR. La clave de API está en `WAHA_API_KEY`, en ese mismo servicio; no usar las credenciales de `n8n/waha` ni pegarlas en chat. Luego verificar `WORKING`, `demo.whatsapp: true` y el recorrido completo del lead magnet.
- El navegador no pudo observar la pestaña de error de la URL de WAHA: su política de seguridad rechazó el acceso. No se intentó eludir el bloqueo con otro navegador ni con peticiones directas a ese servicio. La revisión de configuración se hizo mediante el conector de Easypanel.
- Gmail y campañas siguen pospuestos. No se enviaron mensajes ni se contrataron planes.

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

## Trabajo autónomo del 22/10: lead magnet

Se reforzó el código de `/probar-demo`: lector con DNS fijo y límites reales de bytes/tiempo, cuota y creación de demos bajo transacción, reintentos idempotentes, análisis único, cancelación sin clínicas huérfanas, máximo de tres llamadas por demo y cierre de la captura temporal del micrófono. Los textos aclaran que las conversaciones y la agenda son simuladas. Detalle, benchmark de cuatro webs y verificación en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md#revisión-y-endurecimiento-del-22102026).

Verificación local: **137 tests correctos** con Postgres 17 descartable; TypeScript, lint y build correctos. No se usaron API pagas en las pruebas. CI del [PR #9](https://github.com/axellaban/turniasalud/pull/9) aprobada: **137 tests** con Postgres 16, TypeScript, lint y build. Integrado en `main` como `e8f171c`. Vercel confirma el deploy de producción [`3WMXBJUTw8ro8hQhFfkXtxxprweE`](https://vercel.com/labans-projects-c5c64fdc/turniasalud/3WMXBJUTw8ro8hQhFfkXtxxprweE).

Consolas revisadas sin modificar credenciales:
- Anthropic: saldo positivo, recarga automática desactivada; ninguna clave exclusiva de Turnia. Crear `turnia-demo-web` requiere confirmación de seguridad en ese momento.
- ElevenLabs: Text to Speech habilitado; Speech to Text confirmado en No Access. Habilitarlo amplía permisos y requiere confirmación de seguridad en ese momento. Se canceló la edición.
- WAHA: el servicio existente está asociado a otro flujo. No se cambió su configuración ni se reutilizaron sus claves. Falta un servicio/sesión exclusivo y la vinculación del chip mediante QR.
- Gmail sigue pospuesto por pedido expreso del usuario.

La Mac se bloqueó al intentar abrir la consola del deploy; no se intentó desbloquearla automáticamente ni se continuó operando esa consola. La comprobación final se hizo mediante el estado de Vercel y HTTP: salud 200 con `database: "ok"` y `demo.base: true`; siete JSON 200 y siete MP3 206 con Range; `/panel/demos` y `/demo` → 307 al login; API de token del panel → 401 sin sesión; enlace de llamada inválido → 404. `/api/waha/webhook` devuelve 500 «Webhook sin configurar», coherente con que todavía no está conectado. Los textos nuevos ya aparecen en `/probar-demo` y `/escucha-a-nuestros-agentes`. La base y el servidor locales de prueba quedaron detenidos.

Estas confirmaciones no se pueden suplir con la instrucción de avanzar mientras el usuario duerme. No se contrataron planes ni se recargó saldo.

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

- [x] Servicio WAHA exclusivo en el VPS y variables privadas preparados; ver bloque operativo de arriba. Falta vincular el chip por QR.
- [x] Custom Channel y trigger del agente creados; sus valores están en los campos correctos de Vercel, sin valores en chat ni documentación.
- [x] Webhook global HMAC configurado y proveedor WAHA guardado en el panel. El receptor acepta firma válida y rechaza firma ausente.
- [ ] Vincular el teléfono con QR y comprobar sesión `WORKING` antes de probar texto, audios entrantes, turnos, cancelación, memoria, recetas y derivación a recepción. Speech to Text ya está habilitado; su uso real todavía no fue probado.
- [ ] Definir los destinos de avisos asistenciales; la autorización de email de esta sesión es para pedidos comerciales de demo, no para enviar datos de pacientes.
- [ ] Activar campañas solamente después de validar el canal, los destinatarios y la baja de mensajes. Workflow `g0H8xbQvRNv5FxQj` continúa desactivado.

## Prioridad 2b: lead magnet "Probá la demo con tu web" (después de WAHA)

- [x] Landing `/probar-demo`, flujo por WhatsApp, lectura de la web, ficha con Claude, clínica temporal y modos llamada/audio/chat. Tests de integración con servicios simulados. Detalle en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md).
- [x] Unido a `main` (PR #6) y publicado: `/api/health` → `demo.base: true` (la base se actualizó sola en el deploy). El número de la landing sale solo de WAHA.
- [ ] **Prueba real pendiente:** Anthropic, permisos de ElevenLabs y conexiones de WAHA ya están preparados. Vincular el teléfono y probar extracción, chat, audio, llamada web y SALIR. Checklist en [`PLAN_LEAD_MAGNET.md`](PLAN_LEAD_MAGNET.md#puesta-en-marcha-lo-que-queda-para-la-próxima-ia).

## Prioridad 3: primera clínica y ampliaciones

- Cargar datos y protocolos reales de la clínica; hoy sigue el centro ficticio de demo. No reemplazar datos por suposición.
- Hacer una conversación hablada completa con una persona, comprobar una herramienta y el registro final; el circuito de reserva por chat ya tuvo una prueba anterior exitosa.
- Revisar acceso, consentimiento, conservación de datos y los textos de privacidad antes de usar pacientes reales. No activar Zero Retention a ciegas: el plan de Custom Channel documenta incompatibilidad.
- Configurar derivación telefónica si se elige teléfono de recepción. Agendas externas, roles por clínica, admisión digital y cobranzas son ampliaciones posteriores.
- Casos reales y precios: pendientes de contenido. El video del hero ya está publicado con clips de stock con licencia; se puede reemplazar por uno propio.
- Dependencias de desarrollo: `npm audit` reportó cinco entradas de severidad alta en la cadena de ESLint/fast-glob/micromatch/braces. `braces` 3.0.3 sigue siendo la última versión consultada; no se aplicó el `--force` que propone bajar `eslint-config-next` a Next 14. No forma parte del servidor publicado. Revisar al salir una corrección compatible.

## Continuidad sin computer use

El código y los tests se pueden continuar desde el repositorio. Los accesos a consolas permanecen en las sesiones del navegador del usuario. n8n permite buscar los workflows por MCP, pero su detalle no está habilitado por MCP; se editó desde la UI sin ampliar ese acceso. No tocar proyectos ajenos a Turnia ni contratar planes. Las credenciales no se copian a este documento.

## Referencias de esta entrega

- App: https://turniasalud.vercel.app/panel/demos
- PR integrado: https://github.com/axellaban/turniasalud/pull/5
- CI aprobado (98 tests): https://github.com/axellaban/turniasalud/actions/runs/39685558750
- Producción comprobada: https://vercel.com/labans-projects-c5c64fdc/turniasalud/2FEsHc3xyKH8A7GPSTUhAo4Sr3HY
- Ejecución de email pendiente de reconexión: https://n8n-n8n.b6mgbu.easypanel.host/workflow/PEaOkLPBrLIfFE0Q/executions/50206
