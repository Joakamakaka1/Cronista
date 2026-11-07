import type { ReactNode } from 'react';

import { Mascot } from '../brand/mascot.tsx';

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
    <div role="alert" className="flex flex-col items-start gap-3 px-5 py-12">
      <p className="font-semibold text-ink">No se ha podido cargar. Mira la conexión y reza.</p>
      <button
        type="button"
        className="min-h-11 rounded-full bg-primary px-5 font-bold text-on-primary"
        onClick={retry}
      >
        Reintentar
      </button>
    </div>
  );
}

/** A screen with nothing to show yet: the narrator says why. */
export function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 pt-24 text-center">
      <Mascot who="narrator" size={72} />
      <p className="prose-reading max-w-[22em] text-reading">{children}</p>
    </div>
  );
}
