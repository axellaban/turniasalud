# Smile Connect por API y avisos al consultorio

**Estado (18/11/2026). Smile Connect es la fuente de la verdad de Guerra–Mininni.** El consultorio trabaja solo en Smile Connect y no entra al panel de Turnia. Todo lo que cambia allá llega solo a Turnia: turnos, asistencia, cancelaciones, pacientes, horarios y bloqueos. Ver «Smile Connect, fuente de la verdad», abajo.

La conexión sigue en «Escritura de prueba»: falta coordinar con el consultorio la escritura real. Para los bloqueos, falta sumar a la clave el permiso `events:read`; mientras tanto, Sofi los respeta igual porque verifica cada horario en vivo.

**Del 16/11:** se cargó la clave, se verificó la lectura y se desactivó el userscript de Tampermonkey. El resumen de Sofi a las 10 y «¿este turno lo diste vos?» por WhatsApp cubren la prestación y el motivo de los turnos de Sofi. El cliente se comparó con el OpenAPI vigente (`/api/v1/openapi`, v1.0.0).

## Qué ofrece la API de Smile Connect

La documentación OpenAPI es pública: `GET https://app.smileconnect.pro/api/v1/openapi`. Las claves son por clínica (`sc_live_…`), con permisos por operación.

**Se puede leer:**
- la clínica;
- los profesionales, con su consultorio por defecto;
- los consultorios;
- el horario semanal;
- las prestaciones con precio;
- la **disponibilidad por día**: ya descuenta turnos, bloqueos y feriados, y se puede pedir en celdas de 5 minutos;
- los **turnos**: hora, profesional, consultorio, paciente, asistencia y si está cancelado (los cancelados se siguen viendo);
- los **pacientes**: nombre, apellido, DNI, mail y teléfono.

**Se puede escribir:**
- crear un paciente;
- crear un turno (un profesional y un consultorio);
- mover un turno (fecha, hora, profesional o consultorio; nunca el paciente);
- cancelar un turno (baja lógica).

Según la documentación, no cobra nada ni manda mensajes.

**Desde noviembre de 2026 también:**
- las **notas** y la **prestación** (`service_id`) de cada turno, al leer, crear y mover;
- los **bloqueos de agenda** (`/events`: vacaciones, fuera de servicio y otros), con el permiso `events:read`;
- las **prestaciones** (`/services`), con el permiso `services:read`.

**No se puede:**
- editar o borrar pacientes;
- marcar la asistencia;
- leer la historia clínica, los pagos o los mensajes.

**Límites:**
- 90 pedidos por minuto y 20 escrituras por minuto;
- 10.000 registros sensibles (turnos y pacientes) por día y clínica, contando el tamaño de página pedido aunque vuelva vacía;
- las claves vencen a los 30 días, salvo que se creen sin vencimiento.

## Qué se le pidió a Smile Connect (lo gestionó Mininni): hecho

Smile Connect sumó las tres cosas que se le pidieron:
1. las notas del turno;
2. la prestación;
3. los bloqueos.

Turnia ya usa las tres:
- **Al escribir:** manda el motivo (prestación, nombre propio del turno, notas del paciente y «Lo dio Sofi (Turnia)»). Lo detecta solo con la revisión diaria del OpenAPI.
- **Al leer:** trae las notas y la prestación de cada turno, y los bloqueos.

## Cómo funciona en Turnia

Panel → Configuración → Calendario → **Smile Connect por API**. Solo Turnia (admin) carga la clave y cambia el modo.

| Modo | Qué hace |
| --- | --- |
| Apagada (por defecto) | Nada. La clave queda guardada, cifrada. |
| Solo lectura | Trae la agenda y Sofi ofrece y reserva solo lo libre en Smile Connect (con bloqueos y feriados). No escribe nada. |
| Escritura de prueba | Además anota qué escribiría, con la verificación previa, pero sin escribir. |
| Crear turnos | Sofi confirma altas simples después de crearlas y verificarlas en Smile Connect. Recepción coordina cambios, cancelaciones y visitas combinadas. |
| Crear, mover y cancelar | También sincroniza los cambios y cancelaciones del panel. Sofi deriva esos pedidos a recepción. |

La escritura real necesita, además, **`SMILE_CONNECT_WRITES=on` en Vercel**. Sin esa variable, «Crear turnos» y «Crear, mover y cancelar» funcionan como «Escritura de prueba».

