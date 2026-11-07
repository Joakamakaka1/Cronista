import { Lock } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { Blend } from '../../brand/blend.tsx';
import { Mascot } from '../../brand/mascot.tsx';
import type { Seat } from '../../brand/seat.ts';
import { Slap } from '../../brand/slap.tsx';
import { STAKE_WORD } from '../../stake-word.ts';
import { ParticlesBurst } from '../../ui/particles.tsx';
import { SpringCheck } from '../../ui/spring-check.tsx';

const sentTime = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});

/**
 * The player's own action once sent: sealed, with its time and stake, and no way to take it back.
 * Right after sending, a tick springs in with one burst of sparks.
 */
export function SentAction({
  seat,
  action,
  justSent,
}: {
  readonly seat: Seat;
  readonly action: { readonly text: string; readonly stake: number; readonly sentAt: string };
  readonly justSent: boolean;
}) {
  const still = useReducedMotion() === true;
  return (
    <section
      aria-labelledby="sent-heading"
      className="card flex flex-col overflow-hidden rounded-[32px]"
    >
      <div className="relative h-[300px] overflow-hidden bg-bg">
        <Blend variant={2} className="absolute inset-0 h-full w-full" />
        <motion.div
          className="absolute top-[52px] left-1/2 -translate-x-1/2"
          initial={justSent && !still ? { y: 160, scale: 0.6, rotate: -12 } : false}
          animate={{ y: 0, scale: 1, rotate: 0 }}
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 15 }}
        >
          <Mascot who={seat} size={190} alive />
          {justSent && (
            <span className="absolute right-0 bottom-2">
              <ParticlesBurst />
              <SpringCheck size={44} />
            </span>
          )}
        </motion.div>
        <Slap
          rotate={-8}
          delay={justSent ? 0.45 : 0.1}
          className="sticker absolute top-[30px] left-[34px] rounded-2xl px-3.5 py-2 text-[21px] shadow-[inset_0_0_0_2.5px_var(--sticker-border),5px_5px_0_var(--sticker-shadow)]"
        >
          ¡Sin vuelta atrás!
        </Slap>
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] py-5">
        <h2 id="sent-heading" className="font-display text-[27px] leading-none text-heading">
          Ya está. Ahora reza para que el narrador no te tenga manía.
        </h2>
        <ul className="flex flex-wrap gap-1.5 text-[13px] font-semibold text-ink">
          <li className="rounded-full bg-chip px-[11px] py-1.5">
            <span className="sr-only">Enviada a las </span>
            {sentTime.format(new Date(action.sentAt))}
          </li>
          <li className="rounded-full bg-chip px-[11px] py-1.5">
            {action.stake === 0
              ? `Sin ${STAKE_WORD.lower}`
              : `${STAKE_WORD.title} de ${String(action.stake)}`}
          </li>
          <li className="inline-flex items-center gap-[5px] rounded-full bg-chip px-[11px] py-1.5">
            <Lock aria-hidden size={13} strokeWidth={2.4} />
            Sellada y sin perdón
          </li>
        </ul>
        <p className="text-base leading-[1.55] whitespace-pre-line text-reading">{action.text}</p>
        <p className="text-[13px] text-muted">Solo tú la ves hasta el capítulo.</p>
      </div>
    </section>
  );
}
