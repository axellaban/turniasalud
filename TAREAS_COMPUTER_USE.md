# Tareas para una IA con computer use

Tareas de configuración que no se arreglan desde el código: se hacen en paneles web (Vercel, ElevenLabs, Google Cloud, PostHog, claude.ai) con el navegador del usuario, donde ya tiene la sesión iniciada. Salieron del QA del 13/11/2026 ([`QA_TURNIA.md`](QA_TURNIA.md)).

Cada tarea se puede copiar entera como prompt. Van en orden de prioridad: **P0** es lo primero.

**Estado al 19/11/2026:** control de la **tarea 10** realizado y herramientas y pausa de la **tarea 8** configuradas y comprobadas técnicamente. Axel confirmó haber recibido un aviso de integración en su WhatsApp personal. Quedan el rechazo 403 de Smile Connect al leer bloqueos y la prueba manual desde el WhatsApp del consultorio; el usuario confirmó que por ahora solo tiene acceso al 5483. Se conserva la clave vigente por pedido del usuario. La **tarea 9** está hecha y la 7 quedó en su última etapa. La 5 sigue postergada por el usuario.

**Prompt para empezar** (copiar tal cual en la otra computadora):

> Leé el control del 19/11 en `QA_TURNIA.md` y el principio de `PENDIENTES.md`. Continuá solo sus comprobaciones pendientes. El 403 de `/events` se confirmó con la clave vigente y el usuario pidió conservarla. No generar ni revocar claves por iniciativa propia. «Sincronizar ahora» permite volver a probar cuando Smile Connect revise ese rechazo.

**Prompt para las tareas 11 y 12 (26/11)** (copiar tal cual):

> Leé `TAREAS_COMPUTER_USE.md` en el repositorio turniasalud y hacé la tarea 11 (limpiar los textos repetidos de la configuración de Guerra–Mininni) siguiendo cada paso y sus reglas. Después hacé la tarea 12 (verificar la primera ficha completa en Smile Connect); si todavía no hay un paciente nuevo agendado por Sofi desde el 26/11, decilo y no hagas nada más. No reserves, muevas ni canceles turnos y no compartas datos de pacientes. Si algo no coincide con lo que dice un paso, frená y preguntame.

| Prioridad | Tarea | Estado (19/11) | Acción restante |
| --- | --- | --- | --- |
| — | 11. Guerra–Mininni: limpiar los textos repetidos de la configuración | Hecha el 26/11 por otra IA con computer use (aviso de Axel). | Ninguna. |
| **P1** | 12. Guerra–Mininni: verificar la primera ficha completa en Smile Connect | Pendiente (26/11): espera al primer paciente nuevo que agende Sofi. | Hacerla cuando haya uno. |
| **P0** | 10. Guerra–Mininni: control de la integración con Smile Connect en producción | Revisado el 19/11: escritura activa, sincronizaciones y copia correctas, alta preexistente cotejada. Axel confirmó recepción de un aviso. `/events` respondió 403 con la misma clave. | Revisar ese rechazo con Smile Connect. |
| — | 9. Guerra–Mininni: horarios de Smile Connect y feedback del 18/11 | Hecha el 18/11. | Ninguna. |
| — | 7. Smile Connect por API y resumen diario (Guerra–Mininni) | Etapa D activa desde el 18/11: «Crear, mover y cancelar», con `SMILE_CONNECT_WRITES=on`. Las visitas combinadas siguen yendo a recepción. | Ninguna: mirar los primeros cambios y cancelaciones en «Registro de cambios en Smile Connect». |
| **P1** | 8. Actualizar a Sofi y pausa automática (Guerra–Mininni) | Configurada el 19/11: agentes actualizados, `message.any`, sesión `WORKING` y pausa prendida. Circuito técnico verificado y pausa ficticia retirada. | Comprobar una respuesta manual desde la app de WhatsApp del consultorio. |
| **P1** | 5. Accesos para el QA automático | Pendiente. | Que el QA pueda revisar el panel en producción, PostHog y Vercel. Los valores los carga el usuario. |
| **P3** | 1. Dominio nuevo: webhooks de WAHA (opcional) | Funciona: los dos webhooks apuntan al dominio anterior y llegan por su redirección 308, que se mantiene. | Solo si algún día se saca la redirección. |
| — | 2. Certificado de `www.turniasalud.app` | Resuelta. | — |
| — | 6. PostHog: datos limpios y errores visibles | Configurada el 14/11. | Ninguna: el QA comprueba que lleguen las excepciones. |

## Reglas para todas las tareas

- **No escribas contraseñas, tokens ni claves en el chat, en documentos ni en capturas.** Si una pantalla muestra una clave, no la copies. Cuando haya que cargar un valor secreto, pedile al usuario que lo escriba él.
- Antes de cambiar algo, sacá una captura de cómo estaba. Al terminar, otra de cómo quedó.
- Cambiá solo lo que dice la tarea. No borres proyectos, dominios, variables ni webhooks. No cambies secretos. No mandes mensajes de WhatsApp. No cierres sesiones de WAHA.
- Si algo no coincide con lo que describe la tarea (otro nombre, otro menú, un valor distinto), frená y preguntá.
- Al terminar cada tarea, contestá: qué quedó hecho en cada paso, qué no se pudo y por qué, y el resultado de la verificación.

---

## Tarea 11 (hecha el 26/11) · Guerra–Mininni: limpiar los textos repetidos de la configuración

**Contexto.** Una auditoría del 26/11 encontró datos escritos dos veces: en un campo con su regla y además en un texto libre. Hoy no se contradicen, pero si alguien cambia uno, Sofi recibe dos versiones. Ya se corrigió por código el horario de atención (vacío: Sofi dice el de la agenda de Smile Connect), la web de prueba y «Particular» en las coberturas. Falta esto, que necesita leer el texto actual. Detalle en `PENDIENTES.md` → «Configuración: auditoría de otra IA (26/11/2026)».

