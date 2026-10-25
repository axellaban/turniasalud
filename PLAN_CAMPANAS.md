# Turnia Activa — campañas para activar la base de pacientes

Actualizado: 25/10/2026. Qué es Panel → Campañas, qué se decidió sobre el CRM, qué quedó hecho en la versión 1 y qué sigue. No contiene credenciales.

## Referencia: Activate de Assort

- Assort lanzó **Activate** (su producto saliente) en mayo de 2026, como segunda línea junto a la atención entrante. Cubre controles y prevención (care gaps), reactivación de inactivos, ausentes y cancelaciones con relleno desde la lista de espera, derivaciones pendientes y cobranzas.
- **No usa un CRM aparte:** la fuente es el sistema clínico de cada consultorio (EHR/PM), con integraciones que detectan los eventos y escriben el resultado de vuelta. Arranca por llamada y sigue por SMS y email, con varios contactos por paciente.
- No hay datos públicos de cuánto factura cada producto. Lo que publican son casos de clientes autorreportados. **No usar esas cifras como propias** (regla del proyecto: no inventar métricas).

## Decisión: ¿CRM?

- **No se integra un CRM de ventas** (HubSpot, Salesforce). Para la clínica, el «CRM» es Turnia: la ficha del paciente (memoria, baja, próximo control), su historial, las campañas y las conversaciones.
- La base de pacientes entra por tres caminos:
  1. La agenda de Turnia: los turnos atendidos.
  2. **Importación desde Excel o CSV** (versión 1): lo que exporta el sistema que la clínica ya usa, o su planilla.
  3. Más adelante, conectores con los sistemas de gestión locales (Dentalink, Medilink, AgendaPro, Doctoralia u otros; falta investigar sus APIs). Leen pacientes y turnos y devuelven el resultado. Es el equivalente a las integraciones con EHR de Assort, y la ventaja difícil de copiar.
- El seguimiento comercial de Turnia (pedidos de demo, Comercial) es otra cosa y ya existe en el panel.

## Versión 1 (hecha el 25/10/2026)

**Panel → Campañas**

- Arriba, «Tu base para volver a agendar»: pacientes únicos con algo pendiente y el valor estimado según los precios de referencia de cada prestación. Al lado, el tamaño de la base y la invitación a importar.
- Oportunidades para volver a agendar, cada una con su cantidad, su valor y el botón «Revisar y enviar»:
  - controles vencidos;
  - pacientes inactivos;
  - faltaron y no volvieron;
  - lista de espera.
- «Del día a día»: recordatorios de mañana y encuesta post-consulta.
- «Controles periódicos»: cada prestación con su frecuencia (mensual, trimestral, semestral, anual…). Se guarda al elegirla y muestra cuántos pacientes tienen el control vencido.
- «Reglas de contacto»: a partir de cuántos meses sin venir un paciente cuenta como inactivo (12 por defecto). También el tope de mensajes por paciente entre campañas de controles, inactivos y ausentes (uno por mes por defecto; recordatorios y lista de espera no cuentan).
- Historial de campañas con su embudo: enviados, respondieron, sacaron turno y valor.
- «Aviso a todos» para novedades (vacaciones, cambio de horario).

**Una campaña** (`/panel/campanas/[id]`)

- La lista queda guardada al crearla. Se puede quitar a alguien, volver a sumarlo o actualizar la lista (suma a quien ahora cumple y saca a quien ya no).
- **Desde tu WhatsApp:** «Abrir chat» abre WhatsApp Web (o la app en el celular) con el mensaje escrito y el paciente queda marcado como enviado. El botón grande va al siguiente de la lista. Sin integraciones, desde el número que el paciente ya conoce.
- **Con Sofi, automático:** de a 50, con pausas, por Meta o WAHA. Requiere WhatsApp conectado a Sofi (hoy pausado). Antes de cada envío se vuelve a comprobar que el paciente siga cumpliendo.
- Mensaje editable con `{nombre}` y `{detalle}`, lo que tiene que lograr Sofi si responde y una vista previa del mensaje como burbuja de WhatsApp. Por el WhatsApp oficial se sigue usando el template aprobado.
- Resultados: un turno sacado después del mensaje cuenta para la campaña, se haya sacado con Sofi, en el panel o por teléfono, con su valor de referencia y si el paciente vino.

**Pacientes**

- Importación (`/panel/pacientes/importar`):
  - Se pegan celdas de Excel o Google Sheets, o se sube un CSV (UTF-8 o Windows-1252).
  - Las columnas se reconocen por su título y se pueden corregir. Hay vista previa y una lista de las filas con problemas.
  - Sirve con una fila por paciente o una fila por visita.
  - Une cada prestación con las de la clínica. Las fichas que ya existían solo completan los datos que les faltan.
  - Pide confirmar que se puede escribir a esos pacientes y se puede deshacer.
  - Hay una planilla de ejemplo en `public/plantilla-pacientes.csv`.
- En la ficha del paciente: «Próximo control» (fecha y motivo), indicado por el profesional, y las visitas importadas.

**Código**

- Audiencias, oportunidades, lista guardada, envíos y resultados: `src/lib/campaigns.ts`.
- Lectura de planillas, compartida entre navegador y servidor: `src/lib/patient-import.ts`.
- Acciones: `src/app/panel/campaign-actions.ts`.
- Tablas nuevas: `patient_imports` y `patient_visits`. Columnas nuevas:
  - `patients.next_control_at`, `next_control_reason` e `import_id`;
  - `clinics.reactivation_months` y `contact_cooldown_days`;
  - `campaigns.message`;
  - `campaign_recipients.detail`, `context`, `value`, `manual` y `created_at`, más el estado `excluido`.
- Pruebas: `src/lib/patient-import.test.ts` y `src/test/campaigns.integration.test.ts`.

**Perfiles de demo:** se puede importar y armar campañas para mostrar la lista y el mensaje. Sofi no envía nada. Abrir el chat desde el panel sí funciona, porque lo manda una persona desde su WhatsApp.

## Qué sigue (versión 2)

1. **Secuencias:** si no responde en unos días, un segundo mensaje y después una llamada de Sofi. Twilio ya está configurado; las llamadas se hacen solo con autorización.
2. **Respuestas de lo enviado a mano:** marcar «Respondió», «No le interesa» o «Pidió la baja» desde la lista, porque esas respuestas llegan al WhatsApp de la clínica y no a Sofi.
3. **Automáticas por clínica:** un interruptor en el panel por tipo de campaña. Hoy las programa un workflow de n8n global y desactivado.
4. **Segmentos preventivos por edad y sexo** (mamografía anual, antigripal, chequeo por edad). Falta el sexo en la ficha.
5. **Órdenes y derivaciones pendientes:** las tareas `orden_medica` sin turno, como campaña.
6. Ventanas horarias de envío y prueba A/B del mensaje.
7. Versión 3: conectores con sistemas de gestión y cobranzas (saldos con link de pago).

## Riesgos y reglas

- **Envíos masivos por WAHA:** es WhatsApp no oficial, con riesgo de bloqueo del número. Hay tope por paciente, tandas de 50 y pausas al azar. Para escalar conviene el WhatsApp oficial de Meta, con templates de marketing que se pagan por mensaje.
- **No automatizar WhatsApp Web** (computer use, extensiones, bots): va contra los términos de WhatsApp y es frágil. El envío asistido, con un toque por paciente, sí.
- **Antes de pacientes reales:** revisar el consentimiento y la Ley 25.326 con un abogado. Las campañas automáticas siguen desactivadas (workflow de n8n `g0H8xbQvRNv5FxQj`).
