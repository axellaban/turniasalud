import Link from "next/link";
import { getConversacion } from "@/content/conversaciones";
import { HeroVideo } from "@/components/site/hero";
import { Flecha } from "@/components/site/iconos";
import { BandaVeredicto, CarruselCasos, CarruselDestacados, RuedaCapacidades, type Caso, type Destacado } from "@/components/site/interactivos";
import { ReproductorDemo } from "@/components/site/reproductor-demo";
import {
  BandaProbalo,
  GrillaEspecialidades,
  MotorProtocolos,
  OrbitaIntegraciones,
  TarjetasGradiente,
  TarjetasResultados,
  Titulo,
} from "@/components/site/secciones";

// Home: mismas secciones y en el mismo orden que assorthealth.com.
// Donde Assort muestra clientes, testimonios o métricas propias, Turnia muestra
// datos reales del producto (no hay clientes ni números inventados).

const DESTACADOS: Destacado[] = [
  {
    pestana: "Fuera de horario",
    icono: "luna",
    situacion: "Son las 23 h de un domingo. Una paciente escribe para sacar turno con dermatología: mañana va a llamar a otra clínica si nadie le contesta.",
    resolucion: "Sofi le ofrece dos horarios con una profesional que atiende su prepaga, la reserva y le recuerda el turno el día anterior.",
    valor: "24/7",
    etiqueta: "Turnos dados aunque la clínica esté cerrada",
    href: "/soluciones/fuera-de-horario",
  },
  {
    pestana: "Lista de espera",
    icono: "calendario",
    situacion: "Un paciente cancela su turno de mañana a las 9. Antes, ese hueco quedaba vacío porque nadie tenía tiempo de llamar a la lista de espera.",
    resolucion: "Turnia libera el turno y se lo ofrece por WhatsApp a quien estaba esperando. El primero que confirma se lo queda.",
    valor: "0",
    etiqueta: "Llamadas para reocupar un turno cancelado",
    href: "/activa",
  },
  {
    pestana: "Agenda sin errores",
    icono: "escudo",
    situacion: "Dos pacientes piden por WhatsApp el mismo horario con el mismo profesional, en el mismo segundo.",
    resolucion: "La base de datos impide la superposición: uno se queda con el turno y al otro el agente le ofrece la siguiente opción.",
    valor: "0",
    etiqueta: "Turnos superpuestos",
    href: "/soluciones/turnos",
  },
  {
    pestana: "Equipo con contexto",
    icono: "tareas",
    situacion: "Un paciente pide la renovación de una receta por audio. La recepción está atendiendo el mostrador.",
    resolucion: "El pedido llega a la bandeja con resumen y transcripción. Cuando la doctora lo resuelve, la respuesta vuelve al paciente por WhatsApp.",
    valor: "100%",
    etiqueta: "De las conversaciones con resumen y transcripción",
    href: "/soluciones/tareas",
  },
];

const CASOS: Caso[] = [
  { titulo: "Pediatría: una mamá saca turno para su hijo a la noche, por WhatsApp", imagen: "/img/familia.jpg", href: "/escucha-a-nuestros-agentes#pediatria", pestana: "Pediatría", icono: "bebe" },
  { titulo: "Clínica médica: control, derivación al especialista y receta en una sola conversación", imagen: "/img/consulta.jpg", href: "/escucha-a-nuestros-agentes#clinica-medica", pestana: "Clínica médica", icono: "estetoscopio" },
  { titulo: "Cardiología: turno con estudios previos y derivación inmediata ante un síntoma de alarma", imagen: "/img/medico-celular.jpg", href: "/escucha-a-nuestros-agentes#cardiologia", pestana: "Cardiología", icono: "corazon" },
  { titulo: "Gastroenterología: videocolonoscopía con la preparación enviada por WhatsApp", imagen: "/img/recepcion.jpg", href: "/escucha-a-nuestros-agentes#gastroenterologia", pestana: "Gastroenterología", icono: "estomago" },
];

const FRASES = [
  "Respuesta en segundos, también de noche, los fines de semana y los feriados.",
  "Entiende texto y audios, en el español de tus pacientes.",
  "Nadie tiene que repetir su historia: el agente recuerda cada conversación.",
  "Cada paciente puede evaluar su atención con un puntaje de 0 a 10.",
];

export default function Home() {
  const demo = getConversacion("home");
  return (
    <>
      <HeroVideo />
      <GrillaEspecialidades />
      <CarruselDestacados items={DESTACADOS} />
      <div className="pt-16">
        <BandaProbalo />
      </div>
      <MotorProtocolos />
      <RuedaCapacidades />

      <section id="en-accion" className="mx-auto max-w-[1100px] scroll-mt-28 px-4 pb-4 pt-10 sm:px-6">
        <Titulo linea1="Plataforma de agentes de IA" linea2="del primer mensaje al seguimiento" />
        <div className="mt-12">
          {demo ? (
            <ReproductorDemo conversacion={demo} variante="orbe" />
          ) : (
            <Link href="/escucha-a-nuestros-agentes" className="block rounded-3xl bg-brand-50 p-10 text-center font-medium text-brand-700">
              Escuchá a nuestros agentes <Flecha className="inline h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="mt-4">
          <TarjetasGradiente />
        </div>
        <div className="mt-4">
          <BandaVeredicto frases={FRASES} />
        </div>
      </section>

      <OrbitaIntegraciones />
      <TarjetasResultados />
      <CarruselCasos casos={CASOS} />
    </>
  );
}