**Reglas**
- Es la configuración real de un consultorio en producción. **Cambiá solo las frases que dice cada paso.** No reescribas los textos ni corrijas estilo.
- **No reserves, muevas ni canceles turnos.** No toques nada de lo que tiene candado («Se maneja en Smile Connect»).
- **No borres ni desactives prestaciones.**
- Si algo no coincide con lo que dice el paso (otro número, otra frase, una cobertura que no está en la lista), **frená y preguntá**.

**Dónde:** panel de Turnia (`https://turniasalud.app/panel`) con la clínica **Guerra–Mininni** elegida arriba → Configuración.

### Paso 0 · Cómo está antes
1. En la pestaña «Consultorio», abajo a la derecha, abrí **«Lo que sabe Sofi del consultorio»**.
2. Sacá una captura de todo el texto (lo vas a comparar al final).
3. Copiá en tu respuesta el recuadro de arriba («Hay N datos que se contradicen»), si aparece.

### Paso 1 · «Otras condiciones» (pestaña «Turnos y urgencias»)
1. Anotá qué dicen los campos «Aviso mínimo para mover (horas)» y «Aviso mínimo para cancelar (horas)».
2. En «Otras condiciones», borrá **solo** las frases que repiten esos plazos, por ejemplo «Avisar 24 horas antes…».
   - Si una frase dice un plazo distinto al del campo, no la borres: frená y preguntá.
   - Si el campo está vacío y la frase dice un plazo, cargá ese número en el campo y recién después borrá la frase.
3. Borrá también **solo** las frases que nombran coberturas («atendemos OSDE, Swiss Medical, Apsot…»), siempre que todas esas coberturas estén en la pestaña «Coberturas» → «Coberturas que acepta el consultorio». Si falta alguna, no la borres: anotala y preguntá.
4. Si hay un teléfono distinto de los de los campos «Teléfono» (pestaña «Consultorio») y «Teléfono para pasar llamadas», por ejemplo «(011) 4804-1151, de lunes a jueves de 12 a 17 h», **no lo borres**. Anotalo y preguntá cuál es el correcto y para qué es: puede ser el horario telefónico de recepción.
5. Dejá todo lo demás: tolerancia, seña, qué pasa si no avisa.
6. Apretá «Guardar cambios».

### Paso 2 · Conductos por obra social → una excepción (pestaña «Coberturas»)
El texto dice algo como «No hacemos tratamientos de conducto por obra social». Como excepción, Sofi lo cumple siempre: no ofrece esos turnos por obra social y ofrece atenderse como particular.
1. En «Prestaciones», buscá la de conductos (endodoncia o tratamiento de conducto) que da Sofi, es decir, que no dice «solo el consultorio».
   - Si no hay ninguna, o la única es «Turno Smile Connect (Endodoncia)», **no crees excepciones**: anotalo y seguí con el paso 3.
2. En «Coberturas» → «Excepciones» → «+ Agregar una excepción», agregá una por cada obra social o prepaga de la lista del consultorio, salvo «Particular»:
   - Obra social: la de la lista, escrita igual (por ejemplo «OSDE»).
   - Plan: vacío.
   - Prestación: la de conductos del punto 1.
   - Profesional: vacío.
   - Qué pasa: **«No la acepta (ofrecer particular)»**.
3. Recién con las excepciones cargadas, borrá esa frase del texto donde esté («Otras condiciones», «Sobre el consultorio y preguntas frecuentes» o «Instrucciones adicionales»).
4. Si estaba en un texto de la pestaña «Consultorio» o «Turnos y urgencias», guardá en esa pestaña.

### Paso 3 · Precio repetido (pestaña «Consultorio» → «Sobre el consultorio y preguntas frecuentes»)
1. Buscá el precio que está en el texto (por ejemplo «Consulta particular: $48.000»).
2. Fijate en «Prestaciones» que esa prestación tenga el mismo precio.
   - Si es el mismo, borrá **solo el monto** de la frase (o la frase, si no dice otra cosa). Las formas de pago que estén en la misma línea se dejan.
   - Si es distinto, no lo borres: frená y preguntá cuál es el correcto.
3. Apretá «Guardar cambios».

### Paso 4 · Trato (pestaña «Consultorio»)
1. Mirá «Cómo trata a los pacientes».
   - Si dice «De usted»: en «Instrucciones adicionales», borrá **solo** la frase «Tratá siempre de usted» (o la que diga lo mismo).
   - Si dice «De vos»: cambialo a «De usted» y después borrá esa frase.
2. Apretá «Guardar cambios».

### Paso 5 · Dos «Turno Smile Connect» (pestaña «Prestaciones») · solo mirar
1. **No las borres ni las desactives**: las creó la sincronización con Smile Connect.
2. Anotá de cada una:
   - la especialidad y la duración;
   - si Sofi la ofrece o si es «solo el consultorio»;
   - si tiene profesionales.

### Paso 6 · Verificación
1. Volvé a abrir «Lo que sabe Sofi del consultorio» y sacá otra captura.
2. El recuadro «Hay N datos que se contradicen» no tiene que aparecer, o no tiene que haber sumado nada.
3. En «Probar a Sofi» → «Empezar la prueba», hacé dos pruebas y cerrá cada una sin contestar más:
   - Escribí «¿Hacen tratamiento de conducto por OSDE?» (con una obra social de la lista). Tiene que decir que por obra social no y ofrecer atenderse como particular.
   - Escribí «¿Cuánto sale la consulta?». Tiene que dar un solo precio.
