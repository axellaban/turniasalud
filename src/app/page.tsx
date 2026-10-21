import Link from "next/link";
import { Logo } from "@/components/logo";

const PRODUCTS = [
  {
    name: "Recepción",
    tag: "Siempre activa · inbound",
    text: "Atiende cada WhatsApp, audio y llamada al instante, las 24 horas. Da, confirma, cancela y reprograma turnos sobre tu agenda real.",
    items: ["Turnos 24/7", "Triage y derivación", "Fuera de horario", "Preguntas frecuentes", "Recetas y pedidos"],
  },
  {
    name: "Activa",
    tag: "Proactiva · outbound",
    text: "Le escribe a tus pacientes en el momento justo para llenar la agenda: controles vencidos, ausentes, lista de espera y reactivación.",
    items: ["Recall de controles", "Lista de espera", "Recordatorios", "Recupero de ausentes", "Reactivación"],
  },
  {
    name: "Circuitos",
    tag: "Recorridos automáticos",
    text: "Admisión completa antes de la visita: datos, DNI, obra social, plan y número de afiliado, guardados sin que nadie los tipee.",
    items: ["Admisión", "Coberturas", "Indicaciones previas", "Derivaciones", "Seguimiento"],
  },
  {
    name: "Equipo",
    tag: "Potencia a tu staff",
    text: "Lo que necesita una persona llega como tarea con todo el contexto. Resúmenes, transcripciones y métricas de cada conversación.",
    items: ["Bandeja de tareas", "Derivación con contexto", "Resúmenes con IA", "Métricas", "Memoria del paciente"],
  },
];

const USE_CASES = [
  ["Turnos 24/7", "Agenda, confirma, cancela y reprograma con las reglas de cada profesional, tipo de turno y cobertura."],
  ["Triage y derivación", "Detecta urgencias, indica 107 o guardia y crea una tarea urgente para el equipo."],
  ["Admisión", "Toma nombre, DNI, obra social, plan y número de afiliado durante la conversación."],
  ["Fuera de horario", "La clínica cierra, la atención no: de noche y los fines de semana también se dan turnos."],
  ["Recall y reactivación", "Detecta controles vencidos y pacientes que no vuelven, y les ofrece turno por WhatsApp."],
  ["Lista de espera", "Cuando alguien cancela, le ofrece el hueco a quien estaba esperando. Sin llamar a nadie."],
  ["Recetas y resultados", "Toma el pedido completo y lo deja como tarea para el profesional."],
  ["Recordatorios", "Confirma asistencia el día anterior y reprograma en la misma conversación si no puede venir."],
  ["Memoria del paciente", "Cada conversación parte de la anterior: preferencias, cobertura, turnos y pendientes."],
];

const SPECIALTIES = [
  "Traumatología",
  "Dermatología",
  "Odontología",
  "Oftalmología",
  "Ginecología y obstetricia",
  "Pediatría",
  "Clínica médica",
  "Cardiología",
  "Otorrinolaringología",
  "Kinesiología",
  "Nutrición",
  "Salud mental",
  "Diagnóstico por imágenes",
  "Centros multiespecialidad",
];

const STEPS = [
  ["Cancelación detectada", "Un paciente cancela su turno de mañana por WhatsApp. Turnia lo libera en la agenda al instante."],
  ["Hueco ofrecido", "Turnia le escribe a las personas en lista de espera para ese tipo de turno, con un template aprobado por Meta."],
  ["Reprogramación", "Al mismo tiempo, le ofrece al paciente que canceló nuevos horarios para no perderlo."],
  ["Agenda llena", "El primero que confirma se queda con el turno. Todo queda registrado en el panel, sin una sola llamada."],
];

function WhatsAppMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm rounded-[2rem] border border-brand-900/10 bg-white p-3 shadow-2xl shadow-brand-900/10">
      <div className="flex items-center gap-3 rounded-t-[1.5rem] bg-brand-700 px-4 py-3 text-white">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-sm font-semibold">CP</div>
        <div>
          <p className="text-sm font-semibold leading-tight">Centro Médico Plaza</p>
          <p className="text-xs text-brand-100">en línea</p>
        </div>
      </div>
      <div className="space-y-2 bg-[#efeae2] px-3 py-4 text-[13px] leading-snug text-neutral-800">
        <p className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          ¡Hola María! 👋 Ya pasaron 6 meses de tu última limpieza dental. ¿Querés que te reserve un turno?
        </p>
        <p className="ml-auto max-w-[80%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm">
          Sí! Puede ser a la mañana? Tengo OSDE
        </p>
        <p className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          Perfecto. Con la Dra. Ruiz tengo el <b>martes 11/11 a las 10:00</b> o el <b>miércoles 12/11 a las 10:40</b>. ¿Cuál te queda mejor?
        </p>
        <div className="ml-auto flex max-w-[80%] items-center gap-2 rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-[10px] text-white">▶</span>
          <span className="h-1 flex-1 rounded bg-brand-700/40" />
          <span className="text-[11px] text-neutral-500">0:04</span>
        </div>
        <p className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          Listo, quedaste confirmada para el martes 11/11 a las 10:00 con la Dra. Ruiz en Av. Santa Fe 3200. ¡Te esperamos! 🦷
        </p>
      </div>
      <div className="absolute -right-4 -top-4 rounded-full bg-sun-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
        Recall automático
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-brand-900/5 bg-background/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Turnia Salud">
            <Logo />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-brand-900/80 md:flex">
            <a href="#producto" className="hover:text-brand-700">Producto</a>
            <a href="#casos" className="hover:text-brand-700">Casos de uso</a>
            <a href="#como-funciona" className="hover:text-brand-700">Cómo funciona</a>
            <a href="#especialidades" className="hover:text-brand-700">Especialidades</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/panel" className="hidden rounded-full px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50 sm:inline-block">
              Ingresar
            </Link>
            <Link href="/demo" className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Probá la demo
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Agentes de IA para clínicas y consultorios
            </p>
            <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-brand-950 sm:text-6xl">
              Cada paciente, <span className="italic text-brand-600">bien atendido.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-900/75">
              Turnia atiende el WhatsApp y el teléfono de tu clínica las 24 horas: da turnos, confirma, reprograma, recupera
              pacientes y deriva lo urgente. Sobre tu agenda real, por texto y por audio.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-full bg-brand-600 px-6 py-3 font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-700">
                Hablá con el agente
              </Link>
              <a href="#como-funciona" className="rounded-full px-6 py-3 font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50">
                Ver cómo funciona
              </a>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-sm">
              {[
                ["24/7", "WhatsApp, audios y llamadas"],
                ["0", "pacientes en espera"],
                ["100%", "de las conversaciones con resumen"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="font-display text-3xl text-brand-700">{value}</dt>
                  <dd className="mt-1 text-brand-900/60">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <WhatsAppMock />
        </section>

        <section className="border-y border-brand-900/5 bg-brand-950 py-6 text-brand-100">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 text-sm sm:px-6">
            <span>💬 WhatsApp primero (texto y audios)</span>
            <span>🩺 Obras sociales y prepagas</span>
            <span>🧉 Habla en rioplatense, con voseo</span>
            <span>🔒 Pensado para la Ley 25.326 de datos personales</span>
          </div>
        </section>

        <section id="producto" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">La plataforma</p>
            <h2 className="mt-2 font-display text-3xl tracking-tight text-brand-950 sm:text-5xl">
              Todo el recorrido del paciente. Una sola plataforma.
            </h2>
            <p className="mt-4 text-lg text-brand-900/70">
              Cuatro productos conectados que comparten la misma memoria del paciente, desde el primer mensaje hasta el
              seguimiento.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {PRODUCTS.map((p) => (
              <article key={p.name} className="rounded-3xl border border-brand-900/10 bg-white p-7 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-sun-600">{p.tag}</p>
                <h3 className="mt-2 font-display text-2xl text-brand-950">Turnia {p.name}</h3>
                <p className="mt-3 text-brand-900/70">{p.text}</p>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {p.items.map((item) => (
                    <li key={item} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="casos" className="bg-brand-50/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="max-w-2xl font-display text-3xl tracking-tight text-brand-950 sm:text-4xl">
              Resuelve, no deriva. Como tu mejor recepcionista.
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map(([title, text]) => (
                <div key={title} className="rounded-2xl bg-white p-6 ring-1 ring-brand-900/5">
                  <h3 className="font-semibold text-brand-900">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-900/65">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Cómo funciona</p>
          <h2 className="mt-2 max-w-3xl font-display text-3xl tracking-tight text-brand-950 sm:text-4xl">
            Un paciente cancela a último momento. Dos acciones, cero llamadas.
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="relative rounded-2xl border border-brand-900/10 bg-white p-6">
                <span className="font-display text-4xl text-brand-200">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-semibold text-brand-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-brand-900/65">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-brand-900 py-20 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-sun-300">Memoria del paciente</p>
              <h2 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">Nadie tiene que repetir su historia.</h2>
              <p className="mt-4 text-brand-100/80">
                Cada conversación parte de la anterior: cobertura, preferencias de horario, turnos próximos y pedidos
                pendientes. Y cuando hace falta una persona, la tarea llega con el resumen completo.
              </p>
            </div>
            <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
              <p className="text-xs uppercase tracking-wider text-brand-200">Contexto que recibe el agente</p>
              <ul className="mt-4 space-y-3 text-sm text-brand-50">
                <li>👤 Jorge Pérez · Swiss Medical SMG20</li>
                <li>🦵 Operado de rodilla derecha en marzo, controles con la Dra. Fernández</li>
                <li>🕘 Prefiere turnos a primera hora</li>
                <li>📋 Pendiente: renovar receta de antiinflamatorio</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="especialidades" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="font-display text-3xl tracking-tight text-brand-950 sm:text-4xl">Hecho a medida de cada especialidad</h2>
          <p className="mt-3 max-w-2xl text-brand-900/70">
            Tipos de turno, duraciones, indicaciones previas, coberturas por profesional y controles periódicos configurables.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {SPECIALTIES.map((s) => (
              <li key={s} className="rounded-full border border-brand-900/10 bg-white px-4 py-2 text-sm text-brand-800">
                {s}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-14 text-center text-white sm:px-14">
            <h2 className="font-display text-3xl tracking-tight sm:text-5xl">¿Listo para que ningún paciente quede sin respuesta?</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              Probá el agente ahora mismo, por voz o por chat, con la agenda de una clínica de demo.
            </p>
            <Link href="/demo" className="mt-8 inline-block rounded-full bg-white px-7 py-3 font-semibold text-brand-800 hover:bg-brand-50">
              Probá la demo
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-brand-900/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-brand-900/60 sm:flex-row sm:px-6">
          <Logo />
          <p>
            © {new Date().getFullYear()} Turnia Salud · Hecho en Argentina ·{" "}
            <Link href="/privacidad" className="hover:underline">
              Privacidad
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
