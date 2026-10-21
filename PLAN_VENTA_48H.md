# Plan: primera venta de Turnia Salud en 48 horas

> Armado el miércoles 21/10/2026 a la noche (Argentina). La ventana es **hasta el viernes 23/10 a la noche**.
> "Venta" = **plata cobrada** (piloto pago por transferencia o Mercado Pago), no un "me interesa".
> Leer antes: `CONTEXTO_PROYECTO.md` (qué es) y `PLAN_WHATSAPP.md` (cómo se conecta WhatsApp).

## TL;DR

1. **A quién:** clínicas odontológicas (implantes, estética dental) y de medicina estética que **pagan anuncios en Instagram/Facebook que abren un chat de WhatsApp**. Pagan por cada conversación y pierden las que nadie contesta a la noche y el fin de semana. Hoy hay **79 anuncios activos** de implantes y **188** de medicina estética en Argentina con ese formato (Biblioteca de Anuncios de Meta, 21/10/2026). Lista abajo.
2. **Qué vendemos:** un **piloto pago de 30 días**, hecho por nosotros: "Línea de turnos 24/7". Sofi contesta en segundos y da el turno. **$250.000**, con devolución si no agenda 10 turnos. Solo 3 cupos, y es verdad: cada clínica es un deploy y una carga manual.
3. **Cómo:** esta noche, **paciente fantasma**: le escribís por WhatsApp a 30 de esas clínicas a las 22 h y medís cuánto tardan en contestar. Mañana les mandás el dato y la demo. En paralelo, 50 mensajes a tu red pidiendo referidos.
4. **Qué mostramos:** que el dueño **le escriba él mismo** a la línea demo, **cargada con los datos de SU clínica**, y vea aparecer el turno en la agenda en vivo. Después, la cuenta de cuánto le cuesta cada consulta sin respuesta.
5. **Bloqueante técnico:** conectar WhatsApp por WAHA esta noche (README, paso 4a). Si no sale, se vende igual con la demo web en modo chat y los audios.

---

## 1. Diagnóstico honesto: qué podemos mostrar hoy

| Funciona hoy (verificado el 21/10) | Falta o no está probado |
|---|---|
| Web pública con 4 audios de demo generados (inicio, pediatría, clínica médica, gineco) | Faltan los audios de dermatología, gastro y cardio. No hay audio de **odontología ni de estética**, justo los rubros que vamos a atacar |
| `/demo` en modo chat: reserva real que aparece en la agenda (necesita el login del panel) | El prospecto **no puede probarlo solo**: la demo pide la sesión del panel |
| Panel: agenda, conversaciones, tareas, pacientes, campañas, métricas | La voz no se probó en producción |
| Base, 9 herramientas del agente, n8n, `/api/health` en `ok` | **WhatsApp sin conectar** (el código de WAHA está hecho; faltan el chip y las variables) |
| Configuración desde el panel: nombre, profesionales, horarios, prestaciones, precios, coberturas | **Una clínica por deploy**: cada cliente nuevo es un proyecto de Vercel y una base nueva (1 a 2 h) |
| | No hay modo "solo fuera de horario" ni pausa cuando contesta una persona (ver sección 9) |
| | Falta la revisión legal (Ley 25.326) y Zero Retention en ElevenLabs |

**Qué implica:** en 48 h no se vende un SaaS. Se vende un **piloto acompañado, hecho por nosotros**, a 1 a 3 clínicas. El producto alcanza de sobra para eso, y la escasez es real.

---

## 2. El mercado: hotspot, cabeza de playa y victoria rápida

### Qué mercado está hambriento (criterios de Hormozi: dolor, plata, fácil de encontrar, en crecimiento)

| Segmento | Dolor por WhatsApp sin responder | Poder de compra | Fácil de encontrar | Crece | Decide rápido | Total |
|---|---|---|---|---|---|---|
| **Odontología privada (implantes, ortodoncia, estética dental)** | Alto: un implante en clínicas privadas porteñas va de $1,5 a $6 millones | Alto: cobran en dólares, mucho particular | Muy fácil: anuncian, Google Maps, Instagram | Sí | El dueño es el odontólogo | **★★★★★** |
| **Medicina estética** | Muy alto: viven de leads de Instagram que preguntan precio a cualquier hora | Alto: 100 % particular | Muy fácil: 188 anuncios activos | Sí (dispositivos estéticos: 5,5 % a 8,2 % anual según la consultora) | El dueño es la médica | **★★★★★** |
| Kinesiología | Medio: muchas reprogramaciones | Medio-bajo: obras sociales | Fácil | Estable | Rápido | ★★★ |
| Centros multiespecialidad medianos | Alto | Alto | Medio | Estable | **Lento**: varios decisores, integraciones | ★★ (para el mes 2) |
| Psicología, nutrición, consultorio unipersonal | Bajo | Bajo | Fácil | — | Rápido | ★ |