4. Al terminar, contestá:
   - qué frases borraste y de qué campo;
   - qué excepciones creaste;
   - lo que anotaste en el paso 5;
   - el resultado de las pruebas;
   - las dos capturas, antes y después.

## Tarea 12 (P1) · Guerra–Mininni: verificar la primera ficha completa en Smile Connect

**Contexto.** Desde el 26/11, cuando Sofi agenda un turno de alguien que no está en Smile Connect, crea su ficha con todo lo que sabe:
- nombre, DNI, mail y celular;
- fecha de nacimiento, sexo y domicilio;
- obra social con plan y afiliado.

Si Smile Connect rechaza algún dato, crea la ficha con lo básico y anota qué rechazó. Esta tarea comprueba la primera ficha real. Detalle en `SMILE_CONNECT_API.md` → «Ficha completa del paciente nuevo».

**Cuándo:** cuando Sofi ya haya dado un turno a un paciente nuevo, es decir, después del 26/11. Si todavía no hubo ninguno, contestá eso y no hagas nada más.

**Reglas**
- **Solo mirar.** No cambies nada en Turnia ni en Smile Connect.
- **Sin nombres, teléfonos, DNI ni números de afiliado** en la respuesta ni en las capturas. Tapalos o describilos («tiene obra social cargada: sí»).

### Paso 1 · En Turnia
1. Entrá al panel de Turnia (`https://turniasalud.app/panel`) con **Guerra–Mininni** elegida arriba.
2. Andá a Configuración → Agenda e integraciones → tarjeta «Smile Connect por API» → «Registro de cambios en Smile Connect».
3. Buscá el **«Crear paciente»** más reciente con estado **«Hecho»** y fecha del 26/11 o posterior. Abrí su «Detalle».
4. Anotá, sin copiar los valores:
   - qué campos se mandaron (`birth_day`, `sex`, `address`, `medical_insurance_name`, `medical_insurance_plan`, `medical_insurance_number`);
   - el número de paciente de Smile Connect (`patient_id` en el resultado);
   - si en el resultado aparece **`ficha_rechazada`**. Si aparece, anotá qué campos tiene: es lo que Smile Connect no aceptó.

### Paso 2 · En Smile Connect (`https://app.smileconnect.pro`, solo si el usuario tiene la sesión iniciada)
1. Abrí la ficha de ese paciente (buscalo por su número o desde su turno).
2. Comprobá que tenga cargados los mismos datos que se mandaron: obra social, plan, afiliado, fecha de nacimiento y, si se mandaron, sexo y domicilio.

### Al terminar, contestá
- la fecha del alta;
- qué campos se mandaron;
- cuáles se ven en la ficha de Smile Connect;
- si hubo `ficha_rechazada` y con qué campos.

Si algún dato se mandó y no aparece en la ficha, o si hubo `ficha_rechazada`, avisalo: hay que revisarlo con Smile Connect.

## Tarea 10 (P0) · Guerra–Mininni: control de la integración con Smile Connect en producción

**Control realizado el 19/11:** ver `QA_TURNIA.md`. No se cambió el modo ni la clave y no se gestionaron turnos para este control. La única sincronización manual fue a las 10:16; agenda y horarios correctos y lectura de bloqueos rechazada con 403. El usuario indicó que la clave ya tenía todos los permisos y pidió conservarla.

**Contexto.** El consultorio trabaja solo en Smile Connect y nunca entra al panel de Turnia.
- **De Smile Connect a Turnia:** lo que cambia allá llega solo (turnos, asistencia, cancelaciones, pacientes, horarios de los profesionales, notas y bloqueos).
- **De Sofi a Smile Connect:** Sofi crea, mueve y cancela turnos (modo «Crear, mover y cancelar», con `SMILE_CONNECT_WRITES=on`). Lo verifica allá antes de confirmárselo al paciente.
- **Visitas combinadas** (dos prácticas seguidas) **y turnos con dos profesionales:** van a recepción.

Esta tarea controla que en producción ande todo como en las pruebas. Detalle técnico en [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md).

**Reglas**
- Es la agenda real de un consultorio en producción. **No reserves, muevas ni canceles turnos, no marques asistencia y no le des datos a Sofi.**
- En la tarjeta de Smile Connect **no cambies el modo, no toques la clave y no apretes «Quitar la clave y apagar».** «Sincronizar ahora» se puede tocar **una sola vez**, porque gasta cupo de la API.
- Smile Connect (`https://app.smileconnect.pro`) solo para mirar, si el usuario tiene la sesión iniciada.
- **Sin nombres, teléfonos ni DNI de pacientes** en la respuesta ni en las capturas que compartas.

**Dónde:** panel de Turnia (`https://turniasalud.app/panel`) con la clínica **Guerra–Mininni** elegida arriba → Configuración → Agenda e integraciones (Calendario) → tarjeta **«Smile Connect por API»**.

**Pasos**
1. **Estado de la tarjeta.** Sacá una captura y anotá, tal cual se ven:
   - el modo (la etiqueta de arriba a la derecha): tiene que decir **«Crear, mover y cancelar»**;
   - «Clínica en Smile Connect», «Clave» (solo los últimos 4 caracteres y la fecha), «Agenda cercana», «Agenda lejana», «Horarios de los profesionales», **«Bloqueos»**, «Copia diaria» y «Lecturas de hoy»;
   - cualquier recuadro de aviso: «Último problema», «Smile Connect pidió esperar…», escritura frenada, el aviso de horarios o el de la clave sin permiso de bloqueos. Copiá el texto completo.
