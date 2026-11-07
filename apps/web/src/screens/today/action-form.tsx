import { MAX_ACTION_CHARACTERS, type Result } from '@cronista/core';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useState } from 'react';

import { actionErrorCopy } from '../../api/error-copy.ts';
import type { StakeAllowance } from '../../game/day-view.ts';
import { stakeChips } from '../../game/stake-chips.ts';
import { STAKE_WORD } from '../../stake-word.ts';
import { cn } from '../../ui/class-names.ts';
import { SlideToConfirm } from '../../ui/slide-to-confirm.tsx';

/**
 * Today's action and stake, sent by sliding to the end: once it lands there is no way back. The
 * draft survives a failed send and a reload, and is forgotten once the action is accepted.
 */
export function ActionForm({
  day,
  characterId,
  nickname,
  allowance,
  onSend,
}: {
  readonly day: string;
  /** Drafts are kept per character, so another player on the same browser never sees one. */
  readonly characterId: number;
  readonly nickname: string;
  readonly allowance: StakeAllowance;
  readonly onSend: (action: {
    readonly text: string;
    readonly stake: number;
  }) => Promise<Result<unknown, string>>;
}) {
  const draftKey = `cronista:borrador:${String(characterId)}:${day}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [stake, setStake] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const still = useReducedMotion() === true;
  const textId = useId();
  const stakeId = useId();

  useEffect(() => {
    writeDraft(draftKey, text);
  }, [draftKey, text]);

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_ACTION_CHARACTERS;
  const max = allowance.canStake ? allowance.max : 0;
  const declared = Math.min(stake, max);
  const ready = trimmed !== '' && !tooLong;

  // A rejection sends the slider back to the start, with the text still here.
  const send = async () => {
    setError(null);
    const result = await onSend({ text: trimmed, stake: declared });
    if (!result.ok) {
      setError(actionErrorCopy(result.error));
      throw new Error(result.error);
    }
    writeDraft(draftKey, '');
  };

  return (
    <form
      className="card flex flex-col gap-[18px] rounded-[28px] p-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={textId} className="font-display text-[19px] text-heading">
            ¿Qué vas a liar?
          </label>
          <span
            id={`${textId}-count`}
            className={cn(
              'text-[13px] tabular-nums',
              tooLong ? 'font-bold text-danger' : 'text-muted',
            )}
          >
            {trimmed.length} / {MAX_ACTION_CHARACTERS}
          </span>
        </div>
        <textarea
          id={textId}
          rows={4}
          value={text}
          placeholder={`¿Qué intenta hoy ${nickname}? Es un intento: el narrador decide qué consigue.`}
          aria-describedby={`${textId}-count`}
          className="w-full resize-none rounded-[18px] bg-chip p-3.5 text-base leading-[1.55] text-ink placeholder:text-muted"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>

      {allowance.canStake ? (
        <div
          role="group"
          aria-labelledby={`${stakeId}-label`}
          aria-describedby={`${stakeId}-hint`}
          className="flex flex-col gap-2.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span id={`${stakeId}-label`} className="font-display text-[19px] text-heading">
              ¿Cuánto te juegas?
            </span>
            <span className="shrink-0 text-[13px] text-muted">
              Tienes {max} {max === 1 ? 'punto' : 'puntos'}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {stakeChips(max).map((value) => {
              const picked = value === declared;
              return (
                <motion.button
                  key={value}
                  type="button"
                  initial={false}
                  animate={picked ? { rotate: -4, scale: 1.06 } : { rotate: 0, scale: 1 }}
                  whileTap={still ? {} : { scale: 0.86 }}
                  transition={
                    still ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 16 }
                  }
                  aria-pressed={picked}
                  aria-label={`${STAKE_WORD.title} de ${String(value)}`}
                  className={cn(
                    'h-[46px] rounded-2xl font-display text-base',
                    picked ? 'sticker' : 'bg-chip text-heading',
                  )}
                  onClick={() => {
                    setStake(value);
                  }}
                >
                  {value}
                </motion.button>
              );
            })}
          </div>
          <span id={`${stakeId}-hint`} className="text-[13px] leading-[1.45] text-muted">
            Si la cagas, el narrador te despluma hasta esto. Sin lloros.
          </span>
        </div>
      ) : (
        <p className="text-[13px] leading-[1.45] text-muted">
          {allowance.reason === 'out'
            ? `Hoy estás fuera de juego: juegas desde donde estés, sin ${STAKE_WORD.lower}.`
            : `Estás a cero o en números rojos: hoy juegas sin ${STAKE_WORD.lower}.`}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <SlideToConfirm
          label="Desliza. Sin vuelta atrás"
          accessibleLabel={`Enviar tu acción con ${STAKE_WORD.lower} de ${String(declared)}. No se puede deshacer.`}
          confirmingLabel="Enviando"
          disabled={!ready}
          onConfirm={send}
        />
        {!ready && (
          <span className="text-center text-[13px] text-muted">
            {tooLong ? 'Te has pasado de largo. Recorta.' : 'Escribe algo antes de deslizar.'}
          </span>
        )}
        {error !== null && (
          <p role="alert" className="text-center font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

// Storage can be missing or blocked (private windows): the draft is a convenience, never required.
function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

// One draft per character: an earlier day's unsent text goes once another day's is written, and
// other characters' drafts on the same browser are left alone.
function writeDraft(key: string, text: string): void {
  const character = key.slice(0, key.lastIndexOf(':') + 1);
  try {
    for (const stored of Object.keys(localStorage)) {
      if (stored.startsWith(character) && stored !== key) localStorage.removeItem(stored);
    }
    if (text === '') localStorage.removeItem(key);
    else localStorage.setItem(key, text);
  } catch {
    // Nothing to do: the text is still in the form.
  }
}
