import { readdirSync } from "node:fs";
import type { NextConfig } from "next";

// Audios de las demos que vienen en el repo (public/audios/<slug>.json). El reproductor
// los pide directo y para el resto va a /api/audios, sin probar primero un archivo que no está.
const audiosDelRepo = (() => {
  try {
    return readdirSync("public/audios").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
})();

const nextConfig: NextConfig = {
  // Turnia es casi todo datos en vivo (agenda, conversaciones), así que usamos
  // el modelo de renderizado dinámico clásico en lugar de Cache Components.
  cacheComponents: false,
  // Cada deploy de Vercel se identifica: una pestaña abierta de una versión anterior
  // se recarga entera al navegar, en lugar de llamar a acciones que ya no existen.
  // Localmente y en CI no hay id y no cambia nada.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
  env: { TURNIA_AUDIOS_REPO: audiosDelRepo.join(",") },
  // Importar pacientes manda la planilla entera a una server action (hasta ~3,5 MB de CSV).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Lo pide el proxy de PostHog: sus rutas terminan en barra.
  skipTrailingSlashRedirect: true,
  // PostHog por el mismo dominio (/ingest): los bloqueadores de anuncios no cortan los eventos.
  async rewrites() {
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
    const assets = host.replace(".i.posthog.com", "-assets.i.posthog.com");
    return [
      { source: "/ingest/static/:path*", destination: `${assets}/static/:path*` },
      { source: "/ingest/array/:path*", destination: `${assets}/array/:path*` },
      { source: "/ingest/:path*", destination: `${host}/:path*` },
    ];
  },
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
