# Smile Connect por API y avisos al consultorio

**Estado (16/11/2026): en producción, apagada por defecto.** Se mergeó el 16/11, después de la charla con el Dr. Mininni: Smile Connect no va a sumar las notas pronto, y lo que falta (prestación y motivo) lo cubren el **resumen diario de Sofi a las 10** y «¿este turno lo diste vos?» por WhatsApp (ver `ESTADO_Y_PRIORIDADES.md`, 16/11). El cliente se comparó el 16/11 con el OpenAPI vigente (`/api/v1/openapi`, v1.0.0): rutas, parámetros, cuerpos (`additionalProperties: false`), paginación, límites y formato de error coinciden; las notas siguen sin existir. Desde ese día el alta de paciente deja afuera un mail o un documento que la API rechazaría. No contiene claves, IDs ni datos de pacientes.

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

**No se puede:**
- leer ni escribir las notas o la prestación del turno;
- leer los bloqueos (solo se ven en la disponibilidad);
- editar o borrar pacientes;
- marcar la asistencia;
- leer la historia clínica, los pagos o los mensajes.

**Límites:**
- 90 pedidos por minuto y 20 escrituras por minuto;
- 10.000 registros sensibles (turnos y pacientes) por día y clínica, contando el tamaño de página pedido aunque vuelva vacía;
- las claves vencen a los 30 días, salvo que se creen sin vencimiento.

## Qué se le pidió a Smile Connect (lo gestiona Mininni)

1. Un campo `notes` al crear y al mover un turno, y que también se devuelva al leerlo.
2. Idealmente, la prestación del turno (`service_id`).
3. Poder leer los bloqueos de agenda (eventos).

Turnia revisa todos los días si la API ya acepta `notes`, con la copia diaria o al guardar la clave. Desde ese momento manda el motivo sin otro cambio: prestación, nombre propio del turno, notas del paciente y «Lo dio Sofi (Turnia)».

## Cómo funciona en Turnia

Panel → Configuración → Calendario → **Smile Connect por API**. Solo Turnia (admin) carga la clave y cambia el modo.

| Modo | Qué hace |
| --- | --- |
| Apagada (por defecto) | Nada. La clave queda guardada, cifrada. |
| Solo lectura | Trae la agenda y Sofi ofrece y reserva solo lo libre en Smile Connect (con bloqueos y feriados). No escribe nada. |
| Escritura de prueba | Además anota qué escribiría, con la verificación previa, pero sin escribir. |
| Crear turnos | Escribe en Smile Connect los turnos nuevos. Lo que se mueve o cancela queda para hacer a mano, con aviso. |
| Crear, mover y cancelar | Escribe todo lo que hace Sofi con los turnos. |

La escritura real necesita, además, **`SMILE_CONNECT_WRITES=on` en Vercel**. Sin esa variable, «Crear turnos» y «Crear, mover y cancelar» funcionan como «Escritura de prueba».

**Lectura** (`src/lib/smile-connect-link.ts`):
- **Sincronización dosificada para el cupo diario** (con la automatización de cada 10 minutos, `/api/automations/calendario`):
  - de ayer a 4 días: cada 30 minutos de 7 a 22, y cada 2 horas de noche;
  - de 4 a 60 días: cada 8 horas.
- **Usa el mismo sincronizador que el userscript** (`syncSmileConnect`, con `skipBlocks`): la API no da los bloqueos y, sin `skipBlocks`, la ventana borraría los que trajo el userscript.
- **Pacientes nuevos:** se leen de a 30 por vuelta.
- **Freno:** si de golpe desaparecen más de 5 turnos, no aplica nada y lo muestra en el panel.
- **Tope propio:** 8.000 lecturas por día, contadas en `smile_connect_connections.api_reads`.
- **Disponibilidad en vivo (`smileBusy`):**
  - lo que no figura libre en Smile Connect cuenta como ocupado para Sofi, al consultar y al reservar (al reservar, se pregunta en el momento);
  - guarda 2 minutos lo leído; si Smile Connect no responde, usa lo leído en la última media hora o la agenda que Turnia ya trajo.
- **Copia diaria** (de 3 a 6 de la mañana): pacientes y turnos de 30 días atrás a 120 adelante. Se guardan las últimas 14 en `smile_connect_backups`.

**Escritura** (`src/lib/smile-connect-push.ts`). Es la data operativa del consultorio; hay que asumir que no tiene backup:
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

## Para activarlo

1. ~~Mergear el PR~~ (hecho el 16/11; el esquema se aplica solo en el build).
2. Que el consultorio cree en Smile Connect una clave **sin vencimiento**:
   - **para leer:** `clinic:read`, `professionals:read`, `boxes:read`, `availability:read`, `appointments:read` y `patients:read`;
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

- `src/test/smile-connect-api.integration.test.ts`: contra un Smile Connect simulado en memoria. Cubre la clave, la lectura, la disponibilidad, los modos, crear, mover, cancelar, las verificaciones, el freno, la idempotencia, las notas y la copia diaria.
- `src/test/clinic-notices.integration.test.ts`: los avisos, con WhatsApp simulado.
- `src/lib/smile-connect-api.test.ts`: las conversiones.

El 14/11 también se verificó **solo lectura** contra el Smile Connect real del consultorio, en una base local que después se borró:
- **profesionales:** se vincularon solos por nombre;
- **turnos y pacientes:** entraron completos y la segunda vuelta trajo los pendientes sin duplicar nada;
- **horarios:** los que ofrecería Sofi estaban todos libres en Smile Connect (y respetó un feriado);
- **escrituras:** cero.