2. **Bloqueos.**
   - Si dice **«Por la API»**, está bien.
   - Si dice **«Pendiente de verificar»**, tocá «Sincronizar ahora» (la única vez) y volvé a mirar.
   - Si dice **«Lectura rechazada (403)»**, Smile Connect rechazó esa operación: revisar `events:read` con el proveedor. Si la clave ya tiene el permiso, que revisen por qué la rechazan. Conservar la clave actual por pedido del usuario.
   - Si dice **«Ruta no disponible (404)»**, la ruta de bloqueos no estuvo disponible. Turnia la vuelve a probar cada hora y con «Sincronizar ahora». No atribuir ese estado a permisos ni renovar la clave por ese motivo.
3. **Historial de sincronizaciones.** Abrí «Historial de sincronizaciones (últimas …)». Anotá:
   - cuántas dicen «Bien» y cuántas «Error»;
   - los tipos que aparecen (Agenda cercana, Agenda lejana, Horarios, Copia diaria, Copia aplicada a Turnia, Escritura);
   - el texto de cada error, si hay.

   «Agenda cercana» tiene que aparecer al menos una vez en las últimas 2 horas en horario de atención (cada 2 horas fuera de él).
4. **Registro de cambios en Smile Connect.** Anotá las últimas entradas: acción (Crear turno, Mover turno, Cancelar turno, Crear paciente), estado (Hecho, Revisar, Error) y fecha. No anotes datos de pacientes. Si hay «Revisar» o «Error», copiá el motivo.
5. **Para revisar.** Si la tarjeta muestra una lista de turnos «para revisar en Smile Connect», anotá cuántos son y el motivo de cada uno.
6. **Un turno de Sofi en Smile Connect** (solo si el usuario tiene la sesión iniciada en Smile Connect y está de acuerdo).
   - Elegí del Registro de cambios un «Crear turno» con estado «Hecho» de hoy o ayer.
   - Buscalo en la agenda de Smile Connect por día y hora: tiene que estar, con el mismo profesional.
   - Si se creó después del 19/11, en sus notas tiene que aparecer el motivo y «Lo dio Sofi (Turnia)».
   - Solo mirar.
7. **Agenda de Turnia.** Abrí Agenda en la semana actual:
   - arriba no tiene que estar el cartel amarillo con «Marcar todos como atendidos». En su lugar dice **«La asistencia se toma de Smile Connect»**. Copiá el texto;
   - si en Smile Connect hay vacaciones o bloqueos en los próximos días y «Bloqueos» dice «Por la API», tienen que verse en la Agenda.
8. **Avisos por WhatsApp.** Preguntale al usuario si le llegó algún WhatsApp de Turnia que empiece con «⚠️ Turnia · Smile Connect» o «ℹ️ Turnia · Smile Connect» y qué decía.
9. **Al día siguiente, después de las 7:** «Copia diaria» tiene que tener fecha de ese día y decir «aplicada a Turnia». Si no, anotá qué dice «Último problema».

**Solo si el usuario decide renovar la clave después de revisar el rechazo con Smile Connect** (no es el curso autorizado al 19/11):
- **Crear la clave.** La crea el consultorio en Smile Connect, o el usuario con su sesión: «API pública» → clave **sin vencimiento** con todos los permisos (lectura: `clinic:read`, `professionals:read`, `boxes:read`, `availability:read`, `appointments:read`, `patients:read`, `events:read`, `services:read`; escritura: `patients:create`, `appointments:create`, `appointments:reschedule`, `appointments:cancel`). **La clave la copia y la pega el usuario; vos no la ves.**
- **Cargarla en Turnia:** en la tarjeta, «Cambiar la clave». Revisá que siga el mismo nombre de clínica y los tres profesionales vinculados. El modo no se toca.
- **Revocar la anterior:** recién después de verificar que «Bloqueos» dice «Por la API», el usuario revoca la clave anterior en Smile Connect.

**Respuesta esperada.** Una línea por paso con lo que viste y si está bien o no, más el texto completo de cualquier aviso o error. Al final, un resumen: qué anda bien, qué hay que mirar y qué no se pudo revisar y por qué.

## Tarea 9 (hecha el 18/11) · Guerra–Mininni: horarios de Smile Connect y verificación del feedback del 18/11

