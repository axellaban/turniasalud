# Genera capture/turnia/seed-video.sql: una semana de uso ficticio del consultorio demo
# (pacientes, turnos, conversaciones y pedidos) para capturar el panel. Se corre DESPUÉS de
# supabase/schema.sql y supabase/seed.sql en una base local, nunca en producción.
import json, random, sys
from datetime import datetime, timedelta

random.seed(11)
CL = "00000000-0000-4000-8000-000000000001"
PRO = {"fer": "00000000-0000-4000-8000-0000000000a1", "gom": "00000000-0000-4000-8000-0000000000a2",
       "ruiz": "00000000-0000-4000-8000-0000000000a3", "sosa": "00000000-0000-4000-8000-0000000000a4"}
TYPE = {"fer": [("00000000-0000-4000-8000-0000000000b2", 20), ("00000000-0000-4000-8000-0000000000b1", 30)],
        "gom": [("00000000-0000-4000-8000-0000000000b3", 20), ("00000000-0000-4000-8000-0000000000b4", 30)],
        "ruiz": [("00000000-0000-4000-8000-0000000000b5", 40), ("00000000-0000-4000-8000-0000000000b6", 30)],
        "sosa": [("00000000-0000-4000-8000-0000000000b7", 30), ("00000000-0000-4000-8000-0000000000b8", 20)]}
# Lunes 26/10/2026 en adelante (hora de Buenos Aires)
WEEK = datetime(2026, 10, 26)
HOURS = {"fer": {0: (9, 13), 2: (9, 13), 4: (9, 13)}, "gom": {1: (14, 19), 3: (14, 19)},
         "ruiz": {d: (10, 17) for d in range(5)}, "sosa": {**{d: (8, 12) for d in range(5)}, 5: (9, 13)}}
FIRST = ["Valentina", "Martín", "Camila", "Santiago", "Florencia", "Nicolás", "Julieta", "Tomás", "Agustina", "Federico", "Paula", "Diego",
         "Sofía", "Matías", "Lorena", "Gabriel", "Carla", "Ezequiel", "Mariana", "Hernán", "Rocío", "Ignacio", "Belén", "Andrés",
         "Lucía", "Joaquín", "Micaela", "Facundo", "Carolina", "Pedro", "Inés", "Ramiro", "Abril", "Gonzalo", "Bianca", "Sergio"]
LAST = ["Ruiz Díaz", "Acosta", "Benítez", "Medina", "Herrera", "Suárez", "Castro", "Giménez", "Molina", "Ríos", "Ortiz", "Navarro",
        "Domínguez", "Vega", "Paz", "Luna", "Sosa", "Rojas", "Torres", "Blanco", "Ledesma", "Ferreyra", "Quiroga", "Peralta",
        "Carrizo", "Ponce", "Figueroa", "Rivas", "Cáceres", "Mansilla", "Aguirre", "Toledo", "Villalba", "Bravo"]
NAMES = []
while len(NAMES) < 90:
    n = f"{random.choice(FIRST)} {random.choice(LAST)}"
    if n not in NAMES and n != "Jorge Pérez":
        NAMES.append(n)
COV = [("OSDE", "310"), ("Swiss Medical", "SMG20"), ("Galeno", "Oro"), ("Medifé", "Bronce"), ("OMINT", "Global"), ("Particular", None), ("Sancor Salud", "1000")]
SRC = ["whatsapp"] * 5 + ["telefono"] * 3 + ["panel"] * 2 + ["web"]

q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
out = ["-- Generado por capture/turnia/seed-video.py (datos ficticios).", "begin;"]
pids = []
for i, n in enumerate(NAMES):
    pid = f"00000000-0000-4000-8000-1000000000{i:02d}"
    c, plan = random.choice(COV)
    out.append(f"insert into patients (id, clinic_id, full_name, phone, dni, coverage, coverage_plan, last_contact_at) values ({q(pid)}, {q(CL)}, {q(n)}, {q('54911' + str(46000000 + i * 1371))}, {q(str(30000000 + i * 412337))}, {q(c)}, {q(plan)}, now() - interval '{random.randint(1, 60)} days');")
    pids.append(pid)

JORGE = "00000000-0000-4000-8000-0000000000c2"
_order = []
def next_patient():
    # Recorre los pacientes en orden aleatorio: casi nadie repite en la semana.
    global _order
    if not _order:
        _order = random.sample(pids, len(pids))
    return _order.pop()
appts = []
def slot(day, h, m, dur):
    s = WEEK + timedelta(days=day, hours=h, minutes=m)
    return s, s + timedelta(minutes=dur)

