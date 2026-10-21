import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turnia es casi todo datos en vivo (agenda, conversaciones), así que usamos
  // el modelo de renderizado dinámico clásico en lugar de Cache Components.
  cacheComponents: false,
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
