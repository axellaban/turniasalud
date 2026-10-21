import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { neonServerToken } from "./neon-auth";

let client: SupabaseClient | null = null;

// Cliente exclusivo del servidor: service_role en Supabase o JWT de servidor
// en Neon. RLS impide que los visitantes accedan directamente a las tablas.
export function db(): SupabaseClient {
  if (!client) {
    if (process.env.NEON_DATA_API_URL) {
      // Neon implementa PostgREST: se conservan las consultas y relaciones.
      // La URL debe terminar en /<base>, sin /rest/v1.
      client = createClient(process.env.NEON_DATA_API_URL.replace(/\/$/, ""), neonServerToken(), {
        accessToken: async () => neonServerToken(),
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } else {
      client = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }
  return client;
}

export function unwrap<T = unknown>(result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new Error(`${what}: sin datos`);
  return result.data as T;
}