**Lectura** (`src/lib/smile-connect-link.ts`):
- **Sincronización dosificada para el cupo diario** (con la automatización de cada 10 minutos, `/api/automations/calendario`):
  - de ayer a 4 días: cada 30 minutos de 7 a 22, y cada 2 horas de noche;
  - de 4 a 60 días: cada 8 horas.
- **Usa el mismo sincronizador que el userscript** (`syncSmileConnect`). Los bloqueos llegan por `/events` si la clave tiene `events:read`; sin ese permiso va con `skipBlocks`, para no borrar los que ya están en Turnia.
- **Pacientes nuevos:** se leen de a 30 por vuelta.
- **Freno:** si de golpe desaparecen más de 5 turnos, no aplica nada y lo muestra en el panel.
- **Tope propio:** 8.000 lecturas por día, contadas en `smile_connect_connections.api_reads`.
- **Disponibilidad en vivo (`smileBusy`):**
  - lo que no figura libre en Smile Connect cuenta como ocupado para Sofi, al consultar y al reservar (al reservar, se pregunta en el momento);
  - para ofrecer horarios, guarda 2 minutos lo leído; si Smile Connect falla, puede usar datos recientes. Al confirmar, la comprobación en vivo es obligatoria.
- **Copia diaria** (de 3 a 6 de la mañana): pacientes y turnos de 30 días atrás a 120 adelante. Se guardan las últimas 14 en `smile_connect_backups`.

**Escritura** (`src/lib/smile-connect-push.ts`). Es la data operativa del consultorio; hay que asumir que no tiene backup:
- Sofi confirma un turno nuevo solo después de comprobar en Smile Connect el identificador, paciente, horario, profesional y consultorio del alta. Si hay un turno que lo pisa, revierte su propia alta. Si falta respuesta, queda una tarea de recepción y el pedido no se anuncia como confirmado.
- **Sin bucles:**
  - un trigger (`turnia_smile_mark`) marca para escribir solo los cambios que hace Turnia;
  - lo que trae o escribe la sincronización va marcado con `turnia.smile_quiet` y nunca vuelve a Smile Connect.
- **De a un turno, con verificación justo antes:**
  - que el turno de Smile Connect siga a nombre del mismo paciente y en el mismo horario;
  - que tenga un solo profesional;
  - que el horario nuevo siga libre.

  Si algo no coincide, no se toca: queda «para revisar» en el panel y llega un aviso por WhatsApp.
- **Mover = mover el mismo turno de Smile Connect**, nunca cancelar y crear otro. Al reprogramar, `appointments.replaced_by` liga el turno viejo con el nuevo.
- **Pacientes:**
  - se busca por DNI y después por celular, nunca por nombre solo;
  - si no está, se crea, sin modificar nunca uno existente.
- **Sin duplicados:** `Idempotency-Key` por turno y por paciente.
- **Registro:** cada cambio queda en `smile_connect_changes`, con cómo estaba antes. Se ve en el panel, en «Detalle».
- **Freno automático:** con más de 15 cambios en una hora se frena la escritura y hay que reanudarla desde el panel.
- **Fuera de la API, siempre «para revisar»:** atendido y ausente no se escriben, y los turnos con dos profesionales se derivan a mano.

## Smile Connect, fuente de la verdad (18/11/2026)

El consultorio no carga ni marca nada en Turnia. Lo que cambia en Smile Connect llega solo, con estos tiempos:

| Qué cambia en Smile Connect | Cómo llega a Turnia | Cada cuánto |
| --- | --- | --- |
| Turnos nuevos, movidos o cancelados, y la asistencia (de ayer a 4 días) | Sincronización cercana | 30 minutos de 7 a 22; 2 horas de noche |
| Turnos de 4 a 61 días | Sincronización lejana | 8 horas |
| Asistencia, cancelaciones o cambios cargados tarde (hasta 30 días atrás) y turnos de 61 a 120 días | Copia diaria aplicada a Turnia (`mirrorSmileBackup`) | Una vez por día, después de la copia (de 3 a 6) |
| Datos de los pacientes (nombre, DNI, mail y celular) y pacientes nuevos sin turno | Copia diaria | Una vez por día |
| Horario semanal de cada profesional | `syncSmileHours`, a sus horarios de Turnia | 6 horas, y con «Sincronizar ahora» |
| Bloqueos de agenda (vacaciones, fuera de servicio) | Las dos sincronizaciones y la copia, si la clave tiene `events:read` | Igual que los turnos |
| Notas y prestación del turno | A las notas del turno en Turnia (la prestación, adelante) | Igual que los turnos |