**Contexto.** El 18/11 el Dr. Mininni marcó problemas en una charla real de Sofi. Se corrigieron en el código y en sus instrucciones, que se cambiaron solas con el deploy (PR #223 a #227). Falta lo que se hace en el panel.

La fuente de verdad es **Smile Connect**: los horarios de Turnia tienen que coincidir con los de Smile Connect. Hoy no coinciden, y por eso Sofi no ofrece el último turno de cada día ni los viernes del Dr. Mininni. Los horarios de abajo se leyeron de Smile Connect el 18/11 (`/professionals/{id}/hours`) y se confirmaron con su agenda libre de febrero de 2027.

**Reglas de esta tarea**
- Es la agenda real de un consultorio en producción. **No reserves, muevas ni canceles turnos, y no le des datos a Sofi.**
- No toques Smile Connect: solo el panel de Turnia.
- No apretes «Actualizar a Sofi» ni «Crear / actualizar agente»: no hace falta para esta tarea.
- Captura antes y después de cada cambio.

### Paso 0 · Entrar y elegir la clínica
1. Entrá a `https://turniasalud.app/panel` con la contraseña del panel. **La escribe el usuario.**
2. En el selector de clínicas, elegí «Consultorio Odontológico Dr. Guerra y Dr. Mininni» (la principal, no una demo).

### Paso 1 · Verificar lo que se cargó solo (no cambiar nada)
1. **Configuración → Turnos y urgencias:**
   - «Primer turno del día» dice «Desde el día anterior».
   - Abajo, el «Protocolo odontológico de Turnia» dice **«Versión 2026-11-18.2»**. Si dice otra versión, el último deploy todavía no salió: **frená y avisá**.
2. **Configuración → Consultorio → «Instrucciones adicionales»:** comprobá, sin editar, que el texto incluya estas cinco frases:
   - «Si no la nombró, no menciones a la Dra. Coldeira»
   - «Por WhatsApp pedí en un solo mensaje todos los datos que falten»
   - «Una molestia o sensibilidad no es una urgencia»
   - «nunca escribas la palabra «limpieza»»
   - «en un párrafo aparte que empiece con «*Radiografías:*»»

   Si falta alguna, no la escribas a mano: avisá cuál falta.

### Paso 2 · Horarios iguales a Smile Connect (Configuración → Equipo y horarios)
Antes de cambiar, mirá los horarios actuales de cada profesional. Si alguno tiene la marca «urgencias» o «solo …» (solo algunas prestaciones), **frená y avisá**: esos no se recrean así nomás.

Para cada día que cambia:
1. Primero agregá el horario nuevo con «+ Agregar horario»: tildá los días, poné «Desde» y «Hasta», sin «Solo urgencias» y sin prestaciones, y apretá «Guardar horario».
2. Después quitá el horario viejo de esos días con la «×».

**Cómo tiene que quedar:**

| Profesional | Lun | Mar | Mié | Jue | Vie |
| --- | --- | --- | --- | --- | --- |
| Dr. Mariano O. Mininni | 11:00–17:30 | 11:00–17:30 | 11:00–17:30 | 11:00–18:30 | **11:00–17:30 (nuevo)** |
| Dra. María Emilia Coldeira | 10:00–17:30 | 10:00–18:30 | 10:00–17:30 | — | — |
| Dra. Lara Fernández | — | — | — | 11:00–17:30 | — |

- Hoy en Turnia: Mininni lunes a jueves 11:00–17:00; Coldeira lunes a miércoles 10:00–18:00; Fernández jueves 11:00–17:00.
- El Dr. Guerra está desactivado: no lo toques.
- Al final, cada profesional tiene que tener **un solo horario por día**, el de la tabla.

### Paso 3 · Horario de atención (Configuración → Consultorio → «Horario de atención»)
1. Reemplazá «Lunes a miércoles de 10 a 18 y jueves de 11 a 17» por:
   > Lunes de 10 a 17:30, martes de 10 a 18:30, miércoles de 10 a 17:30, jueves de 11 a 18:30 y viernes de 11 a 17:30
2. Apretá «Guardar cambios».

### Paso 4 · Una línea de las instrucciones (Configuración → Consultorio → «Instrucciones adicionales»)
1. En la sección «HORARIOS», reemplazá **solo** esta línea:
   > - Atención del consultorio: lunes a miércoles de 10 a 18 h y jueves de 11 a 17 h. Horario telefónico: lunes a jueves de 12 a 17 h. Para dar un turno, usá los horarios de la herramienta con el profesional elegido; las franjas generales no representan su disponibilidad. Ningún turno puede terminar después de las 18 h.

   por esta:
   > - Atención del consultorio (según la agenda de Smile Connect): lunes de 10 a 17:30, martes de 10 a 18:30, miércoles de 10 a 17:30, jueves de 11 a 18:30 y viernes de 11 a 17:30. Horario telefónico: lunes a jueves de 12 a 17 h. Para dar un turno, usá solo los horarios que devuelve la herramienta con el profesional elegido: la agenda de Smile Connect es la que manda y las franjas generales no representan su disponibilidad.
2. No cambies nada más del texto.
3. Apretá «Guardar cambios».

### Paso 5 · Verificación
1. **Agenda:** «Agenda» → dar un turno a mano. Elegí la «Consulta de primera vez / diagnóstico», el Dr. Mininni y el viernes 12 de febrero de 2027. Tienen que aparecer horarios entre las 11:00 y las 17:00 (ese día está libre en Smile Connect). **No guardes el turno:** cerrá el formulario.
2. **Probar a Sofi:**
   - Abrí «Probar a Sofi» → «Empezar la prueba» y escribí solo: «Hola, tengo molestias en una muela».
   - La respuesta no puede hablar de guardia, 107, emergencias ni riesgo de vida, ni ofrecer «hoy o mañana». Puede preguntar «¿Cómo es la molestia?» y pedir los datos.
   - **No contestes más:** cerrá la prueba.
3. Al terminar, contestá con:
   - qué viste en el paso 1;
   - cómo quedaron los horarios de los tres profesionales (con captura);
   - el resultado de las dos verificaciones.

---

## Tarea 7 (P0) · Smile Connect por API y resumen diario (Guerra–Mininni)

**Estado al 18/11:** etapa D activa (`SMILE_CONNECT_WRITES=on` y modo «Crear, mover y cancelar»). Sofi crea, mueve y cancela en Smile Connect; las visitas combinadas van a recepción.

**Contexto (16/11).** La API de Smile Connect de Guerra–Mininni se conectó en **«Escritura de prueba»** el 16/11. La API todavía omite las notas y la prestación. Esos datos van en el resumen de Sofi, programado de lunes a jueves a las 10, hora del consultorio. Detalle técnico en [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md).

**Verificación del 16/11.** Tres profesionales vinculados. El Dr. Guerra, ausente de la lista de Smile Connect, se desactivó para nuevas reservas en Turnia. El userscript de Tampermonkey de Guerra–Mininni quedó desactivado por pedido de Axel. La sincronización manual leyó 146 turnos. El 17 y 18 de noviembre coincidieron los 39 turnos vigentes de Smile Connect por profesional y horario. Otras seis reservas de Turnia se originaron por WhatsApp y quedan para revisión. Sofi descartó un horario ocupado y las tres alternativas ofrecidas estaban libres en Smile Connect. Turnia confirmó el envío manual del resumen a dos celulares después de publicar el [PR #200](https://github.com/axellaban/turniasalud/pull/200).

La escritura cambia la agenda real del consultorio, y hay que asumir que no tiene backup. Por eso se avanza por etapas, con días de por medio. **No pases a la etapa siguiente sin el «sí» del usuario.**

**Dónde:** panel de Turnia (`https://turniasalud.app/panel`) con la clínica **Guerra–Mininni** elegida arriba. Smile Connect (`https://app.smileconnect.pro`), si el usuario tiene la sesión iniciada, solo para mirar. Vercel, proyecto `turniasalud`, solo en la etapa C.

### Etapa A · Hoy: conectar en «Solo lectura» y comprobar el resumen

1. **Agente (hecho por el usuario el 16/11; no hace falta repetirlo).** En Guerra–Mininni → Configuración → Consultorio → tarjeta «Acceso total por WhatsApp» → «Actualizar a Sofi». Después, en la tarjeta «Sofi de este consultorio · llamadas» → «Preparar o actualizar el agente». Y en Sistema → «Crear / actualizar agente». Si el usuario ya lo hizo el 16/11, alcanza con confirmarlo. Así Sofi tiene `detalle_turno` y `turnos_de_sofi`.
2. **Resumen diario.** Configuración → Consultorio → «Acceso total por WhatsApp». El celular del Dr. Mininni tiene que decir «Recibe el resumen de las 10». Si el usuario está de acuerdo, tocá «Mandar el resumen ahora» y confirmá con él que le llegó a Mininni. Sale por la línea del consultorio.
3. **Clave.** Configuración → Calendario → «Smile Connect por API» → campo «Clave de la API». **La pega el usuario, vos no la ves ni la copiás.** Guardar. Turnia la prueba antes de guardarla.
   - Tiene que mostrar el nombre de la clínica de Smile Connect y la lista «Profesionales» vinculados con los de Turnia.
   - Si un profesional queda sin vincular, o vinculado con otro, frená y avisá.
   - Si dice que a la clave le falta un permiso, avisale al usuario cuál. Los permisos que hacen falta están en `SMILE_CONNECT_API.md` → «Para activarlo».
4. **Modo.** Elegí **«Solo lectura»** → «Guardar el modo». Nada más.
5. **Primera sincronización.** Corre sola en los 10 minutos siguientes, o tocá «Sincronizar ahora» en la tarjeta. Después revisá:
   - que la tarjeta no muestre «Último problema»;
   - que en el panel, Agenda de Turnia, mañana y pasado tengan los mismos turnos que Smile Connect, mirando los dos lado a lado. Anotá solo cuántos coinciden y cuántos no, sin nombres.
6. **Sofi no ofrece lo ocupado.** En «Probar a Sofi» (Guerra–Mininni), pedí por chat «un turno para un control mañana a la tarde», con datos ficticios. **No reserves.** Los horarios que ofrece tienen que estar libres en Smile Connect.

### Etapa B · Desde el día siguiente, 2 o 3 días: «Escritura de prueba»

Solo con el «sí» del usuario.

1. Calendario → «Smile Connect por API» → modo **«Escritura de prueba»** → «Guardar el modo». Turnia anota qué escribiría, pero no escribe nada.
2. Cada día, revisá el registro de cambios de la tarjeta. Los que dicen «Prueba (no se escribió)» tienen que corresponder a turnos que Sofi dio, movió o canceló, con el paciente, la hora y el profesional correctos. Los que dicen «Revisar» se le cuentan al usuario.
3. Compará con el resumen de las 10 de ese día: lo que dice el resumen y lo que figura en el registro tienen que coincidir.

### Etapa C · Con el consultorio mirando: «Crear turnos»

Solo con el «sí» del usuario y del consultorio.

1. **Vercel** → `turniasalud` → Settings → Environment Variables → Production. Agregá `SMILE_CONNECT_WRITES` con el valor `on`. No es secreto. Después, redeploy de producción. Sin esta variable, Turnia no escribe aunque el modo lo diga.
2. En el panel, modo **«Crear turnos»**. Marcá la casilla «lo revisé con el consultorio…» y guardá.
3. **Prueba:** en «Probar a Sofi», con datos ficticios y en un horario que elija el consultorio, reservá un turno simple. Sofi debe confirmar solo cuando el mismo turno ya aparezca en Smile Connect, con un profesional y en ese horario. Si queda pendiente, revisá la tarea de recepción y el registro de la tarjeta. Si el alta fue exitosa, recepción cancela el turno ficticio desde Smile Connect.
4. Avisale al usuario que recepción ya puede dejar de copiar a mano los turnos de Sofi: llegan solos, y el detalle sale en el resumen de las 10.

### Etapa D · Después de unos días sin problemas: «Crear, mover y cancelar»

Este modo sincroniza los movimientos y cancelaciones que recepción hace desde el panel. Sofi deriva esos pedidos a recepción. Antes de probar este modo, validá un movimiento y una cancelación de prueba con el consultorio.

**Para apagar al instante:** modo «Apagada». Lo pendiente de escribir se descarta.

**Prohibido:**
- editar o borrar turnos o pacientes en Smile Connect, salvo la cancelación del turno ficticio de la etapa C;
- crear turnos de prueba con datos de pacientes reales;
- mandar WhatsApp a pacientes;
- volver a activar el userscript de Guerra–Mininni mientras esté funcionando la conexión por API.

**Verificación (contestá en cada etapa):**
- en qué modo quedó;
- los profesionales vinculados, solo cuántos;
- si la agenda coincide;
- si Sofi ofreció solo horarios libres;
- en la etapa C, si el turno ficticio apareció en Smile Connect;
- qué quedó «para revisar», si hay algo.

**Si algo falla:** volvé a «Solo lectura», o a «Apagada» si escribió algo mal, y avisá con una captura de la tarjeta, sin la clave.

---

## Tarea 8 (P1) · Actualizar a Sofi y pausa automática (Guerra–Mininni)

**Estado al 19/11:** partes A y B de configuración hechas. La línea quedó `WORKING`, el panel muestra «Pausa automática Prendida» y la prueba con eventos propios firmados pasó, incluida la reactivación. Falta comprobar una respuesta manual desde una sesión de WhatsApp del consultorio; no repetir la actualización de agentes ni reiniciar WAHA para eso. Detalle en `QA_TURNIA.md`.

**Contexto.** El 18/11 se publicaron cuatro cambios:
- dos herramientas del equipo renombradas (`equipo_buscar_pacientes`, `equipo_crear_paciente`);
- dos nuevas (`pausar_chat`, `reactivar_chat`);
- la pausa automática: si alguien del equipo le contesta a un paciente desde el WhatsApp del consultorio, Sofi deja de contestarle por 4 horas.

Mientras no se actualice el agente, todo sigue andando como antes: la ruta acepta los nombres anteriores.

**Parte A · Actualizar a Sofi** (sin riesgo para la línea):
1. Panel de Turnia → elegí la clínica Guerra–Mininni → Configuración → Consultorio → «Equipo por WhatsApp» → «Actualizar a Sofi». Esperá el mensaje de que quedó actualizado. Captura.
2. Si la clínica principal o otras clínicas usan el agente compartido, hacé lo mismo en Sistema → «Crear / actualizar agente».
3. **Verificación:** el usuario (con un celular cargado con acceso total) le escribe a Sofi «buscame a un paciente de prueba». Sofi tiene que contestar con la búsqueda, sin errores. No uses pacientes reales.

**Parte B · Pausa automática** (toca la instancia de WAHA: **pedí el «sí» del usuario antes de empezar**, y no la hagas mientras se activa una etapa de la tarea 7):
1. En el dashboard de la instancia de WAHA de Guerra–Mininni, en el webhook de la sesión (`…/api/waha/webhook/guerra-mininni`), **sumá** el evento `message.any` y dejá `message` como está. No cambies la URL ni la clave HMAC. Captura antes y después.
2. Si WAHA pide reiniciar la sesión, preguntale al usuario. **No cierres la sesión (logout) ni la desvincules.** Si pide el QR, frená.
3. Panel → Configuración → «Equipo por WhatsApp» → «Pausa automática» → «Prenderla».
4. **Prueba**, con el celular del usuario (no con pacientes reales):
   - el usuario le escribe a la línea y Sofi contesta, como siempre;
   - desde el WhatsApp del consultorio, alguien le contesta a ese chat a mano;
   - en Panel → Conversaciones → «Números en pausa» aparece ese número como «Lo atiende el equipo»;
   - el usuario vuelve a escribir y Sofi no contesta;
   - «Reactivar» → el usuario escribe y Sofi contesta de nuevo.
5. **Si algo falla:**
   - Sofi se pausa sola sin que nadie haya contestado a mano: apagá la pausa automática y avisá. Puede ser un mensaje automático de WhatsApp Business que tarda más de 15 segundos.
   - Sofi deja de contestar del todo: sacá `message.any` del webhook y avisá.

---

## Tarea 1 (P3, opcional) · Dominio nuevo

El 14/11 se actualizó `APP_URL` de producción, se registraron de nuevo las herramientas del agente compartido y se añadió el callback nuevo de Google. Se creó el webhook post-call de ElevenLabs para `https://turniasalud.app/api/elevenlabs/post-call` y se publicó su secreto de firma en Vercel. Una prueba confirmó que Sofi ofrece horarios y otra confirmó que Turnia recibe el resumen y la transcripción cuando termina la charla. El dominio anterior conserva el 308. Telegram se retiró en el PR #188 y se eliminó su variable de producción. Google aceptó el callback nuevo, mostró el consentimiento de Calendar y devolvió al panel al cancelar la prueba.

La revisión de WAHA detectó estas dos URLs configuradas:

- Línea general: `https://turniasalud.vercel.app/api/waha/webhook`.
- Guerra–Mininni: `https://turniasalud.vercel.app/api/waha/webhook/guerra-mininni`.

**Hoy funciona:** WAHA llama a esas direcciones, el dominio anterior redirige (308) a `turniasalud.app` y el mensaje llega igual. El usuario decidió mantener esa redirección, así que **no hace falta cambiar nada**. Solo hay que hacerlo si algún día se saca la redirección; si no, Sofi deja de recibir los mensajes de WhatsApp.

**Si se hace** (con el «sí» del usuario, de a una línea, primero la general y nunca mientras se activa la tarea 7):

1. En el dashboard de esa instancia de WAHA, en la sesión de la línea, cambiá solo el dominio del webhook: `turniasalud.vercel.app` pasa a `turniasalud.app`. El resto de la URL, los eventos y la clave HMAC quedan igual. Captura antes y después.
2. Si WAHA pide reiniciar la sesión, preguntale al usuario antes. **No cierres la sesión (logout) ni la desvincules.** Si después pide el QR, frená.
3. **Prueba de recepción:** el usuario le escribe a esa línea desde su celular. Sofi tiene que contestar en menos de un minuto.
4. Si no contesta, volvé a poner la URL anterior y avisá.

---

## Tarea 2 (resuelta) · Certificado de `www.turniasalud.app`

**Resuelta el 14/11.** Vercel sirve un certificado que cubre `www.turniasalud.app` y devuelve 308 hacia `https://turniasalud.app/`, que responde 200. El procedimiento queda como referencia.

**Pasos:**

1. **Vercel** → proyecto `turniasalud` → Settings → Domains → Add: `www.turniasalud.app`. Elegí que **redirija** (308) a `turniasalud.app`.
2. Si Vercel pide un registro DNS (porque el dominio no está comprado en Vercel), anotá exactamente qué pide (tipo, nombre y valor; suele ser un CNAME `www` a `cname.vercel-dns.com`). Agregalo en el proveedor del dominio. Si no sabés cuál es o no tenés acceso, frená y avisale al usuario con el dato exacto.
3. Esperá a que Vercel muestre el dominio como válido, con el certificado emitido. Puede tardar unos minutos.

**Prohibido:** tocar `turniasalud.app`, `turniasalud.vercel.app` o su redirección.

**Verificación:** abrí `https://www.turniasalud.app` en el navegador. No tiene que aparecer ninguna advertencia de seguridad, y la barra de direcciones tiene que terminar en `https://turniasalud.app/`.

---

## Tarea 6 (hecha) · PostHog: datos limpios y errores visibles

**Configurada el 14/11 en PostHog, proyecto 518346.** La transformación `Drop Events` descarta solo eventos con `$host = loreado.vercel.app`; una ejecución de prueba descartó un evento de ese sitio. Filtros de usuarios internos conserva `is_internal ≠ true` y suma `$host ≠ loreado.vercel.app`. «Enable exception autocapture» quedó activo, «Capture console logs» ya estaba activo y se autorizó `https://turniasalud.app`. El procedimiento queda como referencia.

**Pasos** (PostHog, proyecto «Turnia Salud», el de US Cloud):

1. **Dejar afuera los eventos del otro sitio, de ahora en adelante.** Data pipelines → Transformations → New. Elegí la que descarta o filtra eventos («Filter events», «Drop events» o similar), con la condición: propiedad `$host` igual a `loreado.vercel.app` → descartar. Guardá y activala. Si no hay una transformación así, frená y avisá.
2. **Excluirlos de los análisis históricos con el filtro activo.** Settings → Project → Customization → «Filter out internal and test users»: agregá el filtro `$host` **distinto de** `loreado.vercel.app`, sin borrar los que ya estén (como `is_internal`).
3. **Errores del navegador.** Settings → Error tracking → activá «Exception autocapture» (o «Capture exceptions»).
4. **Consola en las grabaciones.** En Settings → Session replay, verificá «Capture console logs». Ya estaba activo en el QA del 14/11.
5. **Dominio autorizado.** En Settings → Project → Authorized URLs, agregá `https://turniasalud.app` y conservá las URLs existentes.

**Prohibido:** borrar eventos, personas, tableros o insights, y tocar el token del proyecto.

**Verificación:**

- En Activity, filtrá por `$host = loreado.vercel.app`: no tiene que entrar ningún evento nuevo desde la hora del cambio.
- Contestá qué opciones quedaron activadas, con sus nombres exactos.
- El próximo QA confirma que llegan `$exception` y la consola de las grabaciones.

---

## Tarea 5 (P1) · Accesos para el QA automático

**Contexto.** El QA de Turnia corre en una sesión de Claude Code en la nube. Hoy no puede entrar al panel, porque falta la contraseña en su entorno, ni leer los errores de Vercel, porque falta un token. **Los valores los escribe el usuario. La IA solo navega hasta la pantalla y le avisa.**

**Pasos:**

1. **Token de Vercel.**
   - Vercel → Account Settings → Tokens → Create.
   - Nombre: `claude-qa-turnia`. Alcance: solo el equipo donde está el proyecto `turniasalud`. Vencimiento: 90 días.
   - Al crearlo, Vercel lo muestra una sola vez: **pedile al usuario que lo copie él**. No lo leas en voz alta, no lo escribas en ningún lado y no lo captures.
2. **Cargar el token en el entorno de la nube.**
   - claude.ai/code → abrí una sesión de Turnia → en la barra del título, el menú del entorno de la nube → Edit → **Network secrets** (en apps viejas: «API credentials»).
   - Host: `api.vercel.com`. Header: `Authorization`, con el prefijo `Bearer`. El valor lo pega el usuario.
3. **(Opcional, recomendado) Clave de ElevenLabs** para que el QA lea las conversaciones y las fallas de las herramientas.
   - En el mismo lugar, otro Network secret: host `api.elevenlabs.io`, header `xi-api-key`.
   - La clave la crea y la pega el usuario. ElevenLabs → API Keys, con permiso de solo lectura si lo ofrece.
4. **Contraseña del panel.**
   - En el mismo menú del entorno → Edit → Environment variables: `PANEL_PASSWORD`. El valor lo escribe el usuario.
   - Avisale que **queda guardada como texto en el entorno** y que la puede leer cualquier sesión que use ese entorno. Si prefiere no hacerlo, saltá este paso.

**Prohibido:** crear tokens con más alcance del necesario, y tocar otros secretos o variables del entorno.

**Verificación:**

- Contestá qué quedó cargado: host, header o nombre de variable, **nunca el valor**.
- En el próximo QA, Claude prueba los accesos: `api.vercel.com` tiene que responder sin 403, y el panel tiene que abrir.
- Si funcionan, actualiza «Cómo entrar» en `QA_TURNIA.md`.

---

## Después de cada tarea

La próxima sesión de Claude que corra el QA (`.claude/skills/qa-turnia/SKILL.md`) verifica lo hecho. Si está bien, cierra la observación en `QA_TURNIA.md`:

- tarea 6: OBS-004 y OBS-006;
- tarea 5: «Cómo entrar»;
- tarea 7: el estado en `SMILE_CONNECT_API.md` y en `PENDIENTES.md`.
