import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/panel/login">) {
  const { next } = await searchParams;
  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        <div className="rounded-3xl border border-brand-900/10 bg-white p-7 shadow-sm">
          <h1 className="font-display text-2xl text-brand-950">Panel de la clínica</h1>
          <p className="mt-1 text-sm text-brand-900/60">Ingresá con la contraseña del panel.</p>
          <LoginForm next={typeof next === "string" ? next : "/panel"} />
        </div>
      </div>
    </main>
  );
}
