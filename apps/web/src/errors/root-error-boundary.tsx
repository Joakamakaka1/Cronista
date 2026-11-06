import { Component, type ReactNode } from 'react';

import { reportFromStack } from './client-error-report.ts';
import { sendErrorReport } from './report-client-errors.ts';

/**
 * Catches what fails while rendering, reports it with no free text and offers a reload. React only
 * catches render errors in a class component.
 */
export class RootErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    sendErrorReport(reportFromStack(error, location.origin));
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-dvh max-w-prose flex-col justify-center gap-4 px-5">
        <h1 className="font-serif text-2xl text-ink">Algo se ha roto en esta pantalla.</h1>
        <p className="text-muted">
          Recarga para seguir jugando. Si vuelve a pasar, avisa en el grupo.
        </p>
        <button
          type="button"
          className="self-start rounded-md bg-pen px-4 py-2 font-medium text-paper"
          onClick={() => {
            location.reload();
          }}
        >
          Recargar
        </button>
      </main>
    );
  }
}
