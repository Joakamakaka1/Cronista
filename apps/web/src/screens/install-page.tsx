import { Share, SquarePlus } from 'lucide-react';
import type { ReactNode } from 'react';

import { useInstallPrompt } from '../push/install-prompt.ts';
import { isStandalone } from '../push/push-subscription.ts';
import { PushNotice } from './today/push-notice.tsx';
import { ScreenHeader } from './screen-header.tsx';

function Steps({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 rounded-[28px] p-[18px]">
      <h2 className="font-display text-[19px] text-heading">{title}</h2>
      <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-[16px] leading-normal text-reading">
        {children}
      </ol>
    </section>
  );
}

/**
 * The install guide: iPhone by hand from Safari, Android with Chrome's own button when it offers one.
 * iPhone only lets an app on the home screen receive pushes, and the guide says so.
 */
export function InstallPage() {
  const install = useInstallPrompt();

  if (isStandalone()) {
    return (
      <div className="flex flex-col gap-3.5 px-4 pt-[18px]">
        <ScreenHeader />
        <h1 className="px-1 font-display text-[30px] leading-none text-heading">Ya la tienes</h1>
        <p className="px-1 text-[16px] text-reading">
          Cronista está instalada en este móvil. Solo falta que te deje avisarte.
        </p>
        <PushNotice />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-[18px] pb-8">
      <ScreenHeader />
      <h1 className="px-1 font-display text-[30px] leading-none text-heading">Instala Cronista</h1>
      <p className="px-1 text-[16px] leading-normal text-reading">
        Instalada, abre como una app y te avisa cuando abre el día, si se te pasa la hora y cuando
        sale el capítulo.
      </p>

      <Steps title="En iPhone">
        <li>Abre esta página en Safari: desde Chrome u otra app no se puede.</li>
        <li>
          Toca Compartir{' '}
          <Share aria-label="(el cuadrado con la flecha)" className="inline" size={16} /> y luego
          «Añadir a pantalla de inicio» <SquarePlus aria-hidden className="inline" size={16} />.
        </li>
        <li>
          Abre Cronista desde el icono nuevo y entra otra vez con Google: la app instalada no
          comparte la sesión con Safari.
        </li>
        <li>
          Activa los avisos desde Hoy.{' '}
          <strong>En iPhone solo llegan con la app instalada así.</strong>
        </li>
      </Steps>

      <Steps title="En Android">
        <li>Abre esta página en Chrome.</li>
        <li>
          {install === null
            ? 'Toca el menú ⋮ y luego «Instalar aplicación» o «Añadir a pantalla de inicio».'
            : 'Toca el botón de aquí abajo y confirma.'}
        </li>
        <li>Abre Cronista desde el icono nuevo y activa los avisos desde Hoy.</li>
      </Steps>

      {install !== null && (
        <button
          type="button"
          className="min-h-12 rounded-full bg-primary px-5 font-bold text-on-primary"
          onClick={install}
        >
          Instalar Cronista
        </button>
      )}
    </div>
  );
}