### Hotspot: anuncios que abren un chat de WhatsApp

Una clínica que pone plata en un anuncio con botón "Enviar mensaje" **paga por cada conversación**. Si llega a las 22:40 y la secretaria contesta a las 10 de la mañana siguiente, ese paciente ya le escribió a otras tres clínicas. No hace falta convencerla de que el problema existe: ya lo está pagando. Un estudio general de ventas (MIT/InsideSales, 2008; no es de salud, pero es el que cita todo el sector) encontró que responder en los primeros 5 minutos multiplica las chances frente a hacerlo a la media hora. Una publicación del sector salud reporta un tiempo de respuesta promedio de **2 horas y 5 minutos**.

Además: el ausentismo en consultorios externos en Argentina está entre el **15 % y el 30 %** (UBA/BIOCOM), y los recordatorios por SMS o llamada lo bajan. Ese es el segundo dolor, para la semana 2.

### Cabeza de playa (beachhead)

> **Consultorios y centros de odontología privada y de medicina estética, de 1 a 10 profesionales, que publican anuncios hacia WhatsApp, cobran mayormente particular y llevan la agenda en papel, Google Calendar o en el propio WhatsApp.**

- **Por qué sin software de gestión:** Turnia hoy **es** la agenda y no se integra con Dentalink, AgendaPro ni Doctoralia. Si la clínica ya usa uno, hay doble carga. Para el primer cliente, buscá una sin sistema. Si usa uno, en el piloto Sofi agenda solo en **bloques reservados** (por ejemplo, "evaluaciones de implantes, martes y jueves de 15 a 18") y la secretaria los pasa a su sistema a la mañana.
- **Geografía:** CABA y GBA, para poder ir en persona. Pero el producto es 100 % WhatsApp: una clínica de Rosario o de Tucumán se vende igual por videollamada.
- **Paralelo con Assort:** arrancó en especialidades con mucho volumen de llamadas (traumatología y kinesiología) y después fue a gineco, dermatología y odontología. En Argentina el canal no es el teléfono: es el WhatsApp de la especialidad privada que pauta.

### Victoria rápida (quick-win): "Línea de turnos 24/7"

Un **chip nuevo** con Sofi, que la clínica publica en la bio de Instagram, en Google Maps, en la web y en un anuncio nuevo o duplicado. Así:

- **No toca el número principal** de la clínica: si WhatsApp bloquea el chip, no se pierde nada.
- **No hay integración:** Sofi da turnos en los bloques que le asignan.
- **El primer resultado llega en días:** el primer turno agendado de noche es el "wow" que dispara el testimonio.

### Competencia y precios de referencia

| Quién | Qué | Precio |
|---|---|---|
| **Clinera** (Chile/México, apunta a clínicas estéticas y médicas de LATAM) | Agenda + agente de IA en WhatsApp (AURA) | **USD 279/mes**; con marketing, **USD 529/mes** |
| Turnito (AR) | Reservas online, sin IA | USD 0 a 30/mes |
| AgendaPro | Agenda; plan base en México | MXN 299/mes (no publican el precio en ARS) |
| Doctoralia | Directorio + agenda | ~€69 a 129/mes (estimación de terceros) |
| XIAgenda, Cliengo (AR) | Agente de IA para turnos | Sin precio público |
| **Una recepcionista** (CCT 108/75, consultorios) | 8 h, de lunes a viernes | El básico de la primera categoría (profesionales) es de ~$1,55 millones en octubre 2026; un administrativo cobra algo menos. Con cargas y aguinaldo, **cerca de $2 millones/mes** de costo total (estimación) |

**Conclusión de precio:** entrar **por debajo de Clinera** y muy por debajo de una recepcionista, con piloto de bajo riesgo. Dólar oficial de referencia: ~$1.535 (BNA, 19/10/2026).

