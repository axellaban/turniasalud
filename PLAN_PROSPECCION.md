# Prospección: odontólogos de Mar del Plata y Miramar

Actualizado: 28/10/2026. Estrategia, plan de la semana del 26 al 30/10 (meta: 250 primeros contactos) y cómo usar Panel → Prospección. **No contiene datos de contacto**: la lista se entrega aparte y vive solo en la base de Turnia.

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
| Teléfono fijo | 196 | 139 | **Fuera de la prospección (31/10, pedido del usuario: solo WhatsApp).** No entran en la cola ni cuentan en los números ni en las métricas, aunque se los haya intentado contactar; se ven solo con el filtro «Teléfono fijo». Si alguno abre su demo o responde, vuelve a contar. Para sumarlos hay que conseguirles un celular y cargarlo en su ficha |
| Sin teléfono (Doctoralia, con señales) | 40 | — | Buscar su Instagram desde la ficha |

La cola de «Para hoy» solo trae números con WhatsApp: los 151 celulares (propios y de consultorio). Cuando se terminan, hay que conseguir celulares nuevos (de la web, Google o el Instagram de los fijos y de los que no tienen teléfono) o sumar zonas.

- **Fuentes:** [Círculo Odontológico de Mar del Plata](https://comp.org.ar/listado-de-profesionales/) (392 profesionales con dirección y teléfono; se usaron Mar del Plata, Miramar, Batán, Sierra de los Padres, Otamendi y Santa Clara del Mar) y [Doctoralia](https://www.doctoraliar.com/odontologo/mar-del-plata) (425 perfiles: especialidades, opiniones, agenda online y si pagan la plataforma).
- **Cruce:** apellido y nombre (padres e hijos comparten apellido, dirección y teléfono: cada perfil se asigna a una sola persona) y dirección. De Doctoralia sale cómo se presenta cada uno (Dr. o Dra.); a los demás se los saluda por el nombre, sin adivinar.
- **Celular o fijo:** por cómo está escrito (con 15, o 223 seguido de 3, 5 o 6). Si WhatsApp dice que el número no está, se marca «No tiene WhatsApp» y se sigue por llamada o Instagram.
- **Consultorios con web** (`consultorios-con-web-mdp-miramar.csv`, 26/10, fuera del repo): los del tablero viejo rearmados desde cada web y Páginas Amarillas. Suma 5 dueños de consultorios con web y 8 odontólogos con fijo (5 de Miramar). A 12 que ya estaban les carga la web (su demo pasa a leerla), el nombre real del consultorio y el WhatsApp que publica. Se importa con «Reemplazar los datos de los que ya están por los del archivo» marcado. Afuera: redes y prepagas (siempre decide una administración), webs que ya no existen y un consultorio de 7 odontólogos sin dueño identificable (ProDent: preguntar por WhatsApp quién lo dirige y cargarlo a mano).
- **Los primeros 50 del tablero viejo** (el artefacto de la otra cuenta, con números de consultorios): al abrir el chat, WhatsApp muestra si ya había una conversación. En ese caso, «Ya le había escrito» en vez de mandar: pasa directo al seguimiento.

## Lista 3: Mar del Plata, Miramar y alrededores, sin la lista 1 (268 personas, 02/11)

La que sigue a la lista 1, en la misma zona. Se entrega como `lista-mdp-miramar-nuevos.csv` (fuera del repo) y se importa sin marcar «Reemplazar». Vienen ordenados: primero los celulares, empezando por Mar del Plata.

| Grupo | Personas | Dónde |
|---|---:|---|
| Celular (propio o del consultorio) | 111 | Mar del Plata 64, Necochea 22, Balcarce 8, Pinamar 6 y la Costa. Prioridad 1 (21): celular y señales (atiende por WhatsApp, implantes, ortodoncia o estética, opiniones en Doctoralia) |
| Fijo | 157 | Mar del Plata 97, Balcarce 12, Ayacucho 10, Necochea 9, Pinamar 7, Villa Gesell 7, Miramar 3 |

- **Por qué hay gente nueva en la misma zona:** la lista 1 salió del Círculo Odontológico de Mar del Plata y de Doctoralia. Esta sale de las cartillas de las prepagas, donde están también los que no son socios del Círculo.
- **Fuentes:**
  - Cartillas de OSDE de la filial Mar del Plata (18 planes, PDF públicos en osde.com.ar, vigentes a 2026): 529 odontólogos de la zona, con celular en muchos casos y varios «Solo WhatsApp».
  - [Cartilla de verano 2022 de Swiss Medical](https://www.swissmedical.com.ar/smgnewsite/pdf/prepaga/cartilla_de_verano/2022/cartilla_de_verano_2022.pdf): 133 de la zona. Es vieja: los que solo salen de ahí llevan una nota.
  - [Plantel de odontología del HPC](https://www.hpc.org.ar/odontologia/odontologia/) y [Páginas Amarillas](https://www.paginasamarillas.com.ar) (solo personas, no marcas).
  - Doctoralia de Mar del Plata, Miramar, Santa Clara, Pinamar, Villa Gesell, Necochea y Balcarce, para cruzar.
- **Sin la lista 1:**
  - Afuera los 340 que están en el Círculo de Mar del Plata, por nombre o por número.
  - Afuera los 42 que tienen señales en Doctoralia y no están en el Círculo (los «sin teléfono» de la lista 1).
  - Un número, una fila; cada persona una sola vez aunque esté en varias cartillas (queda dicho en «señales»).
  - No se cruza con los «consultorios con web» ni con los primeros 50 del tablero viejo: si aparece alguno, el panel avisa que el número ya tiene contacto.
- **Miramar casi no suma** (3): sus odontólogos ya estaban todos en el Círculo.
- **Zona:** Mar del Plata, Batán, Sierra de los Padres, Miramar y Otamendi, Mar Chiquita (Santa Clara, Coronel Vidal), Balcarce, Necochea y Quequén, Lobería, Villa Gesell, Pinamar, Madariaga, Maipú, Ayacucho y la Costa. Tandil y Dolores quedaron afuera.

## Lista 2: otras ciudades (Tucumán, La Rioja, Bahía Blanca, La Plata; 1.247 personas, 02/11)

Para cuando se termine la zona de Mar del Plata (lista 3). Se entrega como `lista-odontologos-2-sin-repetidos.csv` (fuera del repo; reemplaza a `lista-odontologos-bahia-laplata-costa.csv`, que no hay que importar) y se importa sin marcar «Reemplazar». Vienen ordenados: primero los celulares.

| Grupo | Personas | Canal |
|---|---:|---|
| Celular (propio o del consultorio) | 518 | WhatsApp. San Miguel de Tucumán 210, La Rioja 121, Bahía Blanca 55, Yerba Buena 28, La Plata 18 y pueblos de esas zonas. Prioridad 1 (27): celular y señales (Doctoralia con opiniones, implantes, ortodoncia o estética, o su WhatsApp publicado) |
| Fijo | 729 | WhatsApp si el fijo lo tiene; si no, llamada o Instagram. Prioridad 3 |

- **Sin repetir:**
  - Afuera todo lo de la zona de Mar del Plata y alrededores (listas 1 y 3), y en el resto cualquiera que coincida con el Círculo de Mar del Plata por número o por nombre: 236 en total. Con la lista 3 no comparte ni números ni nombres.
  - Un número, una fila: cuando varios comparten número (padres e hijos, socios de un consultorio) queda uno solo, y los demás van en las notas. Unidos: 50.
  - La misma persona en dos fuentes (Bahía Blanca: Círculo y guía) queda una vez, con el otro teléfono en «otros teléfonos».
- **Fuentes:**
  - [Círculo Odontológico del Sur](https://www.circuloodontologicodelsur.com.ar/listado-de-nuestros-socios/), de Bahía Blanca: 283 socios con matrícula, dirección y teléfono (Bahía Blanca, Punta Alta, Coronel Suárez, Pringles, Pigüé, Tres Arroyos y pueblos de la zona).
  - [Círculo Odontológico de La Rioja](https://circuloodontologicolr.com.ar/index.php?link=4&ti=1): 207 socios con dirección, mail, y celular («Móvil») en 127.
  - [Padrón odontológico del IPSST](https://ipsst.gov.ar/prestaciones-de-salud/prestaciones-basicas/practicas-ambulatorias/autorizacion-en-linea/odontologia/padron-odontologico/) (obra social provincial de Tucumán): 496 odontólogos con localidad, dirección, teléfono y mail.
  - [Páginas Amarillas](https://www.paginasamarillas.com.ar/buscar/la-plata-buenos-aires/q/odontologos/): «odontólogos» en 26 localidades de la provincia de Buenos Aires. Casi todos son fijos de avisos gratuitos viejos.
  - [Doctoralia](https://www.doctoraliar.com/odontologo/bahia-blanca): solo para cruzar (Dr. o Dra., tratamientos, opiniones, nombre del consultorio). Coinciden 474.
- **Afuera:** prepagas, hospitales, policlínicos, mecánicos dentales, asociaciones, consultorios sin nombre propio con fijo y apellidos sueltos con fijo.
- **Celular o fijo:** con 15 o con 9, o publicado como «Móvil», celular. Si no, por el número local: los fijos empiezan con 4 desde la renumeración. A 331 (casi todos de Tucumán, que escriben 381-5… o 381-6… sin 15) se los marcó celular por el número, con una nota en la ficha. El área sale de cómo está escrito o de la ciudad, porque 298 (General Roca) y 2983 (Tres Arroyos) no se distinguen por los dígitos.
- **Saludo:** el nombre de pila sale de los padrones (con coma entre apellido y nombre) o de Doctoralia; en Tucumán y en la guía, de los nombres conocidos («María del Valle» queda junto). Si no se pudo saber (76, casi todos consultorios; 24 con celular), queda vacío y el panel usa la primera palabra: revisalo antes de mandar.
- **La táctica no cambia**, pero el gancho es el WhatsApp fuera de horario (la temporada solo vale para Monte Hermoso).
- **Quedan por probar:**
  - Santa Fe (1.ª circunscripción) publica [el padrón con los consultorios y su teléfono](https://www.colodont1.org.ar/padron-de-colegiados/) (1.290 colegiados), pero el sitio empezó a devolver error y no se pudo bajar: probar de nuevo, despacio.
  - Salta publica socios con teléfono detrás de una verificación anti-robots.
  - Los círculos de Tandil, Necochea, Balcarce, la Costa y La Plata no publican listado (tienen mail en [FOPBA](https://fopba.org.ar/circulos-y-asociaciones/)).

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

- **Saludo, siempre primero y sin link:** «¡Buenas! ¿Hablo con {saludo}?» (al consultorio: «¡Buenas! ¿Hablo con el consultorio de la Dra. X?»). Que un número desconocido mande un link de entrada es lo que hace que WhatsApp lo bloquee; si la persona responde, el chat ya cuenta como conversación. El saludo no cuenta como uno de los tres mensajes.
- **Presentación a la persona (cuando responde el saludo):** saludo con su nombre, «te armé una demo con tu consultorio», qué hace Sofi en una línea, el link y la salida («si no, avisame y no te escribo más»).
- **Presentación al consultorio:** «Le armé a la Dra. X una demo…», el dolor de la recepción (los mensajes acumulados de la mañana) y el pedido de que se la pasen.
- **Seguimiento (2 días hábiles después):** la temporada y el mismo link.
- **Después de probar la demo:** «¿Llegaste a probarla? ¿Qué te pareció?». Nunca «vi que la abriste».
- **Último (4 días hábiles después):** «¿te la muestro 15 minutos o lo dejamos acá?». Después de tres mensajes no se escribe más.
- **Instagram:** sin link (los pedidos de mensaje con links se filtran); si contesta, le pasás el link.
- **Llamada:** el objetivo es el WhatsApp de la persona que decide.

**Variante si responden poco** (pregunta primero, sin link):

> Hola {saludo}, ¿cómo estás? Soy Axel, de Turnia. Una pregunta rápida: cuando estás atendiendo, ¿quién le contesta el WhatsApp a los pacientes que escriben para pedir turno? Armé una asistente que lo hace sola, con tu agenda. Si querés, te paso una demo con tu consultorio: es un minuto.

## Audios de seguimiento (05/11)

La idea es mandar un audio a cada grupo del funnel de demos de Chapa Labs (`/prospecting/turnia` → Odontólogos). Al 05/11, con «Todo», los grupos son:

- **No abrieron la demo:** 137.
- **La abrieron sin hablar con Sofi:** 26.
- **Hablaron con Sofi:** 12.

Lo decidido, y abajo la herramienta para mandarlos.

**Guiones (15 a 20 segundos; el link va como texto debajo del audio):**

1. **No abrieron la demo:** «Hola Dra. [nombre], soy Axel, de Turnia. Te armé una recepcionista virtual que contesta el WhatsApp de tu consultorio y da turnos cuando estás atendiendo. Ya está lista con tu nombre: tocá el link y escribile como si fueras un paciente. Es un minuto.»
2. **La abrieron sin hablar con Sofi:** «Hola Dra. [nombre], Axel de Turnia. Lo bueno de la demo es escribirle a Sofi: probá mandarle "¿me dan un turno para mañana?" y mirá cómo contesta. Si querés, la probamos juntos en diez minutos.»
3. **Hablaron con Sofi:** «Hola Dra. [nombre], Axel de Turnia. ¿Qué te pareció Sofi? Estoy sumando los primeros consultorios de Mar del Plata como fundadores, con lugares limitados. ¿Lo charlamos 15 minutos esta semana?»

**Reglas que siguen valiendo:**
- El audio cuenta como uno de los tres mensajes.
- No se le escribe a quien pidió la baja.
- Nunca se dice «vi que la abriste».
- Registrar cada envío en el panel, para medir en el funnel qué audio funcionó.

**Grabar una vez y mandarlo a muchos.** Desde la app de WhatsApp no se puede sin que se note:
- Si se reenvía desde otro chat (aunque sea el chat con uno mismo), sale «Reenviado».
- Si se adjunta como archivo, llega como archivo de audio y no como nota de voz.

Como nota de voz nativa solo sale por API: WAHA permite mandar un `.ogg` (Opus) como nota de voz. Condiciones:
- Tiene que salir del mismo número desde el que se prospectó; si no, llega a un chat nuevo. Eso exige conectar ese número a WAHA, escaneando el QR.
- WAHA no es oficial y mandar el mismo audio a muchos expone al bloqueo. Hay que espaciarlo (unos 20 por día, con minutos entre cada uno).
- Una sola grabación no puede decir el nombre: saluda en general, y el nombre y el link van en un texto antes.

**Recomendación que se le dio al usuario:**
- Grupos 2 y 3 (38 personas): grabarlos a mano.
- Grupo 1: una sola grabación por WAHA, o solo texto.
- Hecho como MVP el 05/11: Panel → Prospección → **Mandar audio** (ver abajo).

Respetar las reglas de WAHA de `PENDIENTES.md`: no tocar las instancias existentes.

### Panel → Prospección → Mandar audio (MVP, 05/11)

`/panel/prospeccion/audio`. Código en `src/lib/sales/voice-outreach.ts`; tablas `sales_voice_notes` y `sales_voice_sends`.

- **El audio:** se sube una vez. Lo mejor es grabarlo como nota de voz en el chat con uno mismo, exportarlo y subir el `.opus`/`.ogg`: sale tal cual (`convert: false`). Un `.m4a`, `.mp3` o `.webm` sale con `convert: true`, que depende de que ese WAHA convierta. Por eso primero «Mandármelo» a un número propio (no cuenta en el embudo ni en el tope).
- **A quién:** los tres grupos con las definiciones del embudo (no abrió = sin `opened_at` ni `demo_at`; abrió = `opened_at` sin `demo_at`; habló con Sofi = `demo_at`). Solo «Contactado», con 1 o 2 mensajes, celular y sin baja. Quien respondió se atiende a mano.
- **Cómo sale:** texto opcional antes (`{saludo}`, `{link}`), visto, unos segundos de «grabando audio…» y la nota de voz. De a uno, con una pausa al azar de 3 a 6 minutos que lleva la página (hay que dejar la pestaña abierta). Frena con dos errores seguidos.
- **Límites del servidor:** de 8 a 21 (Buenos Aires), 20 por día, y el mismo audio una sola vez por persona (índice único; un error permite reintentar).
- **Registro:** cada envío suma un mensaje (`recordTouch`, programa el seguimiento), deja la nota «Audio de seguimiento: «nombre»» en la historia y manda `prospect_followup_sent` con `message_format: "audio"` a PostHog.
- **Conexión (la hace el usuario):** una sesión de WAHA **nueva y sin webhooks**, vinculada por QR al WhatsApp con el que se prospectó (queda como dispositivo vinculado; el celular sigue andando). Sin webhooks, porque si no Sofi contestaría los chats personales. En Vercel: `WAHA_PROSPECCION` = `{"url":"https://…","apiKey":"…","session":"…","phone":"549223…"}`. Con `phone`, si la sesión está en otro número no sale nada. No usa `WAHA_URL` ni `WAHA_CONNECTIONS`, ni el selector de canal de Sofi. No tocar `n8n/waha`, `n8n/turnia-waha` ni `n8n/turnia-guerra-mininni-waha`: WAHA Core tiene una sola sesión por instancia, así que hace falta una instancia nueva (pedir autorización antes de crearla).

## Panel → Prospección

- **Para hoy:** tres bloques. «Esperan la demo»: los que saludaste, con «Mandar la demo» para cuando te respondan; viene plegado. «Seguimientos de hoy»: a quienes les mandaste la demo y no respondieron (arriba, quienes la abrieron o probaron). «Nuevos para hoy»: por prioridad, hasta la meta del día (50). Los dos primeros se pliegan y despliegan tocando el título, y el panel recuerda cómo los dejaste. «Saludar por WhatsApp» abre WhatsApp Web (o la app en el celular) con el saludo escrito y queda registrado; ese mismo día pasa a «Esperan la demo». Desde «Mandar la demo» se programa el seguimiento. Si dos personas comparten número, el mensaje sale una sola vez.
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
- Otras ciudades: misma lista y mismo proceso. Hecha la lista 2 (Tucumán, La Rioja, Bahía Blanca, La Plata, 02/11). La zona de Mar del Plata siguió con la lista 3 (cartillas de prepagas).