**Reglas para no romper nada:**
- **Horarios:**
  - se copian solo las franjas comunes: las de «solo urgencias» o de algunas prestaciones las arma Turnia y no se tocan;
  - un profesional que en Turnia no tiene ningún horario no se habilita solo, porque qué ofrece Sofi lo configura Turnia. Queda anotado en el panel para revisar;
  - si Smile Connect no devuelve el horario de alguien, no se le borra nada (lo libre se verifica igual en vivo);
  - el 18/11 la conversión dio exactamente lo que se cargó a mano ese día (Mininni de lunes a viernes, el jueves hasta 18:30; Coldeira de lunes a miércoles; Fernández los jueves), así que el primer pase no cambia nada.
- **Pacientes:**
  - la primera vez que se ve a un paciente, solo se anota cómo está en Smile Connect (`patient_external_ids.smile_data`). Lo que Turnia ya sabe, como el WhatsApp desde el que escribe, no se pisa con un dato viejo;
  - desde ahí, cada cambio que se haga en Smile Connect pasa a Turnia;
  - si cambia el celular, el anterior queda vinculado para que Sofi lo siga reconociendo;
  - una ficha de Turnia unida a dos de Smile Connect no se toca;
  - los pacientes que Turnia no tiene entran de a 300 por día.
- **Bloqueos:**
  - sin el permiso `events:read`, los bloqueos de Turnia no se tocan y no se avisa nada al consultorio (no es un problema de la clave). Se vuelve a probar una vez por día;
  - un bloqueo de un profesional que Smile Connect ya no lista no entra, porque en Turnia quedaría como bloqueo de toda la clínica.
- **Notas:**
  - en los turnos que vienen de Smile Connect, mandan las notas de Smile Connect;
  - en los que dio Turnia (Sofi o el panel) y recepción copió allá, se conserva el motivo del paciente, que usa el resumen de las 10. Antes se pisaba con el nombre del consultorio.
- **Copia diaria:**
  - se aplica en la vuelta siguiente a la copia, no en la misma;
  - si de golpe faltan más de 5 turnos en una ventana, esa ventana no se aplica;
  - si falla, queda el error en el panel y se prueba con la copia del día siguiente.
- **Agenda del panel:** con Smile Connect prendido ya no pide marcar asistencia. Dice cuántos turnos pasados siguen sin marca en Smile Connect y cuántos de Turnia no aparecen allá (por ejemplo, un turno de Sofi que recepción no copió).

**Falta para Guerra–Mininni:** que el consultorio cree en Smile Connect una clave sin vencimiento con todos los permisos, incluidos `events:read` y `services:read`, y cargarla en Configuración → «Smile Connect por API». Hasta entonces, el panel muestra «Falta el permiso events:read» en «Bloqueos».

Pruebas: `src/test/smile-connect-api.integration.test.ts`, bloque «Smile Connect como fuente de la verdad». Cada regla tiene una verificación de mutación: sin ella, su prueba falla.

## Avisos al consultorio por WhatsApp (`src/lib/clinic-notices.ts`)

**Qué avisa:** cuando Sofi da, mueve o cancela un turno a pedido de un paciente, les llega el detalle a los celulares cargados en Panel → Configuración → «Avisos por WhatsApp».

**Qué lleva el aviso:**
- día y hora, y profesional;
- prestación y el motivo que contó el paciente;
- paciente, celular y DNI;
- al mover, el horario anterior; al cancelar, el motivo de la cancelación.

**Cómo funciona:**
- Cada celular elige qué avisos recibe y tiene un botón de «aviso de prueba».
- Lo que hace el propio equipo (panel o WhatsApp con acceso total) no se avisa.
- Salen por la línea de WhatsApp del consultorio o por la general de Turnia.
- Si fallan, se reintentan cada 10 minutos (hasta 5 veces o un día).

También avisan cuando algo quedó «para revisar en Smile Connect».

