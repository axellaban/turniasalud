-- Turnia Salud — datos de demo (clínica ficticia en CABA)
-- Correlo DESPUÉS de schema.sql. Si la clínica demo ya existe, conserva sus datos.

do $turnia_seed$
begin
if exists (select 1 from clinics where id = '00000000-0000-4000-8000-000000000001') then
  return;
end if;

insert into clinics (
  id, name, agent_name, specialty, address, phone, website, timezone, hours_text,
  accepted_coverages, faq, policies, urgency_instructions, after_hours_instructions, templates
) values (
  '00000000-0000-4000-8000-000000000001',
  'Centro Médico Plaza (demo)',
  'Sofi',
  'Multiespecialidad',
  'Av. Santa Fe 3200, 4º piso, Palermo, CABA',
  '+54 11 5555-0100',
  'https://turnia.example',
  'America/Argentina/Buenos_Aires',
  'Lunes a viernes de 8 a 20 h. Sábados de 9 a 13 h.',
  array['OSDE', 'Swiss Medical', 'Galeno', 'Medifé', 'OMINT', 'Sancor Salud', 'IOMA', 'Particular'],
  E'- Estacionamiento: no tenemos propio; hay un garage en Av. Santa Fe 3150.\n- Llegar 10 minutos antes con DNI y credencial de la obra social.\n- Consulta particular: $45.000. Se aceptan efectivo, débito, crédito y transferencia.\n- Los menores de 18 años deben venir acompañados por un adulto.\n- Estudios: traer los estudios previos impresos o en el celular.\n- Recetas: se envían por mail o WhatsApp dentro de las 48 h hábiles.',
  E'- Cancelaciones con al menos 24 h de anticipación.\n- Tolerancia de 15 minutos; pasado ese tiempo el turno puede reprogramarse.\n- PAMI: no se atiende por PAMI en esta sede.',
  E'Si el paciente describe dolor de pecho, falta de aire, pérdida de conocimiento, sangrado abundante, un golpe fuerte en la cabeza o cualquier emergencia, indicarle que llame al 107 (SAME) o vaya a la guardia más cercana, y crear una tarea urgente.',
  E'Fuera de horario no hay profesionales de guardia en la sede. Para urgencias, 107 (SAME) o la guardia más cercana. Los pedidos se responden el siguiente día hábil.',
  '{"recordatorio": "recordatorio_turno", "recall": "recall_control", "lista_espera": "turno_liberado", "reactivacion": "reactivacion_paciente", "no_show": "turno_perdido", "encuesta": "encuesta_visita", "respuesta": "respuesta_pedido"}'::jsonb
);

insert into professionals (id, clinic_id, full_name, specialty, bio, accepted_coverages) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Dra. Lucía Fernández', 'Traumatología', 'Rodilla y hombro. Lesiones deportivas.', null),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Dr. Martín Gómez', 'Dermatología', 'Control de lunares, acné y dermatología estética.', array['OSDE', 'Swiss Medical', 'Galeno', 'Particular']),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'Dra. Carolina Ruiz', 'Odontología', 'Odontología general y limpiezas.', null),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'Dr. Pablo Sosa', 'Clínica médica', 'Chequeos anuales y aptos físicos.', null);

insert into appointment_types (id, clinic_id, name, specialty, duration_min, instructions, recall_months, is_first_visit, price) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'Primera consulta de traumatología', 'Traumatología', 30, 'Traer estudios por imágenes previos (radiografías, resonancias).', null, true, 45000),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001', 'Control de traumatología', 'Traumatología', 20, null, 3, false, 35000),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000001', 'Consulta dermatológica', 'Dermatología', 20, null, null, true, 45000),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-000000000001', 'Control anual de lunares', 'Dermatología', 30, 'No usar maquillaje ni autobronceante en las zonas a revisar.', 12, false, 50000),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-000000000001', 'Limpieza dental', 'Odontología', 40, null, 6, false, 40000),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-000000000001', 'Consulta odontológica', 'Odontología', 30, null, null, true, 40000),
  ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-000000000001', 'Chequeo clínico anual', 'Clínica médica', 30, 'Venir con 8 h de ayuno si querés que te pidan laboratorio en el día.', 12, false, 45000),
  ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-000000000001', 'Apto físico', 'Clínica médica', 20, 'Traer ropa cómoda.', 12, false, 30000);

