import type { Hint } from '@cronista/core';
import { motion, useReducedMotion } from 'motion/react';

import { hintErrorCopy } from '../../api/error-copy.ts';
import { Button } from '../../ui/button.tsx';

/**
 * The player's private hint on their own action: on its way, received, struck out by the censor,
 * or failed with a retry that spends nothing.
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
      className="flex flex-col gap-3 border-l-2 border-pen pl-4"
    >
      <h2 id="hint-heading" className="text-sm font-medium text-pen">
        Tu pista
      </h2>
      {hint !== null ? (
        hint.censored ? (
          <p className="prose-reading text-censor">{hint.text}</p>
        ) : (
          <p className="prose-reading text-ink">{hint.text}</p>
        )
      ) : requesting ? (
        <p role="status" className="flex items-center gap-2 text-muted">
          El narrador está leyendo tu acción
          <InkDots />
        </p>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p role={error === null ? undefined : 'alert'} className="text-muted">
            {error === null ? 'Solo tú la ves, y no promete nada.' : hintErrorCopy(error)}
          </p>
          {canRequest && (
            <Button variant="outline" onClick={onRequest}>
              Pedir la pista
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// Three dots that breathe beside the waiting line, never over the text, and keep still for a
// player who asks for less motion.
function InkDots() {
  const still = useReducedMotion() === true;
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-1.5 rounded-full bg-pen"
          animate={{ opacity: still ? 0.6 : [0.2, 1, 0.2] }}
          transition={
            still ? { duration: 0 } : { duration: 1.2, repeat: Infinity, delay: dot * 0.2 }
          }
        />
      ))}
    </span>
  );
}
