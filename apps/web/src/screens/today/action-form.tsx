import { MAX_ACTION_CHARACTERS, type Result } from '@cronista/core';
import { Minus, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';

import { actionErrorCopy } from '../../api/error-copy.ts';
import type { StakeAllowance } from '../../game/day-view.ts';
import { pointsLabel } from '../../game/points-label.ts';
import { STAKE_WORD } from '../../stake-word.ts';
import { Button } from '../../ui/button.tsx';
import { Textarea } from '../../ui/textarea.tsx';

/**
 * Today's action and stake, with a second step that says it cannot be edited. The draft survives a
 * failed send and a reload, and is forgotten once the action is accepted.
 */
export function ActionForm({
  day,
  characterId,
  nickname,
  allowance,
  sending,
  onSend,
}: {
  readonly day: string;
  /** Drafts are kept per character, so another player on the same browser never sees one. */
  readonly characterId: number;
  readonly nickname: string;
  readonly allowance: StakeAllowance;
  readonly sending: boolean;
  readonly onSend: (action: {
    readonly text: string;
    readonly stake: number;
  }) => Promise<Result<unknown, string>>;
}) {
  const draftKey = `cronista:borrador:${String(characterId)}:${day}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [stake, setStake] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const stakeId = useId();

  useEffect(() => {
    writeDraft(draftKey, text);
  }, [draftKey, text]);

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_ACTION_CHARACTERS;
  const max = allowance.canStake ? allowance.max : 0;
  const declared = Math.min(stake, max);

  const send = async () => {
    setError(null);
    const result = await onSend({ text: trimmed, stake: declared });
    if (result.ok) {
      writeDraft(draftKey, '');
    } else {
      setConfirming(false);
      setError(actionErrorCopy(result.error));
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-5 rounded-xl border border-pen/40 bg-sheet p-5"
          >
            <h2 className="font-medium text-ink">¿Envías esta acción?</h2>
            <p className="prose-reading whitespace-pre-line text-ink">{trimmed}</p>
            <p className="text-sm text-muted">
              {allowance.canStake
                ? `${STAKE_WORD.title}: ${pointsLabel(declared)}.`
                : `Sin ${STAKE_WORD.lower}.`}{' '}
              Una vez enviada no se puede editar ni retirar.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button disabled={sending} onClick={() => void send()}>
                {sending ? 'Enviando…' : 'Enviar acción'}
              </Button>
              <Button
                variant="quiet"
                disabled={sending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Seguir editando
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="edit"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed !== '' && !tooLong) setConfirming(true);
            }}
          >
            <div className="flex flex-col gap-2">
              <label id={textId} htmlFor={`${textId}-field`} className="font-medium text-ink">
                Tu acción
              </label>
              <Textarea
                id={`${textId}-field`}
                rows={6}
                value={text}
                placeholder={`¿Qué intenta hoy ${nickname}?`}
                aria-describedby={`${textId}-count`}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
              <p
                id={`${textId}-count`}
                className={tooLong ? 'text-sm text-censor' : 'text-sm text-muted'}
              >
                {trimmed.length} de {MAX_ACTION_CHARACTERS} caracteres. Es un intento: el narrador
                decide qué consigue.
              </p>
            </div>

            {allowance.canStake ? (
              <div className="flex flex-col gap-2">
                <label htmlFor={stakeId} className="font-medium text-ink">
                  {STAKE_WORD.title}
                </label>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 px-0"
                    aria-label={`Bajar ${STAKE_WORD.the}`}
                    disabled={declared <= 0}
                    onClick={() => {
                      setStake(Math.max(0, declared - 1));
                    }}
                  >
                    <Minus aria-hidden size={18} />
                  </Button>
                  <input
                    id={stakeId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={max}
                    value={declared}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      setStake(Number.isNaN(value) ? 0 : Math.max(0, Math.min(max, value)));
                    }}
                    className="h-11 w-16 rounded-lg border border-rule bg-sheet text-center font-serif text-lg tabular-nums text-ink"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 px-0"
                    aria-label={`Subir ${STAKE_WORD.the}`}
                    disabled={declared >= max}
                    onClick={() => {
                      setStake(Math.min(max, declared + 1));
                    }}
                  >
                    <Plus aria-hidden size={18} />
                  </Button>
                  <span className="text-sm text-muted">de {pointsLabel(max)}</span>
                </div>
                <p className="text-sm text-muted">
                  Lo máximo que el narrador puede cobrarte por esta acción. Lo que no cobre vuelve a
                  tu saldo.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {allowance.reason === 'out'
                  ? `Hoy tu personaje está fuera: juegas desde donde esté, sin ${STAKE_WORD.lower}.`
                  : `Tu saldo está a cero o por debajo: hoy juegas sin ${STAKE_WORD.lower}.`}
              </p>
            )}

            <Button type="submit" disabled={trimmed === '' || tooLong}>
              Revisar y enviar
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      {error !== null && (
        <p role="alert" className="text-censor">
          {error}
        </p>
      )}
    </section>
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
