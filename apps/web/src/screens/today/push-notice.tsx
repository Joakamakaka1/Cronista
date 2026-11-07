import { BellRing } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import type { PushCard } from '../../push/push-card.ts';
import { usePush } from '../../push/use-push.ts';

// Where this device remembers each card the player put away, so the install card going away never
// hides the later one that turns pushes on. The account panel still offers both.
const dismissedKey = (card: PushCard) => `cronista:avisos-tarjeta:${card}`;

const copy: Readonly<Record<PushCard, { readonly title: string; readonly text: string }>> = {
  install: {
    title: 'Que el periódico te encuentre',
    text: 'Instala Cronista en el móvil y te avisará cuando abra el día, si se te pasa la hora y cuando salga el capítulo.',
  },
  enable: {
    title: 'Activa los avisos',
    text: 'A las 08:00 cuando abre el día, a las 19:00 y a las 21:00 solo si aún no has jugado, cuando otro mueve ficha y cuando sale el capítulo. Nada más.',
  },
  blocked: {
    title: 'Avisos bloqueados',
    text: 'Tu móvil no deja que Cronista te avise. En iPhone: Ajustes › Notificaciones › Cronista. En Android: mantén pulsado el icono › Información de la app › Notificaciones.',
  },
  unsupported: {
    title: 'Este móvil no recibe avisos',
    text: 'En iPhone hace falta iOS 16.4 o posterior. Mientras tanto, pásate por aquí antes de las 22:00.',
  },
};

function wasDismissed(card: PushCard): boolean {
  try {
    return localStorage.getItem(dismissedKey(card)) === 'descartada';
  } catch {
    return false;
  }
}

/**
 * The card on Today that brings pushes to this phone: the install guide first, then the button
 * that asks for permission, which only the player's tap ever triggers.
 */
export function PushNotice() {
  const { card, busy, lastResult, enable } = usePush();
  const [dismissedNow, setDismissedNow] = useState<PushCard | null>(null);
  if (card === null || card === dismissedNow || wasDismissed(card)) return null;
  const { title, text } = copy[card];

  const dismiss = () => {
    setDismissedNow(card);
    try {
      localStorage.setItem(dismissedKey(card), 'descartada');
    } catch {
      // Storage can be blocked: the card stays away until the page closes.
    }
  };

  return (
    <section
      aria-labelledby="push-notice-heading"
      className="card flex flex-col gap-3 rounded-[28px] p-[18px]"
    >
      <div className="flex items-center gap-2.5">
        <BellRing aria-hidden size={20} className="text-accent" />
        <h2 id="push-notice-heading" className="text-[15px] font-bold text-ink">
          {title}
        </h2>
      </div>
      <p className="text-[15px] leading-normal text-reading">{text}</p>
      {lastResult === 'failed' && (
        <p role="alert" className="text-[14px] font-semibold text-ink">
          No se han podido activar. Vuelve a intentarlo en un momento.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {card === 'install' && (
          <Link
            to="/instalar"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-bold text-on-primary"
          >
            Cómo instalarla
          </Link>
        )}
        {card === 'enable' && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-full bg-primary px-5 font-bold text-on-primary disabled:opacity-60"
            onClick={enable}
          >
            {busy ? 'Activando…' : 'Activar avisos'}
          </button>
        )}
        <button
          type="button"
          className="min-h-11 rounded-full px-4 font-semibold text-muted hover:bg-chip"
          onClick={dismiss}
        >
          Ahora no
        </button>
      </div>
    </section>
  );
}
