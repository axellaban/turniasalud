// Mientras el servidor arma la página, el panel muestra su forma: la navegación responde al instante.
export default function PanelLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-56 rounded-lg bg-brand-900/10" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-brand-900/5" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl border border-brand-900/10 bg-white" />)}
      </div>
      <div className="mt-6 h-64 rounded-2xl border border-brand-900/10 bg-white" />
    </div>
  );
}