---

## 3. La oferta

### Nombre

**"Piloto Fundador: ninguna consulta sin respuesta"**. Recepcionista con IA en WhatsApp, funcionando en 72 horas.

### Qué incluye

| Problema del dueño | Lo que resolvemos | Cómo |
|---|---|---|
| "Me escriben a la noche y el fin de semana y nadie contesta" | **Línea de turnos 24/7** | Sofi contesta en segundos, entiende audios y agenda en la agenda real |
| "No tengo tiempo de configurar nada" | **Configuración hecha por nosotros** | Una llamada de 30 minutos; cargamos profesionales, horarios, prestaciones, precios, coberturas y preguntas frecuentes |
| "¿Y si se equivoca o es una urgencia?" | **Red de seguridad** | Urgencia → 107 y tarea urgente. Lo que Sofi no sabe queda como tarea para la secretaria. Todas las conversaciones se ven en el panel |
| "Los pacientes faltan" | **Confirmaciones automáticas** (bonus) | Recordatorio 24 h antes; si cancela, le ofrece el hueco a la lista de espera |
| "No sé si sirve" | **Reporte semanal** | Consultas atendidas, turnos dados fuera de horario, pesos estimados |
| "Ya perdí pacientes" | **Auditoría del paciente fantasma** (ya entregada, gratis) | Su tiempo de respuesta real, medido |

### Precio

- **Piloto de 30 días: $250.000** (~USD 160), por adelantado. Incluye la configuración y el chip. **Se descuenta del primer mes** si sigue.
- **Después: precio fundador de USD 229/mes** (en pesos al oficial), congelado por 6 meses, hasta 5 profesionales. Precio de lista: USD 299. A cambio: testimonio en video y permiso para usar sus números (anónimos o con nombre, lo que prefiera).
- **Plan B para el que duda (pago por resultado):** $120.000 de configuración + $8.000 por turno que Sofi agenda y el paciente asiste, con tope de $350.000/mes. El panel ya mide los turnos dados por IA.

### Garantía

> **"10 turnos o te devolvemos todo".** Si en 30 días la línea no agenda al menos 10 turnos, te devolvemos los $250.000 y te quedás con la configuración.
> Condición: publicar la línea en la bio de Instagram, en Google Maps y en al menos un anuncio. Sin tráfico no hay turnos, y no lo podemos prometer.

### Escasez (real)

"Tomo **3 clínicas** este mes porque la implementación la hago yo, a mano". Es cierto: cada clínica es un deploy nuevo (una clínica por deploy) y una sesión de WAHA nueva.

### La cuenta para mostrar (con los números de ELLOS)

Preguntá en la llamada y completá en voz alta:

```
Consultas por WhatsApp por mes:                         A (ej.: 300)
% que entra fuera de horario o sin respuesta rápida:    B (ej.: 35 %)
% de esas que hoy se pierden:                           C (ej.: 40 %)
Valor de un paciente nuevo (primer tratamiento):        D (ej.: USD 700; un implante en CABA arranca en ~$1,5 millones)

Pacientes perdidos por mes = A × B × C        (ej.: 42 consultas)
Si Sofi recupera 1 de cada 10 → 4 pacientes × D = USD 2.800/mes
El piloto cuesta USD 160. Con un solo paciente de implantes, se paga 4 veces.
```

Los valores de ejemplo son supuestos; **usá siempre los del prospecto**. No digas "vas a ganar X": decí "con tus números, alcanza con un paciente".

---

## 4. A quién prospectamos (en este orden)

### Nivel 0: tu red (la venta más probable en 48 h)

- Tu odontólogo, tu dermatóloga, tu kinesiólogo, tu médica estética.
- Alumnos y exalumnos del posgrado que sean de salud o tengan un consultorio en la familia.
- La comunidad de A13I, contactos de LinkedIn con "odontólogo", "odontología", "medicina estética", "clínica", "director médico".
- Familia y amigos: "¿quién conoce a alguien con consultorio?".

**Meta:** 40 a 60 nombres esta noche y mensajes mañana a las 9.

### Nivel 1: lista caliente (pautan a WhatsApp hoy)

