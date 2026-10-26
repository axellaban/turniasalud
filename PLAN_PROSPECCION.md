# Prospección: odontólogos de Mar del Plata y Miramar

Actualizado: 25/10/2026. Estrategia, plan de la semana del 26 al 30/10 (meta: 250 primeros contactos) y cómo usar Panel → Prospección. **No contiene datos de contacto**: la lista se entrega aparte y vive solo en la base de Turnia.

## La táctica, en cinco líneas

1. **A la persona que decide, no a la recepción.** La lista es de odontólogos con nombre propio, no de consultorios. Los primeros 50 se contactaron sobre todo al WhatsApp que cada consultorio publica en su web: ahí contesta la recepción, que no compra y puede sentir que la reemplazan.
2. **Su WhatsApp personal primero.** El listado público del Círculo Odontológico de Mar del Plata da el teléfono que cada odontólogo publica para sus pacientes: 139 tienen un celular propio (137 números). A esos se les escribe directo.
3. **La demo es el mensaje.** Cada uno tiene su link (`/p/<código>`). La vista previa de WhatsApp muestra **el nombre de su consultorio** en un chat, y al tocar «Probar la demo» Sofi lo atiende como su recepción y da turnos con **su nombre**. Es el «esto es para mí» que separa un mensaje de un spam.
   - **Qué sabe Sofi en esa demo:** su consultorio, su dirección, su nombre como profesional y, en los 208 que figuran en Doctoralia, **sus tratamientos** (implantes, ortodoncia, estética, endodoncia, odontopediatría, prótesis, periodoncia, cirugía): suman su turno de primera vez y el ejemplo de su página y de la vista previa es sobre su tratamiento principal. Horario de ejemplo (lunes a viernes de 9 a 18); precios y obras sociales no los sabe y lo dice.
   - **Con web:** si se carga su web en la ficha, la demo la lee cuando toca «Probar la demo» (alrededor de un minuto) y arma profesionales, prestaciones, horarios y obras sociales. Hoy ninguno de la lista tiene web cargada.
4. **La recepción como aliada.** Cuando el número es del consultorio (fijo, el celular que figura en su web o uno que comparten varios), el mensaje va a nombre del odontólogo y le habla a la recepción de lo que le duele a ella: los mensajes acumulados de la noche y el fin de semana. Sofi cubre esas horas, no la reemplaza.
5. **Ahora, por la temporada.** En diciembre llegan los turistas a Mar del Plata y Miramar: más urgencias y más consultas por WhatsApp a cualquier hora, justo cuando la secretaria se toma vacaciones. El seguimiento usa ese gancho.

## La lista (407 personas)

Se entrega como `lista-odontologos-mdp-miramar.csv` (fuera del repo) y se importa en Panel → Prospección → Importar lista.

| Grupo | Personas | Números | Canal |
|---|---:|---:|---|
| Celular propio | 139 | 137 | WhatsApp a la persona. Prioridad 1 (7): además muestran que invierten en su consultorio (Doctoralia con agenda u opiniones, implantes, ortodoncia, estética) |
| Celular de un consultorio con varios odontólogos | 32 | 14 | Un solo mensaje por número, a la recepción y a nombre del que más señales tiene (suele ser el dueño) |
| Teléfono fijo | 196 | 139 | WhatsApp si el fijo lo tiene; si no, llamar para pedir el WhatsApp del odontólogo, o su Instagram |
| Sin teléfono (Doctoralia, con señales) | 40 | — | Buscar su Instagram desde la ficha |

Para los 250 de la semana alcanzan los 151 celulares (propios y de consultorio) más unos 100 entre fijos, Instagram y la visita a Miramar.

