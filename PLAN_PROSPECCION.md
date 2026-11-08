# Prospección: odontólogos de Mar del Plata y Miramar

Actualizado: 08/11/2026 (lista 4). Estrategia, plan de la semana del 26 al 30/10 (meta: 250 primeros contactos) y cómo usar Panel → Prospección. **No contiene datos de contacto**: la lista se entrega aparte y vive solo en la base de Turnia.

## La táctica, en cinco líneas

1. **A la persona que decide, no a la recepción.** La lista es de odontólogos con nombre propio, no de consultorios. Los primeros 50 se contactaron sobre todo al WhatsApp que cada consultorio publica en su web: ahí contesta la recepción, que no compra y puede sentir que la reemplazan.
2. **Su WhatsApp personal primero.** El listado público del Círculo Odontológico de Mar del Plata da el teléfono que cada odontólogo publica para sus pacientes: 139 tienen un celular propio (137 números). A esos se les escribe directo.
3. **La demo es el mensaje.** Cada uno tiene su link (`/p/<código>`). La vista previa de WhatsApp muestra **el nombre de su consultorio** en un chat, y al abrirlo cae en una sola pantalla: la esfera de Sofi que le pide que le hable como si fuera un paciente (el chat, arriba a la derecha) y la ficha de su consultorio abajo. Sofi lo atiende como su recepción y da turnos con **su nombre**. Es el «esto es para mí» que separa un mensaje de un spam.
   - **Qué sabe Sofi en esa demo:** su consultorio, su dirección, su nombre como profesional y, en los 208 que figuran en Doctoralia, **sus tratamientos** (implantes, ortodoncia, estética, endodoncia, odontopediatría, prótesis, periodoncia, cirugía): suman su turno de primera vez y el ejemplo de su página y de la vista previa es sobre su tratamiento principal. Horario de ejemplo (lunes a viernes de 9 a 18); precios y obras sociales no los sabe y lo dice.
   - **Con web:** desde el 07/11 la demo de su link no lee la web (tardaba alrededor de un minuto): se arma al tocar la esfera con los datos de su ficha. Hoy ninguno de la lista tiene web cargada.
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

## Lista 4: alrededores de Mar del Plata, con los que pagan anuncios primero (258 personas, 08/11)

Para la semana del 9/11, cuando a la base le quedaban 10 celulares sin contactar. Se entrega como `lista-4-alrededores-mdp.csv` (fuera del repo) y se importa en Panel → Prospección → Importar lista, **sin marcar «Reemplazar»**. No repite a nadie de las 709 personas que ya estaban en la base (listas 1 y 3 y consultorios con web): se cruzó por cada teléfono, por nombre y por apellido con la misma inicial en la misma ciudad.

| Grupo | Personas | Dónde |
|---|---:|---|
| Con WhatsApp, alrededores | 117 | Tandil 53, Necochea 21, la Costa 24 (Santa Teresita, San Bernardo, Mar de Ajó, San Clemente, Mar del Tuyú, Las Toninas), Pinamar y Villa Gesell 14, Chapadmalal, Balcarce, Maipú, Dolores |
| Con WhatsApp, Mar del Plata | 37 | Consultorios que no estaban en las listas 1 y 3 (salen de Google Maps). Van con prioridad 3, después de los alrededores, salvo los 5 que pautan en Instagram y Facebook (prioridad 1) |
| Fijos | 104 | Tandil 29, Necochea 22, Mar del Plata 13, Villa Gesell 8, Pinamar 7 y otros. Quedan fuera de la cola, como siempre |