Sacada de la Biblioteca de Anuncios de Meta el 21/10/2026 (Argentina, anuncios activos). **La ubicación no viene en los datos**: confirmala en la página antes de ir en persona. Los marcados con 📍 dicen la zona en el nombre.

**Odontología**

| Página | Señal | Anuncio |
|---|---|---|
| Dental Sur Quilmes 📍 GBA Sur | 9 anuncios activos, "¡Recuperá tu sonrisa!" | [ver](https://www.facebook.com/ads/library/?id=1670604127830034) |
| Implantes GP | 8+ anuncios, implantes y prótesis fija | [ver](https://www.facebook.com/ads/library/?id=2525290754621867) |
| Star Dental | 4 anuncios a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=4393005697620252) |
| Consultorio dental integral | 3 anuncios "Chateá con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1417951053777776) |
| Implantes Salud | "Turnos inmediatos por WhatsApp" | [ver](https://www.facebook.com/ads/library/?id=1846559306785530) |
| Dental Company 📍 Villa Ballester | "Odontología en Villa Ballester" | [ver](https://www.facebook.com/ads/library/?id=1015322541588878) |
| GabyDent 📍 Hudson | "Turnos disponibles" | [ver](https://www.facebook.com/ads/library/?id=2650072052098810) |
| Odonto Zárate 📍 Zárate | anuncio activo | [ver](https://www.facebook.com/ads/library/?id=1489034259718270) |
| giamed.odontologia | anuncio a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=1145686087995382) |
| Smiles del Sur | "Implantes 3x2" | [ver](https://www.facebook.com/ads/library/?id=2115215642462419) |
| Lea Dental House | "Implantes a costo reducido" | [ver](https://www.facebook.com/ads/library/?id=881601228281649) |
| VF Centro Médico-Odontológico | anuncio a Instagram | [ver](https://www.facebook.com/ads/library/?id=1656786702554976) |
| Odontología Dr. Luis Arévalo | "Chateá con nosotros / Pedí tu turno" | [ver](https://www.facebook.com/ads/library/?id=28320969177597623) |
| JO Dental (Dr. Jamil Ortiz) | "Chateá con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1802041457888942) |
| Neodental | "Chateá con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1076474788577645) |
| RG Odontología Estética | anuncio activo | [ver](https://www.facebook.com/ads/library/?id=1588977486244662) |
| Fix Centro Dental | anuncio activo | [ver](https://www.facebook.com/ads/library/?id=3279530625552922) |
| Dr. Picón Consultorios Odontológicos | anuncio activo | [ver](https://www.facebook.com/ads/library/?id=1358340573112390) |
| Dental Total (cadena: más lenta, más volumen) | "Pedí tu turno ahora" | [ver](https://www.facebook.com/ads/library/?id=1584254166564241) |
| Remotas: Centro Odontológico Fisherton (Rosario), OSM Dental Córdoba, Dental Area Tucumán ("Turnos por WhatsApp"), Maximiliano Bonamin (Neuquén) | anuncios activos | [Fisherton](https://www.facebook.com/ads/library/?id=1121415580398831) · [OSM](https://www.facebook.com/ads/library/?id=2185609252384469) · [Tucumán](https://www.facebook.com/ads/library/?id=1201796125474754) · [Neuquén](https://www.facebook.com/ads/library/?id=3191072657751785) |

**Medicina estética**

| Página | Señal | Anuncio |
|---|---|---|
| Bella Cosmetología Belgrano 📍 CABA | anuncio activo | [ver](https://www.facebook.com/ads/library/?id=1066733363007574) |
| Dr Beauty Ramos Mejía 📍 GBA Oeste | "Reservar cita" | [ver](https://www.facebook.com/ads/library/?id=2137030844354730) |
| Dra. Paula Pelozo, Medicina Estética Personalizada | 4 anuncios nuevos esta semana | [ver](https://www.facebook.com/ads/library/?id=1021094387667552) |
| Dra. Nadia De Cárdenas | 3 anuncios "Chatear con nosotros" | [ver](https://www.facebook.com/ads/library/?id=29336967532561875) |
| GM Medicina Estética | anuncio a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=29694550636812210) |
| Clementi Centro Médico | 2 anuncios a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=1132302845821041) |
| Extetix Medicina Estética Integral | 2 anuncios | [ver](https://www.facebook.com/ads/library/?id=2383299785808803) |
| Dra. Martínez Rivera | anuncio a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=900449579819922) |
| Dra. María Helena Pauli | "Chateá con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1701381418227452) |
| Estética Be | "Chatear con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1683002259858524) |
| Si Medicina Estética | "Escribinos y coordiná tu consulta" | [ver](https://www.facebook.com/ads/library/?id=2316388205793537) |
| Dra. Micaela Urtubey | "Chatear con nosotros" | [ver](https://www.facebook.com/ads/library/?id=1099162159766825) |
| dra.malenamaraschi | anuncio a WhatsApp | [ver](https://www.facebook.com/ads/library/?id=2312467876201869) |
| Macula Medicina Integral | "Agendá hoy" | [ver](https://www.facebook.com/ads/library/?id=1824695398728705) |
| Eireen Medicina Estética | "Endolift, cupos limitados" | [ver](https://www.facebook.com/ads/library/?id=1753133075909372) |
| Dr. Nicolás Ramírez (Comodoro Rivadavia, remota) | 5 anuncios, "Toxina botulínica, agenda abierta" | [ver](https://www.facebook.com/ads/library/?id=1782333196325950) |

Para ampliar: [Biblioteca de Anuncios](https://www.facebook.com/ads/library/), país Argentina, anuncios activos, buscá "implantes", "ortodoncia", "botox", "toxina", "depilación láser", "turnos por WhatsApp".

### Nivel 2: socio que multiplica

**Odental Agency** pauta "SOLO para clínicas dentales" ([anuncio](https://www.facebook.com/ads/library/?id=1588720089274854)). Una agencia que le trae leads a 10 o 20 clínicas quiere que esos leads se conviertan: Sofi le mejora los resultados a su cliente. Ofrecé 20 % recurrente o marca blanca. Es más lento que una clínica, pero un "sí" vale 5 clientes.

### Prioridad dentro de la lista

1. Tiene botón a WhatsApp ("Chateá con nosotros", `api.whatsapp.com`).
2. Muchos anuncios activos o creados esta semana (más gasto, más dolor).
3. **No contestó el paciente fantasma en menos de 1 hora** (es la señal más fuerte).
4. Zona a la que podés ir en persona.

---

## 5. Cómo: las 48 horas, hora por hora

### Miércoles 21/10, noche: preparar

| Hora | Qué | Listo cuando |
|---|---|---|
| 19 a 21 h | **Conectar WhatsApp por WAHA** (README, paso 4a: chip, Custom Channel, variables en Vercel, webhook). Probar 10 conversaciones desde otro celular | Un turno pedido por WhatsApp aparece en la Agenda |
| 21 a 23 h | **Paciente fantasma** a 30 clínicas de la lista (guion C1), desde tu WhatsApp personal | Planilla con clínica, hora de envío y pregunta |
| 22 a 24 h | Lista de tu red: 40 a 60 nombres | Planilla lista |

Si a las 22 h WhatsApp no anda: **no frenes las ventas**. La demo de mañana es `/demo` en modo chat desde tu computadora y el audio de la web. WhatsApp se conecta mañana a la mañana.

### Jueves 22/10: abrir conversaciones

| Hora | Qué | Volumen |
|---|---|---|
| 8 a 9 h | Anotá quién contestó y cuánto tardó | 30 |
| 9 a 11 h | Mensajes a tu red (guiones A y B) | 50 |
| 11 a 13 h | Mandales la auditoría a las clínicas del paciente fantasma (guion C2). DM por Instagram a las que no tienen WhatsApp visible (guion E) | 30 + 20 |
| 13 a 14 h | Publicá el post con los resultados agregados y sin nombres (guion D) | 1 post |
| 14 a 18 h | En persona: 5 a 8 clínicas de la lista en tu zona (guion G) o llamadas | 5 a 8 |
| 18 a 20 h | **Para cada demo de mañana:** cargá en el panel el nombre, los profesionales, las prestaciones, los horarios y las coberturas de la clínica (salen de su Instagram o su web; 20 min cada una) | 1 por demo |

### Viernes 23/10: demos y cobro

| Hora | Qué |
|---|---|
| 9 a 17 h | Demos de 20 minutos (sección 6), en persona o por videollamada. **Cerrá en la llamada** y mandá el link de pago en el momento |
| 17 a 19 h | Seguimiento a cada "lo pienso" (guion F) |
| 19 h | Si hay pago: agendá la carga del lunes 26/10 y comprá el chip. La línea queda funcionando el martes 27/10 |

### Embudo objetivo (regla de 100)

```
100 contactos (50 red + 30 fantasma + 20 Instagram)
 → 20 respuestas
 → 6 demos agendadas
 → 4 demos hechas
 → 1 o 2 pilotos cobrados
```

Son supuestos para tener una vara, no promesas. Si el jueves a las 14 h tenés menos de 8 respuestas, duplicá el volumen (más red, más lista), no cambies de estrategia.

---

## 6. Qué mostramos: demo de 12 minutos

1. **Diagnóstico (2 min).** ¿Cuántos WhatsApp te entran por día? ¿Quién los contesta? ¿Hasta qué hora? ¿Qué pasa el sábado? ¿Cuánto vale un paciente nuevo? ¿Cuánto ponés en anuncios?
2. **El espejo (1 min).** Si pasó por el paciente fantasma: "El miércoles a las 22:10 te pregunté por implantes. Me contestaron a las 11:30 del jueves".
3. **"Escribile vos" (4 min).** Le das el número de la línea demo, que ya **tiene el nombre de su clínica, sus profesionales y sus precios**. Él pide un turno, pregunta el precio y la obra social, y manda un audio. Lo ve aparecer en la **Agenda** en vivo. Después cancela, y Sofi ofrece el hueco a la lista de espera.
4. **El panel (2 min).** La conversación con el resumen, la tarea que quedó para la secretaria y las métricas.
5. **La voz (1 min).** Audio de la web: [inicio](https://turniasalud.vercel.app) o [escuchá a nuestros agentes](https://turniasalud.vercel.app/escucha-a-nuestros-agentes).
6. **La cuenta + oferta + cierre (2 min).** Sección 3.

No muestres: la web completa, la arquitectura ni las 9 herramientas. Mostrá **su clínica atendiendo sola a las 23 h**.

---

## 7. Guiones

> Escribí siempre 1 a 1, a mano, con el nombre de la persona. Nada de envíos masivos desde tu número: si muchos te bloquean o te reportan, WhatsApp te restringe el número.

**A. Tu red: pedido de referidos (Hormozi: no vendas, pedí ayuda)**
> Hola [nombre]! Estoy lanzando una recepcionista con IA que contesta el WhatsApp de consultorios las 24 h y da turnos sola. Busco 3 clínicas para un piloto este mes. ¿Conocés a algún odontólogo o médica estética que pierda pacientes por no llegar a contestar? Si me pasás el contacto, te debo una.

**B. Tu red: a quien ya tiene consultorio**
> Hola [nombre]! Una pregunta rápida: ¿quién te contesta el WhatsApp del consultorio a la noche y el fin de semana? Armé una asistente con IA que da turnos sola en tu agenda, y te la quiero mostrar con tu consultorio ya cargado. Son 15 minutos. ¿Mañana o el viernes?

**C1. Paciente fantasma (miércoles, de 21 a 23 h)**
> Hola! Vi su publicidad. ¿Tienen turno esta semana para una evaluación de implantes? ¿Cuánto sale la consulta?

(Para estética: "¿Cuánto sale la toxina y tienen turno esta semana?"). Reglas: una pregunta real y simple, **no reserves turnos** ni des datos falsos, y contalo en el mensaje siguiente.

**C2. La auditoría (jueves, de 11 a 13 h, al mismo chat)**
> Hola, perdón: la consulta de anoche era mía, para medir algo. Les escribí a 30 clínicas que pautan a WhatsApp a las 22 h; ustedes respondieron [a las 11:30 / no respondieron todavía]. Con lo que cuesta cada mensaje del anuncio, eso es plata que se va.
> Armé una asistente con IA que contesta en segundos, da el turno en tu agenda y te deja todo anotado. ¿Te la muestro 15 minutos con tu clínica ya cargada? Tengo lugar mañana a las [hora] o a las [hora].

Si contestaron rápido: felicitalos y preguntá por el sábado y el domingo ("¿y el fin de semana quién contesta?").

**D. Post en LinkedIn o Instagram (jueves, 13 h)**
> Le escribí por WhatsApp a 30 clínicas que pagan anuncios en Instagram, un miércoles a las 22 h.
> → [X] contestaron en menos de 1 hora.
> → [Y] tardaron más de 10 horas.
> → [Z] todavía no contestaron.
> Están pagando por cada conversación y la pierden mientras duermen. Estoy armando 3 pilotos con una recepcionista con IA que contesta en segundos y da el turno. Si tenés consultorio (o conocés a alguien), escribime.

Sin nombres de clínicas, y con los números reales de tu planilla.

**E. DM por Instagram**
> Hola [Dra./Dr. nombre]! Vi el anuncio de [tratamiento]. ¿Quién les contesta los mensajes que llegan a la noche? Armé una asistente con IA que responde en segundos y da turnos sola. Si querés, te la muestro con tu consultorio cargado, en 15 minutos.

**F. Seguimiento del "lo pienso" (viernes, 17 h)**
> [Nombre], ¿qué te quedó dando vueltas: si funciona, el precio o el momento? Si es si funciona, por eso está la garantía: 10 turnos en 30 días o te devuelvo todo. Me quedan [2] lugares para arrancar el lunes.

**G. En persona (a la recepción)**
> Hola, ¿está el doctor o la doctora? Soy Axel, [tu presentación en una línea]. Traigo algo que contesta el WhatsApp de la clínica cuando ustedes no están. Son 5 minutos, ¿cuándo lo puedo agarrar?

Llevá el celular con la línea demo cargada **con esa clínica**: "Mirá, escribile vos".

### Cierre

Después de la cuenta, preguntá: **"¿Arrancamos?"** Y callate.
- Si dice sí: "Genial. Son $250.000 el piloto de 30 días, con la garantía de los 10 turnos. Te paso el link de Mercado Pago ahora y el lunes hacemos la carga de 30 minutos."
- Cobrá **en la llamada**. "Te transfiero la semana que viene" no es una venta.

### Objeciones

| Objeción | Respuesta |
|---|---|
| "¿Y si contesta cualquier cosa?" | Sofi usa solo lo que vos cargás. Lo que no sabe lo deja como tarea para tu secretaria; las urgencias van al 107. Ves cada conversación en el panel. Y no puede dar dos turnos en el mismo horario: lo impide la base de datos |
| "Ya tengo secretaria" | No la reemplaza: cubre las ~15 horas por día y los fines de semana en que ella no está, y le saca las preguntas repetidas |
| "Uso [Dentalink / AgendaPro / Doctoralia]" | En el piloto Sofi agenda en bloques que vos le reservás y tu secretaria los pasa a la mañana. La integración viene después (decilo así: no está hecha) |
| "Es caro" | Con tus números: un paciente de [implantes] paga [X] meses. Y si en 30 días no te da 10 turnos, te devuelvo todo |
| "¿Me pueden bloquear el WhatsApp?" | Por eso el piloto usa un chip nuevo y no tu número principal. Sofi responde; no manda mensajes masivos. Si funciona, pasamos a la API oficial de Meta |
| "¿Y los datos de mis pacientes?" | Firmamos un acuerdo de confidencialidad. Los datos quedan en una base solo para tu clínica. Las conversaciones pasan por ElevenLabs, el proveedor de la IA. Antes de escalar hacemos la revisión legal y pasamos a una configuración sin retención de datos. (No prometas certificaciones que no tenemos) |
| "Lo tengo que pensar" | Guion F, en la misma llamada |

---

## 8. Reglas para no quemarse

- **No inventes** testimonios, clientes ni métricas, ni en la web ni en el post. El primer testimonio real vale más que diez de mentira.
- **No uses el número principal de la clínica con WAHA** en el piloto. Es una API no oficial y el número se puede bloquear.
- **Nada de campañas masivas** (recall, reactivación) por WAHA a pacientes que no escribieron. Eso es para la API oficial de Meta.
- Antes de cargar datos reales: un **acuerdo de piloto de una página** (alcance, precio, garantía, confidencialidad y que la clínica es la dueña de los datos). Revisión de un abogado antes del segundo cliente.
- **No sobrevendas lo que falta:** voz por teléfono (sin probar), integraciones con sistemas de gestión, fotos de credenciales por WAHA. Decí "eso viene después".

---

## 9. Tareas técnicas que destraban la venta

| # | Tarea | Quién | Tiempo | Para qué |
|---|---|---|---|---|
| 1 | **Conectar WhatsApp por WAHA** (README, paso 4a) | Usuario | 1 a 2 h | La demo "escribile vos". **Bloqueante** |
| 2 | Cargar la clínica del prospecto en el panel antes de cada demo | Usuario | 20 min | Que Sofi hable como SU clínica |
| 3 | Guiones de audio de **odontología** y **medicina estética** (y generar los 3 que faltan) | Claude + panel | 1 h | Prueba para los rubros que atacamos |
| 4 | **Modo "fuera de horario" + pausa cuando contesta una persona** en el webhook de WAHA | Claude | 2 h con tests | Que Sofi atienda el número real de la clínica solo cuando no hay nadie, sin pisar a la secretaria. Es la versión 2 del piloto |
| 5 | Demo pública con límite (sin login, con tope de mensajes) | Claude | 2 h | Que el prospecto la pruebe solo desde un link |
| 6 | Segundo deploy (Vercel + Neon + agente nuevo) para el cliente 1 | Usuario + Claude | 1 a 2 h | Entregar el piloto. Si WAHA es Core, puede necesitar otro contenedor para una segunda sesión |

---

## 10. Después de la primera venta

1. **Semana 1:** que el piloto dé el primer turno nocturno, y sacale captura (con permiso). Es el caso de éxito.
2. **Semana 2:** confirmaciones y lista de espera sobre sus turnos (ausentismo de 15 % a 30 %): el segundo resultado medible.
3. **Semana 3:** pedile 2 referidos ("¿qué colega tuyo está igual?"). Los odontólogos se conocen entre ellos.
4. **Semana 4:** convertir a mensual a precio fundador. Con 2 o 3 casos: agencia socia (nivel 2) y multi-clínica en el código.
5. Medir siempre: consultas atendidas, turnos fuera de horario, tiempo de respuesta y pesos estimados. Son los números del próximo post y de la web (los reales, no los de Assort).

---

## Fuentes

- Assort Health: rondas y primeras especialidades: [TechCrunch](https://techcrunch.com/2025/08/26/assort-health-nabs-50m-to-automate-patient-phone-calls-sources-say), [Fortune](https://www.fortune.com/2025/09/30/exclusive-assort-health-raises-76-million-series-b-to-build-on-voice-ai-healthcare-platform), [Ainora (reseña de terceros)](https://ainora.lt/blog/assort-health-review-alternatives-2026)
- Precios: [Clinera](https://clinera.io/precios), [Turnito](https://www.turnito.com.ar/precios), [AgendaPro (comparativa propia)](https://agendapro.com/blog/mejores-apps-para-agendar-citas-medicas/), [Doctoralia (estimación de terceros)](https://zoftwarehub.com/products/doctoralia/pricing)
- Ausentismo en Argentina: [CAIS 19, UBA/BIOCOM](https://45jaiio.sadio.org.ar/sites/default/files/CAIS-19.pdf)
- Velocidad de respuesta: [CRST Europe](https://crstodayeurope.com/articles/mar-apr-2023/the-need-for-speed-why-response-times-matter/), [Doctible](https://www.doctible.com/blog/speed-to-lead)
- Salarios de sanidad (CCT 108/75): [Econoblog](https://www.econoblog.com.ar/157669/sueldos-de-sanidad-escalas-salariales-de-septiembre-y-octubre-de-2026/), [Blog del Contador](https://blogdelcontador.com.ar/news-46498-paritaria-de-sanidad-nuevas-escalas-y-sumas-no-remunerativas-hasta-enero-de-2027)
- Precios odontológicos en CABA: [RealDentalCosts](https://realdentalcosts.com/es/implantes-dentales/)
- Mercado estético: [Expert Market Research](https://www.expertmarketresearch.com/es/reports/argentina-aesthetic-devices-market), [Mordor Intelligence](https://www.mordorintelligence.ar/industry-reports/argentina-aesthetic-devices-market)
- Dólar: [El Cronista, 19/10/2026](https://www.cronista.com/finanzas-mercados/dolar-hoy-a-cuanto-cotiza-el-oficial-en-los-bancos-de-la-city-hoy-lunes-19-de-octubre/)
- Anuncios activos: Biblioteca de Anuncios de Meta, consulta del 21/10/2026 (búsquedas "implantes dentales turnos whatsapp": 79 resultados; "medicina estética turnos whatsapp": 188).
