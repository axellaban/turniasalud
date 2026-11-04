# Embudo comercial de Turnia (seguimiento semanal)

Definido con el usuario el 1/11/2026. Es el embudo que se sigue cada semana, desde el primer saludo a un odontólogo hasta el cliente que paga. La tabla de abajo se actualiza una vez por semana; las definiciones no se cambian sin acordarlo.

## Las siete etapas

| # | Etapa | Qué cuenta | De dónde sale |
| --- | --- | --- | --- |
| 1 | **Saludos enviados** | Odontólogos a los que se les mandó el saludo sin link («Saludar por WhatsApp»). | PostHog: `prospect_greeting_sent` |
| 2 | **Demos enviadas** | Odontólogos a los que se les mandó el primer mensaje con su demo personal (`/p/<código>`). | PostHog: `prospect_pitch_sent` |
| 3 | **Demos visitadas** | Abrieron su demo personal. No cuenta la vista desde el panel ni el tráfico interno. | PostHog: `personal_demo_viewed` con `preview` = `false` |
| 4 | **Demos con interacción** | Tuvieron **al menos una conversación con Sofi dentro de la demo temporal**, por voz o por chat. | PostHog: `demo_conversation_started` |
| 5 | **Cuentas creadas** | Consultorios con acceso propio al panel: se les creó un código en Panel → Configuración → «Acceso del consultorio» y no se revocó. | Base: `clinic_access` |
| 6 | **Cuentas activas** | Cuentas que esa semana cumplieron el criterio de abajo. | Base: `conversations` y `appointments` |
| 7 | **Clientes pagos** | Consultorios que pagaron al menos un mes. Se registran marcando «Cliente» en Panel → Prospección **cuando entra el primer pago**, no cuando dicen que sí. | Base: `sales_outreach`, estado `cliente` |

### Criterio de cuenta activa

Una cuenta está **activa en una semana** si en esa semana se cumplen las dos condiciones:

1. Sofi atendió al menos a **3 pacientes distintos** de ese consultorio, por WhatsApp, teléfono, Telegram o web.
2. Sofi dio al menos **1 turno**. No cuentan los turnos que el consultorio cargó a mano en el panel.

Por qué este criterio:

- **Se mide lo que se vende.** Turnia es una recepcionista: una cuenta activa es un consultorio donde atiende pacientes de verdad. Entrar al panel o configurarlo no alcanza.
- **No cuentan las pruebas.** Pedir 3 pacientes distintos deja afuera las pruebas del equipo o del odontólogo con su propio celular, que son un solo paciente.
- **Un turno demuestra valor.** Sin turnos, Sofi solo contestó preguntas.

Los umbrales están en `scripts/embudo.mjs` (`ACTIVE_MIN_PATIENTS` y `ACTIVE_MIN_APPOINTMENTS`). Si se cambian, anotarlo acá con la fecha.

## Reglas de conteo

- **Semanas de lunes a domingo**, hora de Buenos Aires. La semana 1 va del lunes 26/10 al domingo 1/11/2026.
- **Cada odontólogo o cuenta cuenta una sola vez**, en la semana en que llegó por primera vez a esa etapa. Así, el total es la suma de las semanas. Si alguien abre su demo dos semanas seguidas, cuenta solo en la primera.
- **Excepción, «Cuentas activas»:** se mide de nuevo cada semana, porque es un estado. En la columna «Total» va el valor de la última semana.
- **Se descuenta lo deshecho:** un saludo o una demo enviada que se deshizo con «Deshacer contacto» no cuenta.
- **No hay corte por cohorte:** una etapa no exige haber pasado por la anterior. Por ejemplo, alguien puede abrir su demo en la semana 2 aunque el mensaje se haya mandado en la 1.
- **Las etapas 5 y 6 cuentan todas las cuentas**, vengan o no de la prospección (por ejemplo, el piloto Guerra–Mininni). Desde el 4/11 existe el vínculo entre la persona y su clínica (`sales_outreach.clinic_id`, acción `account` de `/api/prospeccion`), pero el script todavía no lo usa.