- **Prioridad 1 (14 con WhatsApp):** los que pagan anuncios y los que muestran más inversión. Cinco hacen **Google Ads** confirmado en el [Centro de Transparencia de Anuncios de Google](https://adstransparency.google.com/?region=AR) (anuncios vistos en la Argentina entre junio y noviembre de 2026): cuatro por el dominio de su web y uno por el texto del anuncio. Seis pautan en Instagram y Facebook ([Biblioteca de Anuncios de Meta](https://www.facebook.com/ads/library/)): cinco en Mar del Plata y uno en Tandil (y un fijo más de Mar del Plata). En «Señales» queda la fecha del último anuncio, y en Chapa Labs llevan la marca «Google Ads» o «Meta Ads» y van primeros entre los nuevos.
- **Cómo se confirmó Google Ads:** coincidir el nombre no alcanza. Buscando por nombre aparecieron homónimos que anuncian otras cosas, así que se miró cada anuncio. Solo cuenta si el anuncio lleva a su web o si dice su nombre y «odontología».
- **Fuentes:**
  - Google Maps, unas 260 búsquedas por localidad y especialidad (sin sesión, Maps muestra hasta 20 resultados por búsqueda). De ahí salen la web, el Instagram y el WhatsApp que publica cada web.
  - Cartillas de OSDE de la filial Buenos Aires Centro (Tandil), PDF públicos con vigencia al 07/11/2026, con el celular propio de muchos odontólogos.
  - [Cartilla de OSPUNCPBA](https://www.ospuncpba.com.ar/) (obra social de la UNICEN): odontólogos de Tandil y Necochea con teléfono.
- **Celular o fijo:** es celular si viene con 9 o con 15, si está en el link de WhatsApp de su web, o si el número local empieza con 3, 5 o 6. En Tandil (249), los celulares de las cartillas empiezan con 40 a 42, 45 a 47 o 449, y los fijos con 43 o 440 a 448. A 17 se los marcó celular solo por eso, con una nota en la ficha: si WhatsApp dice que el número no existe, «No tiene WhatsApp». Ojo: Maps muestra muchos celulares sin el 9. Por ejemplo, alguien que publica «0223-15-448-…» aparece en Maps como «+54 223 448-…». Por eso algunos «fijos» pueden tener WhatsApp.
- **Sin nombre del odontólogo (55 con WhatsApp):** el saludo va al consultorio («¿Hablo con el consultorio de …?») y la nota dice que, si responde, hay que preguntar quién lo dirige. Los que tienen nombre genérico en Google («Consultorio Odontológico») van con prioridad 3 y una nota para cambiar el saludo antes de mandar.
- **Afuera:** el Círculo Odontológico de Balcarce, mecánicos dentales, laboratorios, hospitales y centros de salud. También dos marcas de una misma clínica que pauta en Google e Instagram, que es de alguien que ya estaba en la base (va en el recontacto, abajo), Benito Juárez (queda lejos) y la cartilla de IOMA (casi no publica odontólogos).
- **En Chapa Labs:** la planilla de Turnia no tiene columna «Lista», así que Chapa la toma de «Fuente», que empieza con «Lista 4». Se puede filtrar en «Por segmento → Lista» y buscar «lista 4».

## Volver a hablarles a los que pagan anuncios (Mar del Plata y Miramar, 08/11)

Se entrega como `recontactar-ads-mdp-miramar.csv` (fuera del repo). Son los de la base de Mar del Plata y Miramar que **pagan anuncios**: 11 en total, 10 ya contactados. Quien paga por cada consulta es el más interesado en no perder las que llegan fuera de horario.

- **Cómo se buscaron:**
  - El [Centro de Transparencia de Anuncios de Google](https://adstransparency.google.com/?region=AR), por el dominio de cada web conocida (de la ficha o de Google Maps, cruzada por teléfono).
  - La [Biblioteca de Anuncios de Meta](https://www.facebook.com/ads/library/), por palabras («odontología», «dentista», «implantes», «ortodoncia» con Mar del Plata y Miramar), cruzando las páginas con la base.
  - En sus webs, la etiqueta de conversiones de Google Ads y el píxel de Meta.
  - No se cuentan los anuncios de una clínica o una red donde la persona solo atiende (por ejemplo, un sanatorio).
- **Qué hay:** 4 con Google Ads (uno, además, en Instagram), 5 con anuncios en Instagram y Facebook (varios son anuncios «Chateá con nosotros» que llevan a su WhatsApp) y 2 que solo tienen la etiqueta o el píxel en su web. Por estado: 5 saludados sin respuesta, 5 con la demo enviada (3 ya usaron los tres WhatsApp) y 1 por contactar.
- **Qué falta:** buscarlos también por el nombre del anunciante verificado. Google frenó esas consultas por exceso de pedidos y no se pudo hacer ninguna; queda para cuando lo permita.
- **El ángulo:** «ya pagás por cada consulta; las que llegan a la noche o el finde se enfrían hasta que alguien contesta». No es un cuarto WhatsApp: a quien ya usó los tres, se le habla por otro canal (llamada, Instagram de su consultorio, email o visita). La columna «otros_canales» trae el Instagram, el email o el WhatsApp de su web.
- **Marcarlos en el panel:** `marcar-ads-en-turnia.csv` (código, nombre y señales) se importa en Panel → Prospección → Importar lista **con «Reemplazar» marcado**. Solo cambia «Señales»: queda «Hace Google Ads» o «Hace anuncios en Instagram y Facebook» con la fecha, delante de lo que ya decía. En Chapa Labs aparecen con la marca y se encuentran buscando «ads».

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

**Audios a mano (06/11):** en Chapa Labs (`/prospecting/turnia?vista=odontologos`), el botón «🎤 Audio» de cada fila registra que le mandaste un audio desde tu celular. Cuenta como uno de los tres mensajes, salvo que ese día ya hayas registrado un mensaje (el texto y el audio que salen juntos son uno solo). Queda la nota «Audio de seguimiento (a mano)» y la fecha en la columna «Audio enviado» de la planilla. API: `POST /api/prospeccion` con `{ type: "sent", channel: "whatsapp", format: "audio" }`.

### Panel → Prospección → Mandar audio (MVP, 05/11)

`/panel/prospeccion/audio`. Código en `src/lib/sales/voice-outreach.ts`; tablas `sales_voice_notes` y `sales_voice_sends`.

- **El audio:** se sube una vez. Lo mejor es grabarlo como nota de voz en el chat con uno mismo, exportarlo y subir el `.opus`/`.ogg`: sale tal cual (`convert: false`). Un `.m4a`, `.mp3` o `.webm` sale con `convert: true`, que depende de que ese WAHA convierta. Por eso primero «Mandármelo» a un número propio (no cuenta en el embudo ni en el tope).
- **A quién:** los tres grupos con las definiciones del embudo (no abrió = sin `opened_at` ni `demo_at`; abrió = `opened_at` sin `demo_at`; habló con Sofi = `demo_at`). Solo «Contactado», con 1 o 2 mensajes, celular y sin baja. Quien respondió se atiende a mano.
- **Cómo sale:** texto opcional antes (`{saludo}`, `{link}`), visto, unos segundos de «grabando audio…» y la nota de voz. De a uno, con una pausa al azar de 3 a 6 minutos que lleva la página (hay que dejar la pestaña abierta). Frena con dos errores seguidos.
- **Reglas desde Chapa (07/11).** En «Mandar audios → Reglas de envío» se editan el cupo diario compartido, los contactos por tanda y las pausas mínima y máxima. Valores iniciales de 20 por día, 5 por tanda y 3 a 6 minutos. El cupo puede aumentarse desde el panel. Turnia guarda los ajustes en la base y aplica el cupo y la pausa mínima al reservar cada envío. Horario de 8 a 21 h de Buenos Aires. La misma nota queda reservada por contacto o teléfono para evitar duplicados.
- **Registro:** cada envío suma un mensaje (`recordTouch`, programa el seguimiento), deja la nota «Audio de seguimiento: «nombre»» en la historia y manda `prospect_followup_sent` con `message_format: "audio"` a PostHog.
- **Conexión (06/11):** se reutilizó `n8n/waha`, sesión `default`, vinculada al 0022 y sin webhooks. La variable de Production `WAHA_PROSPECCION` contiene `url`, `apiKey`, `session` y `phone`. El envío requiere coincidencia con `phone`. Para la prueba usar el 5483, donde ya se recibió una nota de voz nativa. Las sesiones de las clínicas se administran por separado.
- **Chapa Labs → Turnia → Odontólogos:** «Mandar audios» se autoriza con una sesión administradora de Turnia. Las etapas usan las mismas definiciones y el mismo cupo que el panel de Turnia. La elección del audio por etapa queda en el navegador. Se puede grabar o subir un archivo y escuchar el audio. Las grabaciones se guardan en formato Ogg/Opus para enviar la nota nativa. Los destinatarios se eligen a mano según el número con el que se inició cada chat. «Buscar sus chats» (`action: "detect"`, `syncVoiceSendersFromWaha`) lee `/api/{session}/chats` del WAHA emisor (los `@lid` se resuelven con `/lids`) y marca esa línea a cada contacto que tiene chat ahí, sin mandar nada. Con NOWEB necesita el historial (store) prendido en la sesión; si no, avisa y queda la confirmación a mano.

## Después de la demo: «Escribirle a Axel» (05/11)

Hasta el 05/11, al terminar la charla con Sofi solo aparecía «Conversación terminada.»: de 8 personas que hablaron con Sofi, ninguna pidió una llamada desde la demo. Lo que se cambió, con los datos de PostHog del 30/10 al 05/11:

- **Cierre de cada charla:** cuando termina una conversación en la que Sofi contestó (la corte la persona, Sofi o el tiempo), aparece en el chat una nota de Axel: «{Nombre}, ¿la dejamos atendiendo en {consultorio}?», con un solo botón, **Escribirle a Axel**. Abre el WhatsApp de Axel (+54 9 11 3023-5483, en `src/lib/sales/contacto-axel.ts`) con el mensaje escrito. Volver a llamar o escribir sigue a mano, en segundo plano.
- **Sofi entrega la posta:** en la demo del navegador, al final (después del turno de prueba o al despedirse) dice una vez «Esto fue la demo… tocá Escribirle a Axel en la pantalla». En las demos por WhatsApp o Telegram sigue «el equipo lo va a contactar».
- **Su página es una sola (desde el 07/11):** `/p/<código>` es la esfera de Sofi, el chat arriba a la derecha y la ficha de su consultorio abajo, antes y después de hablar con Sofi. «Escribirle a Axel» aparece al terminar cada charla y en la ficha («¿Preferís que te la muestre yo?»). Si la demo está pausada, al tocar la esfera aparece el aviso con el botón. Hasta el 07/11 había dos versiones: «Probar la demo» antes y «¿dejamos a Sofi atendiendo…?» después.
- **Voz en el celular, chat en la computadora:** en el celular 3 de 5 eligieron voz (y la única que respondió usó voz); desde la computadora los 3 pasaron al chat en segundos. Sin micrófono (permiso denegado), pasa sola al chat en vez de mostrar un error.
- **Sin caminos que compitan:** `/p/<código>` no tiene menú ni pie, solo el logo. En la demo ya armada de `/probar-demo`, el header no muestra «Pedí una demo» ni «Probá con tu web», y la página no cierra con el bloque «¿Listo para transformar…?».
- **En la ficha:** cada toque en «Escribirle a Axel» queda en su historia («Tocó «Escribirle a Axel» · WhatsApp · al terminar la demo») y su seguimiento pasa a hoy, aunque no haya mandado el mensaje. Uno cada 6 horas.
- **«Hablaron con Sofi» = conversaron:** la herramienta de audios usa la misma definición que Chapa Labs (`conversoSql` en `outreach.ts`: una conversación en la clínica de su demo en la que **la persona escribió o habló**), no el toque en «Probar la demo». Desde el 06/11 no cuenta la conversación que solo tiene el saludo de Sofi (abrió la llamada o el chat y se fue sin decir nada): antes contaba y marcaba «Interactuó» a quien no había interactuado.

Qué mirar: `demo_closing_viewed` → `cta_clicked` con `cta_id = talk_axel` (por `cta_location`) → respuestas en el WhatsApp de Axel.

## Panel → Prospección

- **Para hoy:** tres bloques. «Esperan la demo»: los que saludaste, con «Mandar la demo» para cuando te respondan; viene plegado. «Seguimientos de hoy»: a quienes les mandaste la demo y no respondieron (arriba, quienes la abrieron o probaron). «Nuevos para hoy»: por prioridad, hasta la meta del día (50). Los dos primeros se pliegan y despliegan tocando el título, y el panel recuerda cómo los dejaste. «Saludar por WhatsApp» abre WhatsApp Web (o la app en el celular) con el saludo escrito y queda registrado; ese mismo día pasa a «Esperan la demo». Desde «Mandar la demo» se programa el seguimiento. Si dos personas comparten número, el mensaje sale una sola vez.
- **Esperando respuesta**, **Interesados** (respondieron, abrieron o probaron su demo) y **Todos**, con filtros por zona, canal, estado y búsqueda.
- **Ficha:** el mensaje que toca, Instagram (copia el mensaje y abre el chat), llamada con guion, «Lo visité», estados, datos editables (saludo, consultorio, teléfono y de quién es —celular de la persona, celular del consultorio o fijo—, Instagram, web), notas e historia. «Buscar su Instagram» y «Buscar en Google» abren la búsqueda armada.
- **Google Sheets:** con «Conectar con Google», la prospección y los pedidos de demo quedan en una planilla de tu Drive que se actualiza sola con cada cambio (`GOOGLE_SHEETS.md`).
- **Importar de nuevo:** sin marcar nada, a los que ya están solo se les completa lo que falta. Con «Reemplazar los datos de los que ya están por los del archivo», lo que trae el archivo pisa lo cargado (nunca el nombre, el estado ni los contactos).
- **Deshacer contacto:** si tocaste WhatsApp para probar (o abriste el chat y no mandaste), «Deshacer contacto» borra ese último mensaje, llamada o visita; sin contactos, vuelve a «Por contactar» y no cuenta para la meta.
- **Su demo:** «Ver lo que recibe» abre la página como la ve el odontólogo, sin contar como visita. Cuando él la abre o la prueba, queda en la ficha y el seguimiento pasa a hoy. Si la prueba, también aparece en Pedidos de demo.
- **Estados:** Respondió, Reunión, Cliente, No le interesa, No tiene WhatsApp y **Pidió no recibir más**, que lo saca para siempre (también de las llamadas de Sofi).

## Panel → Follow-up (07/11, traído de habita.)

Una **next best action** por cada etapa del embudo de [`EMBUDO.md`](EMBUDO.md), con versiones medidas para ir mejorando los mensajes con datos. Está en el menú del equipo, debajo de Prospección.

| Etapa | Quiénes | Convierte cuando… |
| --- | --- | --- |
| Sin saludar | Por contactar, con celular, sin baja y sin que otro del mismo número ya haya recibido el mensaje (como «Para hoy») | se le manda el saludo |
| Saludado, sin demo | Recibieron el saludo, todavía sin la demo | se le manda la demo |
| Demo enviada, sin abrir | Recibieron su demo `/p/<código>` y no la abrieron | la abre |
| Abrió la demo, sin conversar con Sofi | La abrieron y no hablaron ni escribieron en la demo | conversa con Sofi |
| Conversó con Sofi, sin cuenta | Conversaron, sin acceso propio al panel | tiene un código de «Acceso del consultorio» sin revocar |
| Cuenta creada, sin actividad | Con cuenta, sin el criterio de cuenta activa en esta semana (3 pacientes y 1 turno de Sofi) | queda activa |
| Cuenta activa, sin pago | Activas, todavía no en «Cliente» | pasa a Cliente |

Cada persona está en su paso más alto; no se exige haber pasado por el anterior, como en `EMBUDO.md`. Quedan afuera los cerrados (No le interesa, No tiene WhatsApp, Pidió no recibir más), los que tienen la baja, los fijos sin respuesta y los clientes.

- **Versiones:** texto (con las variables de Prospección y `{panel}`), canal (WhatsApp o tarea), cuándo se dispara y los call to actions (Abrir WhatsApp, Link demo, Link panel, Copiar mensaje). Una versión guardada no se edita ni se borra: cambiar algo crea la siguiente. Por etapa hay una activa y, como mucho, una a prueba: la recibe la mitad de las personas de la etapa, siempre la misma mitad. La V1 de las tres primeras etapas es el mensaje de fábrica de Prospección.
- **Ejecutar:** arma el mensaje para esa persona. «Abrir WhatsApp con el mensaje» abre WhatsApp Web (o la app en el celular). «Confirmar envío» cuenta la ejecución y abre a la siguiente. «No se envió» pide el motivo y no cuenta.
- **Qué registra:** en las tres primeras etapas, confirmar es el mismo contacto que en Prospección (`recordTouch`: saludo, demo o seguimiento, con sus eventos de PostHog y el límite de tres mensajes), así que cuenta igual en `npm run embudo`. En las etapas siguientes queda como nota en su historia.
- **Números:** por versión, ejecuciones (envíos confirmados, una vez por persona), conversiones (hoy está en un paso más alto que al recibirla, sin plazo) y tasa. Con menos de 30 ejecuciones dice «muestra chica».
- **Extensión:** las franjas tienen `data-testid="followup-stage"` (con `data-stage`) y cada persona `data-testid="followup-item"` (con `data-outreach`, `data-status` y `data-version`). Los botones son `followup-execute`, `followup-message`, `followup-open`, `followup-confirm`, `followup-failed`, `followup-failed-reason`, `followup-failed-save`, `followup-link-demo` y `followup-link-panel`.
- **Datos:** `sales_followup_versions` y `sales_followup_executions` en `supabase/schema.sql`; la lógica, en `src/lib/sales/followup-stages.ts` (pura) y `src/lib/sales/followup.ts`.
- **habita.:** lo mismo en amoblaia, `/admin/follow-up` (`docs/FOLLOWUP.md`). En Chapa Labs no hay Follow-up para ninguna de las dos unidades.

## Cuando responde

Lo que se promete al terminar la demo («{Nombre}, escribime y en 15 minutos probamos a Sofi, sin costo, con los horarios, tratamientos y obras sociales de tu centro», desde el 07/11) es esto: probarla con sus horarios, sus tratamientos y sus casos. **No** se promete su agenda real: si usa papel o un software que no integramos (Dentalink, Doctoralia), eso se resuelve en el setup.

1. **Pedile los datos por WhatsApp y cerrá el horario** (copiar y pegar):

   > ¡Genial, {nombre}! Para mostrarte a Sofi con tu consultorio, pasame:
   > 1. Días y horarios de atención (si son varios profesionales, los de cada uno).
   > 2. Los tratamientos que más te piden y cuánto dura cada turno (por ejemplo, consulta 30 min, limpieza 45).
   > 3. Obras sociales y prepagas que tomás, o si es solo particular.
   > 4. ¿Cómo llevás hoy la agenda? (papel, Google Calendar, un sistema…)
   >
   > ¿Te queda bien {día} a las {hora}? Son 15 minutos, por videollamada o paso por el consultorio.

   Si no contesta todo, alcanza con los horarios: el resto sale de la plantilla odontológica.

2. **Antes de la reunión (10 minutos, en el panel):**
   - Clínicas → buscá la demo que armó desde su link (sale con el nombre de su consultorio) → «Abrir configuración» → «Conservar esta demo». Si no armó ninguna: «+ Crear una clínica manualmente», especialidad Odontología (carga sola las prestaciones de la plantilla).
   - Configuración → Equipo y horarios (sus profesionales y horarios), Prestaciones (ajustá las duraciones que te pasó) y Coberturas.
   - Probar a Sofi → «Preparar el enlace» de WhatsApp: tené el QR a mano.

3. **En la reunión (15 minutos):**
   - 2 min: cuántos WhatsApp le entran fuera de horario y quién los contesta hoy.
   - 5 min: escanea el QR y le escribe a Sofi desde su celular, como un paciente («¿me das un turno para el jueves?», «¿atienden por OSDE?»). Ve que ofrece **sus** horarios y **sus** tratamientos, y el turno aparece en la Agenda del panel.
   - 3 min: la cuenta con sus números (cuánto vale un paciente nuevo y cuántos se pierden de noche).
   - 5 min: próximo paso. Programa Fundadores: queda operativa en 14 días (si no, se devuelve el setup); en el setup se conecta su WhatsApp y, si usa Google Calendar, su agenda. Oferta vigente: sin cotizar antes de la charla (`COMERCIAL_AGUSTIN.md`).

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