- **Fuentes:** [Círculo Odontológico de Mar del Plata](https://comp.org.ar/listado-de-profesionales/) (392 profesionales con dirección y teléfono; se usaron Mar del Plata, Miramar, Batán, Sierra de los Padres, Otamendi y Santa Clara del Mar) y [Doctoralia](https://www.doctoraliar.com/odontologo/mar-del-plata) (425 perfiles: especialidades, opiniones, agenda online y si pagan la plataforma).
- **Cruce:** apellido y nombre (padres e hijos comparten apellido, dirección y teléfono: cada perfil se asigna a una sola persona) y dirección. De Doctoralia sale cómo se presenta cada uno (Dr. o Dra.); a los demás se los saluda por el nombre, sin adivinar.
- **Celular o fijo:** por cómo está escrito (con 15, o 223 seguido de 3, 5 o 6). Si WhatsApp dice que el número no está, se marca «No tiene WhatsApp» y se sigue por llamada o Instagram.
- **Consultorios con web** (`consultorios-con-web-mdp-miramar.csv`, 26/10, fuera del repo): los del tablero viejo rearmados desde cada web y Páginas Amarillas. Suma 5 dueños de consultorios con web y 8 odontólogos con fijo (5 de Miramar). A 12 que ya estaban les carga la web (su demo pasa a leerla), el nombre real del consultorio y el WhatsApp que publica. Se importa con «Reemplazar los datos de los que ya están por los del archivo» marcado. Afuera: redes y prepagas (siempre decide una administración), webs que ya no existen y un consultorio de 7 odontólogos sin dueño identificable (ProDent: preguntar por WhatsApp quién lo dirige y cargarlo a mano).
- **Los primeros 50 del tablero viejo** (el artefacto de la otra cuenta, con números de consultorios): al abrir el chat, WhatsApp muestra si ya había una conversación. En ese caso, «Ya le había escrito» en vez de mandar: pasa directo al seguimiento.

## La semana (26 al 30/10)

| Día | Nuevos | Qué más |
|---|---|---|
| Lunes | 50 celulares propios (empieza por la prioridad 1) | Contestar en el día a quien responda |
| Martes | 50 celulares propios | 10 a 15 llamadas a fijos de prioridad 2 para conseguir el WhatsApp |
| Miércoles | 50: los últimos celulares y los 14 consultorios | Seguimientos del lunes (aparecen solos en «Para hoy») |
| Jueves | 40: Miramar y fijos | **Miramar en persona a la mañana** (13 odontólogos, más 2 en Otamendi; filtro «Miramar»), con el celular y su demo abierta. Seguimientos del martes |
| Viernes | 60: fijos e Instagram | Seguimientos. Cerrar reuniones para la semana siguiente |

- **Horarios:** de 8:30 a 9:30 (antes del primer paciente) y de 13 a 14:30 (corte del mediodía). Nunca después de las 21.
- **Ritmo:** de a uno, como sale de la cola. Cada mensaje tiene su nombre y su link, así que no hay dos iguales.
- **En paralelo, una vez:** escribirle al Círculo Odontológico de Mar del Plata (Moreno 2860, (0223) 494-6600) para ofrecer una charla corta para socios («WhatsApp e IA en el consultorio») o un beneficio en su sección de convenios. Un «sí» del Círculo vale por 400 mensajes.

**Vara para la semana** (supuestos para planificar, no datos): con 250 contactos, apuntá a 25 respuestas y 8 reuniones. Si el martes a la noche, con 100 enviados, respondieron menos de 5, **cambiá el primer mensaje, no el canal** (variante abajo).

## Los mensajes

Se editan en Panel → Prospección → Mensajes y metas. Los de fábrica:

- **Primero, a la persona:** saludo con su nombre, «te armé una demo con tu consultorio», qué hace Sofi en una línea, el link y la salida («si no, avisame y no te escribo más»).
- **Primero, al consultorio:** «Le armé a la Dra. X una demo…», el dolor de la recepción (los mensajes acumulados de la mañana) y el pedido de que se la pasen.
- **Seguimiento (2 días hábiles después):** la temporada y el mismo link.
- **Después de probar la demo:** «¿Llegaste a probarla? ¿Qué te pareció?». Nunca «vi que la abriste».
- **Último (4 días hábiles después):** «¿te la muestro 15 minutos o lo dejamos acá?». Después de tres mensajes no se escribe más.
- **Instagram:** sin link (los pedidos de mensaje con links se filtran); si contesta, le pasás el link.
- **Llamada:** el objetivo es el WhatsApp de la persona que decide.

**Variante si responden poco** (pregunta primero, sin link):

> Hola {saludo}, ¿cómo estás? Soy Axel, de Turnia. Una pregunta rápida: cuando estás atendiendo, ¿quién le contesta el WhatsApp a los pacientes que escriben para pedir turno? Armé una asistente que lo hace sola, con tu agenda. Si querés, te paso una demo con tu consultorio: es un minuto.

## Panel → Prospección

- **Para hoy:** primero los seguimientos que vencieron (arriba, quienes abrieron o probaron su demo), después los nuevos por prioridad hasta la meta del día (50). «Escribir por WhatsApp» abre WhatsApp Web (o la app en el celular) con el mensaje escrito; al tocarlo queda registrado y se programa el seguimiento. Si dos personas comparten número, el mensaje sale una sola vez.
- **Esperando respuesta**, **Interesados** (respondieron, abrieron o probaron su demo) y **Todos**, con filtros por zona, canal, estado y búsqueda.
- **Ficha:** el mensaje que toca, Instagram (copia el mensaje y abre el chat), llamada con guion, «Lo visité», estados, datos editables (saludo, consultorio, teléfono y de quién es —celular de la persona, celular del consultorio o fijo—, Instagram, web), notas e historia. «Buscar su Instagram» y «Buscar en Google» abren la búsqueda armada.
- **Google Sheets:** con «Conectar con Google», la prospección y los pedidos de demo quedan en una planilla de tu Drive que se actualiza sola con cada cambio (`GOOGLE_SHEETS.md`).
- **Importar de nuevo:** sin marcar nada, a los que ya están solo se les completa lo que falta. Con «Reemplazar los datos de los que ya están por los del archivo», lo que trae el archivo pisa lo cargado (nunca el nombre, el estado ni los contactos).
- **Deshacer contacto:** si tocaste WhatsApp para probar (o abriste el chat y no mandaste), «Deshacer contacto» borra ese último mensaje, llamada o visita; sin contactos, vuelve a «Por contactar» y no cuenta para la meta.
- **Su demo:** «Ver lo que recibe» abre la página como la ve el odontólogo, sin contar como visita. Cuando él la abre o la prueba, queda en la ficha y el seguimiento pasa a hoy. Si la prueba, también aparece en Pedidos de demo.
- **Estados:** Respondió, Reunión, Cliente, No le interesa, No tiene WhatsApp y **Pidió no recibir más**, que lo saca para siempre (también de las llamadas de Sofi).

## Cuando responde

1. **Reunión de 15 minutos**, en persona si es de Mar del Plata o Miramar (es la ventaja de ser de cerca) o por videollamada.
2. **Antes de la reunión**, cargá su consultorio en una clínica del panel (profesionales, prestaciones, horarios, obras sociales): que se vea su agenda atendida por Sofi.
3. **En la reunión:** que le escriba él a Sofi y vea aparecer el turno; después la cuenta con sus números (cuántos WhatsApp le entran fuera de horario y cuánto vale un paciente nuevo). Oferta vigente: demo personalizada y charla con Axel, sin cotizar antes (`COMERCIAL_AGUSTIN.md`).

| Te dice | Respondé |
|---|---|
| ¿Cuánto cuesta? | Depende de cuántos mensajes y turnos manejan. Primero probala; si te sirve, en 15 minutos te armo la propuesta. |
| Ya tengo secretaria | No la reemplaza: cubre la noche, el fin de semana y los picos, y le deja los turnos dados. |
| Uso Doctoralia / Dentalink | La integración todavía no está: en el piloto Sofi da turnos en los horarios que le reserves. Decilo así. |
| ¿Y si se equivoca? | Usa solo lo que cargás; lo que no sabe lo deja como tarea para una persona y ves todas las conversaciones. |

## Reglas

- **Tu WhatsApp, no el chip de WAHA.** Usá WhatsApp Business con el perfil de Turnia (`public/marca/turnia-perfil.png`, descripción y web): un número con logo genera más confianza que uno anónimo.
- **De a uno y personalizado.** Si muchos bloquean o reportan, WhatsApp restringe el número. Si aparece un aviso de restricción, frená por ese día.
- **Baja inmediata y para siempre** ante cualquier «no me escribas». Tres mensajes como máximo, y siempre identificado.
- **Llamadas:** antes de llamar en volumen, revisá el Registro Nacional No Llame. Respetá cualquier «no».
- **No inventar** clientes, testimonios ni números. **No subir la lista al repo.**

## Qué sigue

- Prueba A/B del primer mensaje desde el panel.
- Recordatorio diario («hoy te tocan 12 seguimientos») por el canal que elija Axel.
- Encontrar el Instagram de los fijos y de los que no tienen teléfono (hoy es un botón de búsqueda por persona).
- Cuando haya saldo y autorización: Sofi llama a los que abrieron la demo y no respondieron (Panel → Comercial).
- Otras ciudades: misma lista y mismo proceso.
