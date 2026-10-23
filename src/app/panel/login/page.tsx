import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSessionToken, safeNext } from "@/lib/session";
import { activeClinicAccess } from "@/lib/clinic-access";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/panel/login">) {
  const { next, error } = await searchParams;
  // Con la sesión vigente, el enlace del login lleva directo a su destino.
  // Un acceso de consultorio revocado se queda acá (si no, volvería al panel en bucle).
  const claims = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (claims && (claims.role === "admin" || (await activeClinicAccess(claims.accessId).catch(() => null)))) redirect(safeNext(next));
  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        <div className="rounded-3xl border border-brand-900/10 bg-white p-7 shadow-sm">
          <h1 className="font-display text-2xl text-brand-950">Panel de Turnia</h1>
          <p className="mt-1 text-sm text-brand-900/60">Ingresá con tu contraseña o con el código de acceso de tu consultorio.</p>
          <LoginForm next={safeNext(next)} error={typeof error === "string" ? error : undefined} />
        </div>
      </div>
    </main>
  );
}