## QA del 18/11/2026: lista para otras clínicas

QA de toda la integración, contra un Smile Connect simulado. Nunca contra el real, porque la Sofi de Guerra–Mininni está en producción. Lo que se encontró y se corrigió:

- **El mejor flujo era solo de Guerra–Mininni.** La confirmación diferida (el pedido queda guardado y se confirma por WhatsApp después de verificarlo), los horarios verificados en cada consulta y mover o cancelar verificando en Smile Connect estaban atados a su id. Ahora es una opción por conexión (`smile_connect_connections.api_deferred`), prendida por defecto. Guerra–Mininni no cambia; una clínica nueva arranca igual. Con `false`, Sofi confirma dentro de la reserva (flujo anterior, que sigue probado).
- **Familias que comparten celular.** Si el paciente no tenía DNI en Smile Connect, se tomaba la única ficha con ese celular: el turno de un hijo podía quedar a nombre de la madre, y el vínculo quedaba guardado. Ahora, por celular, también tiene que coincidir el nombre (primer nombre y apellido).
- **DNI repetido en Smile Connect.** Antes se creaba una tercera ficha. Ahora queda para recepción, sin crear nada.
- **El cupo diario de lecturas (10.000, Turnia usa 8.000).**
  - **El problema:** con unos 146 turnos en la ventana cercana, cada sincronización gasta 200 lecturas (dos páginas de 100). Con 35 por día, más la ventana lejana y la copia, se podía pasar el tope a media tarde. Desde ahí, las confirmaciones de los pacientes esperaban hasta las 21, cuando se renueva.
  - **Qué se hizo:**
    - siempre quedan 1.000 lecturas para confirmar y verificar los turnos de Sofi (`WRITE_RESERVE`);
    - la sincronización cercana se espacia según lo que queda del cupo y del día;
    - la lejana y la copia corren solo si alcanzan;
    - una lectura rechazada no gasta cupo.
- **Clave vencida o revocada.** Antes solo se veía en el panel, y Sofi derivaba todos los pedidos sin que nadie se enterara. Ahora avisa por WhatsApp a los celulares de avisos del consultorio, y a n8n (`smile.clave`), una vez cada 12 horas.
- **Profesionales.**
  - **Cambio de nombre en Smile Connect.** Antes, si cambiaban el nombre de un profesional (o los nombres no coincidían), cada sincronización creaba otro profesional en Turnia. Ahora manda el vínculo guardado.
  - **Vínculo a mano.** Se puede vincular a mano desde el panel (profesional y consultorio).
  - **Un solo consultorio.** Si el profesional no tiene consultorio por defecto y la clínica tiene uno solo, se usa ese.
- **Zona horaria.** Al cargar la clave, avisa si la de Smile Connect no coincide con la del consultorio en Turnia.
- **Ventana incompleta.** Si una vuelta no pudo leer todos los pacientes nuevos (se leen de a 30), ya no da de baja en Turnia un turno que sigue en Smile Connect.

- **Horarios verificados para Sofi (18/11/2026).** En una charla real Sofi dijo que Mininni no tenía lugar hasta diciembre y sí quedaban algunos. Cada día tarda de 3 a 5 segundos en `/availability`; se consultaban de a cuatro con un tope de 12 segundos, y los días que no llegaban a revisarse contaban como llenos. Ahora:
  - se consultan solo los días en que el profesional atiende en Turnia, seis a la vez, los más cercanos primero, con un tope de 14 segundos (Sofi espera 20);
  - un día que no se pudo verificar sigue sin ofrecerse, pero la herramienta lo devuelve en `dias_sin_revisar` y le dice a Sofi que vuelva a buscar desde ahí en vez de decir que no hay turnos.
  - Medido contra la API real: del 18/11 al 2/12 (nueve días de lunes a jueves) en 7,7 segundos.

Pruebas: `src/test/smile-connect-qa.integration.test.ts`, con una verificación de mutación: sin cada arreglo, su prueba falla.

**También resuelto el 18/11:** las tres opciones que seguían atadas a Guerra–Mininni en el código ahora son de cada clínica:
- **la verificación de identidad** para gestionar un turno desde otro número (`clinics.verify_appointment_access`, en Turnos y urgencias);
- **la ficha de salud** (`clinics.health_form`, en Turnos y urgencias);
- **los días del resumen** (`clinics.summary_last_weekday`, en Equipo por WhatsApp).

