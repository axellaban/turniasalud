export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <path d="M9 10.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3h-4.2L11.5 24v-4.1A3 3 0 0 1 9 17z" className="fill-white" />
      <path d="M16 10.6v6.3M12.85 13.75h6.3" className="stroke-brand-600" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className={`text-lg font-semibold tracking-tight ${light ? "text-white" : "text-brand-950"}`}>
        Turnia <span className={light ? "text-brand-200" : "text-brand-600"}>Salud</span>
      </span>
    </span>
  );
}
