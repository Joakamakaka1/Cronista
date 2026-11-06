import { RESERVE_SITUATION } from '@cronista/core';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';

import { useRequestHint, useSendAction } from '../../game/game-actions.ts';
import { dayLabel, seasonLabel } from '../../game/day-label.ts';
import { dayPhase, stakeAllowance } from '../../game/day-view.ts';
import { paragraphs } from '../../game/paragraphs.ts';
import { useCurrentSeason, useToday } from '../../game/game-queries.ts';
import { STAKE_WORD } from '../../stake-word.ts';
import { Button } from '../../ui/button.tsx';
import { Loading, LoadFailed } from '../app-shell.tsx';
import { ActionForm } from './action-form.tsx';
import { DayRibbon } from './day-ribbon.tsx';
import { HintPanel } from './hint-panel.tsx';

/** Today: the situation or the newspaper, who has played, and the player's action and hint. */
export function TodayPage() {
  const season = useCurrentSeason();
  const today = useToday(season.data);
  const sendAction = useSendAction();
  const requestHint = useRequestHint();
  const [hintError, setHintError] = useState<string | null>(null);

  if (season.isPending || (season.data && today.isPending)) return <Loading />;
  if (season.isError || today.isError) {
    return (
      <LoadFailed
        retry={() => {
          void season.refetch();
          void today.refetch();
        }}
      />
    );
  }
  if (season.data === null) {
    return (
      <Notice>Todavía no hay ninguna temporada en marcha. Os avisaremos cuando empiece.</Notice>
    );
  }

  const { characters, ownCharacterId, outCharacterIds, lastPublishedDay } = season.data;
  const day = today.data ?? null;
  const phase = dayPhase(day, new Date());
  const own = characters.find(({ id }) => id === ownCharacterId);

  const askForHint = () => {
    setHintError(null);
    void requestHint.mutateAsync().then((result) => {
      if (!result.ok) setHintError(result.error);
    });
  };

  if (day === null) {
    return (
      <Notice>
        {seasonLabel(season.data.number)} lista. La primera situación sale a las 08:00 de su primer
        día.
      </Notice>
    );
  }

  return (
    <article className="flex flex-col gap-9 pt-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{seasonLabel(season.data.number)}</p>
        <h1 className="font-serif text-[2rem] leading-tight font-semibold tracking-tight text-ink first-letter:uppercase [font-variation-settings:'opsz'_48]">
          {dayLabel(day.day)}
        </h1>
      </header>

      <DayRibbon
        day={day.day}
        closed={phase !== 'open'}
        characters={characters}
        playedCharacterIds={day.playedCharacterIds}
        ownCharacterId={ownCharacterId}
      />

      {phase === 'postponed' ? (
        <Newspaper>{day.newspaperMessage ?? 'El capítulo de hoy se retrasa.'}</Newspaper>
      ) : (
        <section aria-labelledby="situation-heading" className="flex flex-col gap-3">
          <h2 id="situation-heading" className="text-sm font-medium text-muted">
            {day.situation === RESERVE_SITUATION
              ? 'La situación, según el periódico'
              : 'La situación'}
          </h2>
          <div className="prose-reading text-ink">
            {paragraphs(day.situation).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {phase === 'published' && (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-sheet p-5">
          <p className="text-ink">El capítulo de este día ya está publicado.</p>
          <Button asChild>
            <Link to={`/capitulos/${day.day}`}>Leer el capítulo</Link>
          </Button>
          <p className="text-sm text-muted">El próximo día abre a las 08:00.</p>
        </div>
      )}

      {phase === 'postponed' && lastPublishedDay !== null && (
        <p className="text-sm text-muted">
          El último capítulo publicado es el del{' '}
          <Link className="text-pen underline" to={`/capitulos/${lastPublishedDay}`}>
            {dayLabel(lastPublishedDay)}
          </Link>
          .
        </p>
      )}

      {(phase === 'open' || phase === 'closing') &&
        (own === undefined ? (
          <Notice>No tienes personaje en esta temporada: puedes leer, pero no jugar.</Notice>
        ) : day.ownAction !== null ? (
          <>
            <section aria-labelledby="own-action-heading" className="flex flex-col gap-2">
              <h2 id="own-action-heading" className="text-sm font-medium text-muted">
                Tu acción, enviada
              </h2>
              <p className="prose-reading whitespace-pre-line text-ink">{day.ownAction.text}</p>
              <p className="text-sm text-muted">
                {STAKE_WORD.title}: {day.ownAction.stake}. Solo tú la ves hasta el capítulo.
              </p>
            </section>
            <HintPanel
              hint={day.hint}
              requesting={requestHint.isPending}
              error={hintError}
              canRequest={phase === 'open'}
              onRequest={askForHint}
            />
          </>
        ) : phase === 'open' ? (
          <ActionForm
            day={day.day}
            nickname={own.nickname}
            allowance={stakeAllowance({
              balance: own.balance,
              out: outCharacterIds.includes(own.id),
            })}
            sending={sendAction.isPending}
            onSend={async (action) => {
              const result = await sendAction.mutateAsync(action);
              if (result.ok) askForHint();
              return result.ok ? { ok: true } : result;
            }}
          />
        ) : (
          <Notice>No enviaste acción hoy: el piloto automático moverá a {own.nickname}.</Notice>
        ))}

      {phase === 'closing' && (
        <p className="text-muted">
          Son más de las 22:00. El narrador está escribiendo el capítulo; aparecerá aquí en cuanto
          se publique.
        </p>
      )}
    </article>
  );
}

function Notice({ children }: { readonly children: ReactNode }) {
  return <p className="prose-reading pt-10 text-muted">{children}</p>;
}

// The newspaper's voice: fixed messages from the game, set apart from the narrator's text.
function Newspaper({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-label="El periódico" className="flex flex-col gap-2 border-y border-ink py-4">
      <h2 className="font-serif text-sm font-semibold tracking-wide text-ink">El periódico</h2>
      <p className="prose-reading text-ink">{children}</p>
    </section>
  );
}