## Cómo actualizar la tabla

Correr el script, que solo lee y no escribe nada:

```bash
POSTHOG_PERSONAL_API_KEY=phx_… DATABASE_URL=postgres://… npm run embudo
```

- **Qué imprime:** la tabla en Markdown con todas las semanas desde la 1. Pegarla abajo y anotar lo que llame la atención.
- **`POSTHOG_PERSONAL_API_KEY`:** clave personal de PostHog. Está en el entorno de las sesiones de Claude.
- **`DATABASE_URL`:** la base de Neon de producción, la misma que usa Vercel. Sin esa variable, las etapas 5 a 7 salen «sin base».
- **Opcionales:** `POSTHOG_PROJECT_ID` (por defecto, 518346) y `POSTHOG_HOST` (por defecto, `https://us.posthog.com`).

**Cuidado con el proyecto de PostHog.** El 518346 se llama «Default project» y lo comparten Loreado y Copiloto, que tienen miles de eventos propios. El script filtra los eventos de Turnia (prospectos `prospecto:<código>`, `app_env` = `production`, sin `is_internal`). Al armar gráficos a mano en PostHog hay que poner los mismos filtros. A la larga conviene mover Turnia a un proyecto propio.

## Tabla semanal

| Etapa | Semana 1 (26/10–1/11) | Total |
| --- | ---: | ---: |
| Saludos enviados | 92 | 92 |
| Demos enviadas | 41 | 41 |
| Demos visitadas | 2 | 2 |
| Demos con interacción | 1 | 1 |
| Cuentas creadas | sin dato | sin dato |
| Cuentas activas | sin dato | sin dato |
| Clientes pagos | 0 | 0 |

### Notas de la semana 1 (al 1/11)

- **Es parcial:** PostHog empezó a medir el viernes 30/10 a las 11:16. Los saludos y demos que se hayan mandado del 26 al 29/10 no están en las filas 1 y 2. El registro completo está en la base (`sales_outreach_events`) y en Panel → Prospección.
- **Saludos y demos:** salieron el 30 y el 31/10. Las 41 demos fueron por WhatsApp: 24 a celulares propios, 12 a celulares de consultorios y 5 a fijos.
- **Demos visitadas (2):**
  - `ache-kthmf` recibió su demo el 31/10 a las 13:04 y la abrió ese día a las 18:20.
  - `barrios-uxd` abrió su link el 30/10 a las 11:36, antes de que PostHog registrara su mensaje. Probablemente se lo mandaron en los días anteriores; si fue una prueba del equipo, restar 1.
- **Interacción (1):** `ache-kthmf` tocó «Probar la demo», pasó al chat y conversó 20 segundos con Sofi, con un mensaje.
- **Cuentas:** sin acceso a la base en esta sesión. Completar con `DATABASE_URL`.
- **Clientes pagos:** 0. Nadie de la prospección respondió todavía: no hay ningún cambio de estado registrado.
- **Fuera de la prospección:** la web tuvo 6 visitantes externos y ninguna demo desde `/probar-demo` ni pedido de demo.

## Pendiente para medir mejor

- **Cuentas en las métricas de Chapa Labs.** `/api/metricas` (`src/lib/sales/metrics.ts`) cuenta clínicas y uso solo donde `is_demo` es falso. Pero las cuentas de los consultorios se crean como clínicas conservadas (`is_demo` = `true`, con `retained_at`): hoy ese tablero no las ve. Habría que contarlas como en `scripts/embudo.mjs`, por su código de acceso.
- **Contar solo las cuentas de la prospección** con `sales_outreach.clinic_id` (existe desde el 4/11), para ver el embudo completo de cada odontólogo y por cohorte de semana de contacto. Ojo: la columna «Cuenta activa» de la planilla de Chapa Labs usa otro criterio (turnos en 30 días) y su embudo pone la cuenta después del cliente; conviene unificarlos con el de este archivo.
- **Eventos de cuenta en PostHog** (`clinic_account_created`, y el primer turno que da Sofi en una cuenta), para que todo el embudo se vea en un solo tablero.
