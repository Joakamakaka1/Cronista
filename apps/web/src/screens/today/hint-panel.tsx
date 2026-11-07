import type { Hint } from '@cronista/core';
import { motion, useReducedMotion } from 'motion/react';

import { hintErrorCopy } from '../../api/error-copy.ts';
import { Mascot } from '../../brand/mascot.tsx';
import { RotatingText } from '../../ui/rotating-text.tsx';

const waiting = ['Afilando el cuchillo', 'Leyendo tu acción con lupa', 'Buscando dónde duele'];

/**
 * The narrator's private tip-off on the player's own action: on its way, received, struck out by
 * the censor, or failed with a retry that spends nothing.
 */
export function HintPanel({
  hint,
  requesting,
  error,
  canRequest,
  onRequest,
}: {
  readonly hint: Hint | null;
  readonly requesting: boolean;
  readonly error: string | null;
  readonly canRequest: boolean;
  readonly onRequest: () => void;
}) {
  return (
    <section
      aria-labelledby="hint-heading"
      className="hint-card flex flex-col gap-3.5 rounded-[28px] p-[18px]"
    >
      <div className="flex items-center gap-3">
        <Mascot who="narrator" size={46} />
        <div className="flex flex-col">
          <h2 id="hint-heading" className="font-display text-[19px]">
            El chivatazo
          </h2>
          <span className="text-[13px] text-hint-muted">Solo para ti. No te fíes ni de esto.</span>
        </div>
      </div>

      {hint !== null ? (
        <p
          className={
            hint.censored ? 'text-base leading-[1.55] text-[#ff6a45]' : 'text-base leading-[1.55]'
          }
        >
          {hint.text}
        </p>
      ) : requesting ? (
        <>
          <div role="status" className="flex h-[26px] items-center gap-2 overflow-hidden">
            <RotatingText texts={waiting} className="text-[15px] leading-[26px] font-semibold" />
            <Embers />
          </div>
          <div aria-hidden className="flex flex-col gap-2">
            <span className="skeleton-line h-3 w-full rounded-md" />
            <span className="skeleton-line h-3 w-[86%] rounded-md" />
            <span className="skeleton-line h-3 w-[58%] rounded-md" />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p role={error === null ? undefined : 'alert'} className="text-[15px] text-hint-muted">
            {error === null ? 'El narrador aún no ha soltado prenda.' : hintErrorCopy(error)}
          </p>
          {canRequest && (
            <button
              type="button"
              className="min-h-11 rounded-full bg-accent px-5 text-sm font-bold text-white"
              onClick={onRequest}
            >
              Pedir el chivatazo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Three embers that breathe beside the waiting line, still for a player who asks for less motion.
function Embers() {
  const still = useReducedMotion() === true;
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-[5px] rounded-full bg-accent"
          animate={{ opacity: still ? 0.65 : [0.4, 1, 0.4] }}
          transition={
            still ? { duration: 0 } : { duration: 1.2, repeat: Infinity, delay: dot * 0.2 }
          }
        />
      ))}
    </span>
  );
}
