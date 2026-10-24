import { CASOS } from "./casos";
import { ESPECIALIDADES } from "./especialidades";
import { ORGANIZACIONES } from "./organizaciones";
import type { IconoClave } from "./tipos";

// Navegación y datos compartidos de la web pública. Misma arquitectura que
// assorthealth.com: Plataforma ▾ · Soluciones ▾ · Escuchá ▾ · Empresa ▾ · Pedí una demo.

export type EnlaceMenu = { href: string; nombre: string; detalle?: string; icono?: IconoClave };

export const PLATAFORMA: EnlaceMenu[] = [
  { href: "/plataforma", nombre: "Plataforma", detalle: "Un motor de IA para todo el recorrido del paciente", icono: "red" },
  { href: "/recepcion", nombre: "Turnia Recepción", detalle: "Agentes que atienden WhatsApp y teléfono 24/7", icono: "whatsapp" },
  { href: "/activa", nombre: "Turnia Activa", detalle: "Campañas que llenan la agenda", icono: "megafono" },
];

export const SOLUCIONES_CASOS: EnlaceMenu[] = CASOS.map((c) => ({ href: `/soluciones/${c.slug}`, nombre: c.nombre, icono: c.icono }));

export const SOLUCIONES_ESPECIALIDADES: EnlaceMenu[] = ESPECIALIDADES.map((e) => ({
  href: `/especialidades/${e.slug}`,
  nombre: e.nombre,
  icono: e.icono,
}));

export const SOLUCIONES_ORGANIZACIONES: EnlaceMenu[] = ORGANIZACIONES.map((o) => ({
  href: `/organizaciones/${o.slug}`,
  nombre: o.nombre,
  icono: o.icono,
}));

export const RECURSOS: EnlaceMenu[] = [
  { href: "/escucha-a-nuestros-agentes", nombre: "Escuchá a nuestros agentes", detalle: "Conversaciones reales por especialidad", icono: "telefono" },
  { href: "/probar-demo", nombre: "Probalo con tu web", detalle: "Sofi atiende como tu consultorio, por chat o voz", icono: "chat" },
  { href: "/privacidad", nombre: "Privacidad", detalle: "Cómo cuidamos los datos de salud", icono: "escudo" },
];

export const EMPRESA: EnlaceMenu[] = [
  { href: "/nosotros", nombre: "Nosotros" },
  { href: "/pedi-una-demo", nombre: "Pedí una demo" },
  { href: "/pedi-una-demo#contacto", nombre: "Contacto" },
  { href: "/panel", nombre: "Ingresar al panel" },
];

/** Capacidades para la rueda "Cada paso del recorrido del paciente". */
export const CAPACIDADES: { nombre: string; href: string }[] = [
  { nombre: "Turnos 24/7", href: "/soluciones/turnos" },
  { nombre: "Admisión y coberturas", href: "/soluciones/admision" },
  { nombre: "Órdenes y derivaciones", href: "/soluciones/derivaciones" },
  { nombre: "Triage y urgencias", href: "/soluciones/triage" },
  { nombre: "Gestión de tareas", href: "/soluciones/tareas" },
  { nombre: "Lista de espera", href: "/activa" },
  { nombre: "Renovación de recetas", href: "/soluciones/recetas" },
  { nombre: "Recall de controles", href: "/soluciones/seguimiento-proactivo" },
  { nombre: "Atención fuera de horario", href: "/soluciones/fuera-de-horario" },
  { nombre: "Pagos y aranceles", href: "/soluciones/cobranzas" },
];

/** Reemplazo honesto de los logos de clientes: los canales y piezas con las que se conecta Turnia hoy, dichos como los diría una clínica. */
export const INTEGRACIONES: { nombre: string; detalle: string; icono: IconoClave }[] = [
  { nombre: "WhatsApp Business", detalle: "Texto, audios y fotos", icono: "whatsapp" },
  { nombre: "Teléfono", detalle: "Tu número o uno nuevo", icono: "telefono" },
  { nombre: "Chat web", detalle: "En la web de tu consultorio", icono: "web" },
  { nombre: "Voz natural", detalle: "Habla como una persona", icono: "chat" },
  { nombre: "Avisos al equipo", detalle: "Cuando un pedido necesita a alguien", icono: "rayo" },
  { nombre: "Google Calendar", detalle: "Próximamente", icono: "calendario" },
  { nombre: "Tus datos", detalle: "En tu cuenta, protegidos", icono: "escudo" },
  { nombre: "Tu sistema", detalle: "Le avisa cada turno", icono: "red" },
];
