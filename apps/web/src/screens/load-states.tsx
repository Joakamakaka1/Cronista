import type { ReactNode } from 'react';

/** A quiet placeholder while data loads. */
export function Loading({ label = 'Cargando…' }: { readonly label?: ReactNode }) {
  return (
    <p role="status" className="py-16 text-center text-muted">
      {label}
    </p>
  );
}

/** A failed read, with a retry. */
export function LoadFailed({ retry }: { readonly retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-12">
      <p className="text-ink">No se ha podido cargar. Comprueba la conexión.</p>
      <button type="button" className="font-medium text-pen" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}