-- Horarios: Fernández L-M-V 9-13, Gómez M-J 14-19, Ruiz L a V 10-17, Sosa L a V 8-12 y S 9-13
insert into schedules (professional_id, weekday, start_time, end_time) values
  ('00000000-0000-4000-8000-0000000000a1', 1, '09:00', '13:00'),
  ('00000000-0000-4000-8000-0000000000a1', 3, '09:00', '13:00'),
  ('00000000-0000-4000-8000-0000000000a1', 5, '09:00', '13:00'),
  ('00000000-0000-4000-8000-0000000000a2', 2, '14:00', '19:00'),
  ('00000000-0000-4000-8000-0000000000a2', 4, '14:00', '19:00'),
  ('00000000-0000-4000-8000-0000000000a3', 1, '10:00', '17:00'),
  ('00000000-0000-4000-8000-0000000000a3', 2, '10:00', '17:00'),
  ('00000000-0000-4000-8000-0000000000a3', 3, '10:00', '17:00'),
  ('00000000-0000-4000-8000-0000000000a3', 4, '10:00', '17:00'),
  ('00000000-0000-4000-8000-0000000000a3', 5, '10:00', '17:00'),
  ('00000000-0000-4000-8000-0000000000a4', 1, '08:00', '12:00'),
  ('00000000-0000-4000-8000-0000000000a4', 2, '08:00', '12:00'),
  ('00000000-0000-4000-8000-0000000000a4', 3, '08:00', '12:00'),
  ('00000000-0000-4000-8000-0000000000a4', 4, '08:00', '12:00'),
  ('00000000-0000-4000-8000-0000000000a4', 5, '08:00', '12:00'),
  ('00000000-0000-4000-8000-0000000000a4', 6, '09:00', '13:00');

-- Pacientes de ejemplo (teléfonos ficticios en formato WhatsApp: 549 + área + número)
insert into patients (id, clinic_id, full_name, phone, dni, coverage, coverage_plan, memory_summary, last_contact_at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'María González', '5491155550001', '28111222', 'OSDE', '310', 'Prefiere turnos a la mañana. Viene a limpieza cada 6 meses.', now() - interval '7 months'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'Jorge Pérez', '5491155550002', '20333444', 'Swiss Medical', 'SMG20', 'Operado de rodilla derecha en marzo. Hace controles con la Dra. Fernández.', now() - interval '4 months'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000001', 'Ana Romero', '5491155550003', '35555666', 'Galeno', 'Oro', 'Control anual de lunares. Antecedente familiar de melanoma.', now() - interval '13 months'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-000000000001', 'Lucas Díaz', '5491155550004', '40777888', 'Particular', null, null, now() - interval '20 days');

-- Historial (turnos atendidos en el pasado → alimentan las campañas de recall)
insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b5',
    date_trunc('day', now() - interval '7 months') + interval '13 hours', date_trunc('day', now() - interval '7 months') + interval '13 hours 40 minutes', 'atendido', 'whatsapp'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2',
    date_trunc('day', now() - interval '4 months') + interval '12 hours', date_trunc('day', now() - interval '4 months') + interval '12 hours 20 minutes', 'atendido', 'telefono'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b4',
    date_trunc('day', now() - interval '13 months') + interval '17 hours', date_trunc('day', now() - interval '13 months') + interval '17 hours 30 minutes', 'atendido', 'panel'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000b8',
    date_trunc('day', now() - interval '20 days') + interval '11 hours', date_trunc('day', now() - interval '20 days') + interval '11 hours 20 minutes', 'ausente', 'whatsapp');

insert into tasks (clinic_id, patient_id, type, priority, title, details) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'receta', 'normal',
    'Renovar receta de antiinflamatorio', 'Jorge pide renovar la receta que le indicó la Dra. Fernández en el último control. Quiere recibirla por WhatsApp.');
end;
$turnia_seed$;
