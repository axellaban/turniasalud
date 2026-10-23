import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turnia es casi todo datos en vivo (agenda, conversaciones), así que usamos
  // el modelo de renderizado dinámico clásico en lugar de Cache Components.
  cacheComponents: false,
  // Cada deploy de Vercel se identifica: una pestaña abierta de una versión anterior
  // se recarga entera al navegar, en lugar de llamar a acciones que ya no existen.
  // Localmente y en CI no hay id y no cambia nada.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
  // Direcciones parecidas a las del panel (singular, sin tilde, abreviadas) llevan a la
  // página correcta en lugar de un 404. Son temporales (307): no quedan cacheadas.
  async redirects() {
    const alias: Array<[string, string]> = [
      ["clinica", "clinicas"], ["clínica", "clinicas"], ["clínicas", "clinicas"],
      ["demo", "demos"], ["pedidos", "demos"],
      ["paciente", "pacientes"], ["conversacion", "conversaciones"], ["conversación", "conversaciones"], ["chats", "conversaciones"],
      ["tarea", "tareas"], ["campana", "campanas"], ["campaña", "campanas"], ["campañas", "campanas"],
      ["config", "configuracion"], ["configuración", "configuracion"], ["ajustes", "configuracion"],
      ["inicio", ""], ["home", ""],
    ];
    return alias.map(([from, to]) => ({ source: `/panel/${encodeURI(from)}`, destination: `/panel${to ? `/${to}` : ""}`, permanent: false }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