Guerra–Mininni recibió sus valores con una migración de una sola vez y no cambia. El código ya no tiene el id de ninguna clínica.

## Para sumar otra clínica con Smile Connect

1. **Clave:** que el consultorio cree en Smile Connect una clave **sin vencimiento**, con los permisos de lectura (incluidos `events:read` y `services:read`) y de escritura de abajo.
2. **Cargarla:** Turnia la carga en Configuración → Agenda e integraciones → «Smile Connect por API».
3. **Revisar lo que muestra:**
   - el nombre de la clínica;
   - que no haya aviso de zona horaria;
   - que cada profesional activo quede vinculado con su consultorio. Si no, «Vincular» a mano.
4. **Avisos:** cargar los celulares en «Equipo por WhatsApp» (le llegan los avisos, incluido el de la clave) y mandar uno de prueba.
5. **Opciones de la clínica** (Configuración → Turnos y urgencias y Equipo por WhatsApp): la verificación de identidad desde otro número, la ficha de salud si la usa y los días del resumen.
6. **Probar por etapas:** seguir los pasos 5 a 8 de abajo («Solo lectura», «Escritura de prueba», «Crear turnos», «Crear, mover y cancelar»), con el consultorio mirando su Smile Connect.
7. **Controlar el cupo:** mirar «Lecturas de hoy» los primeros días. Si llega cerca de 7.000, la sincronización se espacia sola.

## Para activarlo

1. ~~Mergear el PR~~ (hecho el 16/11; el esquema se aplica solo en el build).
Los pasos 3 a 8 están, listos para una IA con computer use, en la **tarea 7** de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).

2. ~~Que el consultorio cree en Smile Connect una clave **sin vencimiento**~~ (hecho el 16/11):
   - **para leer:** `clinic:read`, `professionals:read`, `boxes:read`, `availability:read`, `appointments:read`, `patients:read`, `events:read` y `services:read` (los dos últimos, desde noviembre de 2026; la clave del 16/11 no los tiene);
   - **para escribir:** además, `patients:create`, `appointments:create`, `appointments:reschedule` y `appointments:cancel`.
3. Panel → Calendario → «Smile Connect por API» → pegar la clave. Revisar el nombre de la clínica y los profesionales vinculados.
4. Cargar los celulares de los avisos y mandar un aviso de prueba.
5. **«Solo lectura» unos días:**
   - ver que la agenda coincida;
   - ver que Sofi no ofrezca horarios ocupados;
   - después de la primera sincronización, desinstalar el userscript de Tampermonkey (ya no hace falta).
6. **«Escritura de prueba» unos días:** revisar en el registro que lo que escribiría sea correcto.
7. Con el consultorio mirando su Smile Connect:
   - poner `SMILE_CONNECT_WRITES=on` en Vercel y elegir «Crear turnos»;
   - probar con un paciente ficticio en un horario que elijan ellos;
   - avisar a recepción que deje de copiar a mano los turnos de Sofi.
8. Después de unos días sin problemas, «Crear, mover y cancelar».

**Para apagar al instante:** modo «Apagada» (o quitar la clave). Lo pendiente de escribir se descarta.

## Pruebas

- `src/test/smile-connect-qa.integration.test.ts`: el QA del 18/11 (otra clínica, familias, DNI repetido, cupo, clave rechazada, profesionales, zona horaria).
- `src/test/smile-connect-api.integration.test.ts`: contra un Smile Connect simulado en memoria. Cubre la clave, la lectura, la disponibilidad, los modos, crear, mover, cancelar, las verificaciones, el freno, la idempotencia, las notas y la copia diaria.
- `src/test/clinic-notices.integration.test.ts`: los avisos, con WhatsApp simulado.
- `src/lib/smile-connect-api.test.ts`: las conversiones.

El 14/11 también se verificó **solo lectura** contra el Smile Connect real del consultorio, en una base local que después se borró:
- **profesionales:** se vincularon solos por nombre;
- **turnos y pacientes:** entraron completos y la segunda vuelta trajo los pendientes sin duplicar nada;
- **horarios:** los que ofrecería Sofi estaban todos libres en Smile Connect (y respetó un feriado);
- **escrituras:** cero.
