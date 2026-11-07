import { Component, type ReactNode, useEffect } from 'react';
import { useRouteError } from 'react-router';

import { reportFromStack } from './client-error-report.ts';
import { sendErrorReport } from './report-client-errors.ts';

/**
 * Catches what fails while rendering outside the routes, reports it with no free text and offers a
 * reload. React only catches render errors in a class component.
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
    return this.state.failed ? <BrokenScreen /> : this.props.children;
  }
}

/**
 * The routes' error element. React Router catches what fails inside a route before the root
 * boundary can, so it reports here too, instead of its default page with the error's text.
 */
export function RouteErrorScreen() {
  const error = useRouteError();
  useEffect(() => {
    sendErrorReport(reportFromStack(error, location.origin));
  }, [error]);
  return <BrokenScreen />;
}

function BrokenScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-[28px] leading-none text-heading">
        Algo se ha roto en esta pantalla.
      </h1>
      <p className="text-reading">
        Recarga para seguir jugando. Si vuelve a pasar, avisa en el grupo y que alguien se ría.
      </p>
      <button
        type="button"
        className="min-h-12 self-start rounded-full bg-primary px-5 font-bold text-on-primary"
        onClick={() => {
          location.reload();
        }}
      >
        Recargar
      </button>
    </main>
  );
}
