import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turnia es casi todo datos en vivo (agenda, conversaciones), así que usamos
  // el modelo de renderizado dinámico clásico en lugar de Cache Components.
  cacheComponents: false,
  // Cada deploy de Vercel se identifica: una pestaña abierta de una versión anterior
  // se recarga entera al navegar, en lugar de llamar a acciones que ya no existen.
  // Localmente y en CI no hay id y no cambia nada.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
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