# El turno que Sofi reservó en el video: lunes 26 a las 9:40 con la Dra. Fernández.
taken = {("fer", 0, 9 * 60 + 40)}
s, e = slot(0, 9, 40, 20)
appts.append((JORGE, "fer", TYPE["fer"][0][0], s, e, "confirmado", "whatsapp", "Control de rodilla derecha."))
for pro, days in HOURS.items():
    for d, (h0, h1) in days.items():
        t = h0 * 60
        while t < h1 * 60:
            tid, dur = random.choice(TYPE[pro])
            if t + dur > h1 * 60:
                break
            busy = any(p == pro and dd == d and (mm <= t < mm + 20 or t <= mm < t + dur) for (p, dd, mm) in taken)
            if not busy and random.random() < 0.62:
                s, e = slot(d, t // 60, t % 60, dur)
                st = "confirmado" if random.random() < 0.7 else "pendiente"
                appts.append((next_patient(), pro, tid, s, e, st, random.choice(SRC), None))
                taken.add((pro, d, t))
                t += dur
            else:
                t += 20 if pro in ("fer", "gom", "sosa") else 30
for (pid, pro, tid, s, e, st, src, notes) in appts:
    out.append(
        f"insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, notes, coverage, created_at) values "
        f"({q(CL)}, {q(pid)}, {q(PRO[pro])}, {q(tid)}, {q(s.isoformat() + '-03')}, {q(e.isoformat() + '-03')}, {q(st)}, {q(src)}, {q(notes)}, "
        f"(select coverage from patients where id = {q(pid)}), now() - interval '{random.randint(1, 72)} hours');"
    )

# Conversaciones: la de Jorge (la del video) y otras de la semana.
def tr(lines):
    return json.dumps([{"role": r, "message": m} for r, m in lines], ensure_ascii=False)

JORGE_CHAT = [
    ("user", "🎤 Audio: «Hola Sofi, buen día. Quería sacar un turno con la traumatóloga, y de paso necesito que me renueven una receta.»"),
    ("agent", "¡Hola, Jorge! Te ayudo con las dos cosas. Para el control de la rodilla con la Dra. Fernández tengo el lunes 26 a las 9:40 o el miércoles 28 a las 11:00. ¿Cuál preferís?"),
    ("user", "Lunes 9:40"),
    ("agent", "Listo, reservado: lunes 26 a las 9:40 con la Dra. Fernández, en Av. Santa Fe 3200, 4º piso. Traé la credencial de Swiss Medical. La receta ya se la pedí a la doctora: te llega por acá en 48 h hábiles."),
]
fn = lambda i: NAMES[i].split()[0]
convs = [
    (JORGE, "whatsapp", "entrante", "2026-10-25 07:12-03", 190, "Turno de control y pedido de receta", "Jorge Pérez reservó el control de traumatología con la Dra. Fernández para el lunes 26 a las 9:40 y pidió renovar la receta del antiinflamatorio. Se creó la tarea para la doctora.", "turno_nuevo", "reservado", "conv_video_jorge", JORGE_CHAT),
    (pids[0], "telefono", "entrante", "2026-10-25 06:41-03", 132, "Consulta por un lunar", f"{fn(0)} pidió revisar un lunar que cambió de color. Se le dio turno con el Dr. Gómez el martes 27 a las 15:20.", "turno_nuevo", "reservado", "conv_video_2", [("agent", "Centro Médico Plaza, buen día. Te atiende Sofi."), ("user", "Hola, quería que me vean un lunar.")]),
    (pids[3], "whatsapp", "entrante", "2026-10-24 22:18-03", 75, "Cancelación y lista de espera", f"{fn(3)} canceló su limpieza del jueves. El turno se ofreció a la lista de espera.", "cancelacion", "cancelado", "conv_video_3", [("user", "Hola, no voy a poder ir el jueves."), ("agent", "Sin problema, lo cancelo. ¿Querés que te busque otro día?")]),
    (pids[5], "telefono", "entrante", "2026-10-24 19:05-03", 96, "Consulta de cobertura", f"{fn(5)} preguntó si atienden OMINT en dermatología. Sofi confirmó la cobertura y le dio turno.", "consulta", "reservado", "conv_video_4", [("user", "¿Atienden OMINT?"), ("agent", "Sí, con el Dr. Gómez.")]),
    (pids[8], "whatsapp", "entrante", "2026-10-24 13:30-03", 64, "Confirmación de asistencia", f"{fn(8)} confirmó su turno del lunes con el Dr. Sosa.", "confirmacion", "confirmado", "conv_video_5", [("agent", "¿Confirmás tu turno del lunes a las 8:30?"), ("user", "Sí, confirmo")]),
    (pids[11], "whatsapp", "entrante", "2026-10-24 09:12-03", 140, "Resultados de laboratorio", f"{fn(11)} preguntó por sus análisis. Se derivó a la secretaría para enviarlos.", "resultados", "derivado", "conv_video_6", [("user", "¿Ya están mis análisis?"), ("agent", "Le dejo el pedido a la secretaría.")]),
]
for (pid, ch, dirn, at, dur, title, summary, intent, outcome, eid, lines) in convs:
    out.append(
        f"insert into conversations (clinic_id, patient_id, elevenlabs_conversation_id, channel, direction, started_at, duration_secs, status, title, summary, intent, outcome, call_successful, transcript, analysis) values "
        f"({q(CL)}, {q(pid)}, {q(eid)}, {q(ch)}, {q(dirn)}, {q(at)}, {dur}, 'done', {q(title)}, {q(summary)}, {q(intent)}, {q(outcome)}, 'success', {q(tr(lines))}::jsonb, '{{\"sentimiento\": \"positivo\"}}'::jsonb);"
    )
out.append(f"update tasks set conversation_id = 'conv_video_jorge', details = 'Jorge pide renovar el ibuprofeno de 600 mg que le indicó la Dra. Fernández. Lo toma sólo cuando le duele, después de jugar al fútbol. Quiere recibirla por WhatsApp.', created_at = '2026-10-25 07:14-03' where patient_id = {q(JORGE)};")
out.append(f"update patients set last_contact_at = '2026-10-25 07:12-03' where id = {q(JORGE)};")
out.append(f"insert into tasks (clinic_id, patient_id, type, priority, title, details, created_at) values ({q(CL)}, {q(pids[11])}, 'resultados', 'normal', 'Enviar resultados de laboratorio', '" + fn(11) + " pide sus análisis de sangre de la semana pasada.', '2026-10-24 09:14-03');")
out.append(f"insert into tasks (clinic_id, patient_id, type, priority, title, details, created_at) values ({q(CL)}, {q(pids[14])}, 'derivacion_humana', 'alta', 'Llamar por presupuesto de ortodoncia', '" + fn(14) + " quiere hablar con una persona por el presupuesto.', '2026-10-24 17:40-03');")
out.append("commit;")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
print(f"{len(appts)} turnos, {len(convs)} conversaciones")

# --- Historial para Campañas: pacientes atendidos hace meses que ya deberían volver ---
hist = ["-- Historial ficticio para Campañas.", "begin;"]
MORE = ["Alejandro Funes", "Romina Cabrera", "Pablo Ibarra", "Natalia Godoy", "Leandro Méndez", "Daniela Arias", "Cristian Ponce",
        "Verónica Villalba", "Sebastián Coria", "Silvina Ojeda", "Fernando Correa", "Gisela Maidana", "Juan Pablo Lucero",
        "Melina Ávila", "Rodrigo Moreno", "Antonella Vera", "Mauricio Figueroa", "Cecilia Bustos", "Emiliano Rivero",
        "Luciana Juárez", "Ramiro Aguirre", "Victoria Correa", "Franco Sánchez", "Yanina Ruiz", "Marcos Paredes",
        "Noelia Campos", "Gustavo Ferrari", "Analía Ponce", "Bruno Sena", "Celeste Nieto", "Esteban Lagos", "Milagros Roldán"]
RECALL = [("fer", "00000000-0000-4000-8000-0000000000b2", 20, 4, 9), ("gom", "00000000-0000-4000-8000-0000000000b4", 30, 13, 20),
          ("ruiz", "00000000-0000-4000-8000-0000000000b5", 40, 7, 14), ("sosa", "00000000-0000-4000-8000-0000000000b7", 30, 13, 22)]
for i, n in enumerate(MORE):
    pid = f"00000000-0000-4000-8000-2000000000{i:02d}"
    c, plan = random.choice(COV)
    pro, tid, dur, m0, m1 = random.choice(RECALL)
    months = random.randint(m0, m1)
    hist.append(f"insert into patients (id, clinic_id, full_name, phone, dni, coverage, coverage_plan, last_contact_at) values ({q(pid)}, {q(CL)}, {q(n)}, {q('54911' + str(47000000 + i * 1777))}, {q(str(25000000 + i * 391111))}, {q(c)}, {q(plan)}, now() - interval '{months} months');")
    h = random.choice([9, 10, 11, 15, 16])
    hist.append(
        f"insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, coverage) values "
        f"({q(CL)}, {q(pid)}, {q(PRO[pro])}, {q(tid)}, date_trunc('day', now() - interval '{months} months') + interval '{h} hours', "
        f"date_trunc('day', now() - interval '{months} months') + interval '{h} hours {dur} minutes', 'atendido', {q(random.choice(SRC))}, {q(c)});"
    )
# Acceso de consultorio para capturar el panel como lo ve la clínica (código sólo local).
import hashlib
code = "VDEMPZAPTURA2345"
hist.append(f"insert into clinic_access (clinic_id, label, code_hash, code_hint) values ({q(CL)}, 'Recepción', {q(hashlib.sha256(('turnia-access:' + code).encode()).hexdigest())}, {q(code[-4:])}) on conflict do nothing;")
hist.append(f"update clinics set name = 'Centro Médico Plaza' where id = {q(CL)};")
hist.append("commit;")
open(sys.argv[1].replace(".sql", "-historial.sql"), "w").write("\n".join(hist) + "\n")
print(f"{len(MORE)} pacientes con historial")
