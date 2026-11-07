import { gameDayOf, RESERVE_SITUATION } from '@cronista/core';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';

import { Blend } from '../../brand/blend.tsx';
import { Rise } from '../../brand/rise.tsx';
import { Slap } from '../../brand/slap.tsx';
import { Mascot } from '../../brand/mascot.tsx';
import { seatOf } from '../../brand/seat.ts';
import { useRequestHint, useSendAction } from '../../game/game-actions.ts';
import { type DayPhase, dayPhase, stakeAllowance } from '../../game/day-view.ts';
import { useCurrentSeason, useSeasonLedger, useToday } from '../../game/game-queries.ts';
import { paragraphs } from '../../game/paragraphs.ts';
import { seasonCalendar } from '../../game/season-calendar.ts';
import { useNow } from '../../game/use-now.ts';
import { AccountPanel } from '../account-panel.tsx';
import { Loading, LoadFailed, Notice } from '../load-states.tsx';
import { ScreenHeader } from '../screen-header.tsx';
import { ActionForm } from './action-form.tsx';
import { DayBoard } from './day-board.tsx';
import { HintPanel } from './hint-panel.tsx';
import { PlayNotices } from './play-notices.tsx';
import { SentAction } from './sent-action.tsx';

// What the top of Today says in each phase, before the player has sent anything.
const heroes: Readonly<Record<Exclude<DayPhase, 'none'>, { title: string; line: string }>> = {
  open: {
    title: 'Hoy alguien\nsale escaldado',
    line: 'A las 22:00 el narrador reparte hostias. Procura no estar en medio.',
  },
  closing: {
    title: 'Se acabó\nel recreo',
    line: 'Son más de las 22:00. El narrador está escribiendo el capítulo; saldrá aquí en cuanto lo publique.',
  },
  postponed: {
    title: 'El narrador\nse ha atascado',
    line: 'Hoy no hay capítulo. El periódico da la cara un poco más abajo.',
  },
  published: {
    title: 'Ya hay\nfiambre',
    line: 'El capítulo de hoy está publicado. Mañana a las 08:00, otro marrón.',
  },
};

/** Today: the situation or the newspaper, who has moved, and the player's action and tip-off. */
export function TodayPage() {
  const now = useNow();
  const season = useCurrentSeason();
  const today = useToday(season.data);
  const ledger = useSeasonLedger(season.data);
  const sendAction = useSendAction();
  const requestHint = useRequestHint();
  const [hintError, setHintError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  if (season.isPending || (season.data && (today.isPending || ledger.isPending))) {
    return <Loading />;
  }
  if (season.isError || today.isError || ledger.isError) {
    return (
      <LoadFailed
        retry={() => {
          void season.refetch();
          void today.refetch();
          void ledger.refetch();
        }}
      />
    );
  }
  if (season.data === null) {
    return <Notice>Todavía no hay temporada. Os avisaremos cuando empiece la carnicería.</Notice>;
  }

  const { characters, ownCharacterId, outCharacterIds } = season.data;
  const day = today.data ?? null;
  const own = characters.find(({ id }) => id === ownCharacterId);
  const ownSeat = own === undefined ? null : seatOf(characters, own.id);
  const calendar = seasonCalendar({
    number: season.data.number,
    startsOn: season.data.startsOn,
    endsOn: season.data.endsOn,
    today: day?.day ?? gameDayOf(now),
    publishedDays: (ledger.data ?? []).map((published) => published.day),
  });
  const dayOf =
    calendar.totalDays === null
      ? String(calendar.dayNumber)
      : `${String(calendar.dayNumber)}/${String(calendar.totalDays)}`;

  const account = <AccountPanel seat={ownSeat} nickname={own?.nickname ?? null} />;

  if (day === null) {
    return (
      <div className="flex flex-col gap-3.5 px-4 pt-[18px]">
        <ScreenHeader>{account}</ScreenHeader>
        <Notice>
          Temporada lista. El primer marrón sale a las 08:00 de su primer día. Ve afilando las uñas.
        </Notice>
      </div>
    );
  }

  const phase = dayPhase(day, now);
  if (phase === 'none') return <Loading />;

  const askForHint = () => {
    setHintError(null);
    void requestHint.mutateAsync().then((result) => {
      if (!result.ok) setHintError(result.error);
    });
  };

  const newspaper = phase === 'postponed' && (
    <Card>
      <h2 className="font-display text-[19px] text-heading">El periódico</h2>
      <p className="text-[17px] leading-[1.6] text-reading">
        {day.newspaperMessage ?? 'El capítulo de hoy se retrasa.'}
      </p>
    </Card>
  );

  // Sent: the action is sealed, the tip-off is on its way, and the notices say who else moved.
  if (own !== undefined && ownSeat !== null && day.ownAction !== null && phase !== 'published') {
    return (
      <div className="flex flex-col gap-3.5 px-4 pt-[18px]">
        <ScreenHeader>
          <span className="card rounded-full px-3 py-[7px] text-[13px] font-semibold text-ink">
            Día {calendar.dayNumber}
            {calendar.totalDays === null ? '' : ` de ${String(calendar.totalDays)}`}
          </span>
          {account}
        </ScreenHeader>
        {newspaper}
        <SentAction seat={ownSeat} action={day.ownAction} justSent={justSent} />
        {phase === 'closing' && (
          <p className="px-1 text-[15px] text-muted">{heroes.closing.line}</p>
        )}
        <HintPanel
          hint={day.hint}
          requesting={requestHint.isPending}
          error={hintError}
          canRequest={phase === 'open'}
          onRequest={askForHint}
        />
        <PlayNotices
          now={now}
          characters={characters}
          plays={day.plays}
          ownCharacterId={ownCharacterId}
        />
      </div>
    );
  }

  const hero = heroes[phase];

  return (
    <div className="relative">
      <Blend variant={1} className="absolute inset-x-0 top-0 h-[430px] w-full" />
      <div className="relative flex flex-col gap-3.5 px-4 pt-[18px]">
        <ScreenHeader>{account}</ScreenHeader>

        <section className="relative px-1 pt-[22px] pb-2">
          <Slap
            rotate={-4}
            delay={0.2}
            className="sticker mb-3.5 ml-0.5 rounded-[14px] px-3 py-[7px] text-base"
          >
            día {dayOf} y sigues vivo
          </Slap>
          <Rise>
            <h1 className="over-blend font-display text-[36px] leading-none whitespace-pre-line text-heading">
              {hero.title}
            </h1>
          </Rise>
          <Rise delay={0.12}>
            <p className="over-blend-strong mt-3.5 text-[15px] leading-normal font-medium text-[var(--over-blend-text)]">
              {hero.line}
            </p>
          </Rise>
        </section>

        <DayBoard
          day={day.day}
          now={now}
          open={phase === 'open'}
          calendar={calendar}
          characters={characters}
          playedCharacterIds={day.playedCharacterIds}
          ownCharacterId={ownCharacterId}
        />

        {newspaper || (
          <section aria-labelledby="situation-heading">
            <Card>
              <div className="flex items-center gap-2.5">
                <Mascot who="narrator" size={38} alive />
                <div className="flex flex-col">
                  <h2 id="situation-heading" className="text-[15px] font-bold text-ink">
                    El marrón de hoy
                  </h2>
                  <span className="text-[13px] text-muted">
                    {day.situation === RESERVE_SITUATION
                      ? 'Cortesía del periódico: el narrador no se presentó'
                      : 'Cortesía del narrador, a las 08:00'}
                  </span>
                </div>
              </div>
              <div className="prose-reading text-[17px] leading-[1.6]">
                {paragraphs(day.situation).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </Card>
          </section>
        )}

        {phase === 'published' && (
          <Card>
            <p className="font-semibold text-ink">El capítulo de este día ya está publicado.</p>
            <Link
              to={`/capitulos/${day.day}`}
              className="flex min-h-[54px] items-center justify-center rounded-full bg-primary text-[15px] font-bold text-on-primary"
            >
              Leer el capítulo
            </Link>
          </Card>
        )}

        {phase === 'open' &&
          (own === undefined ? (
            <Card>
              <p className="text-reading">
                No tienes personaje en esta temporada: puedes mirar, pero no jugar.
              </p>
            </Card>
          ) : (
            <ActionForm
              key={day.day}
              day={day.day}
              characterId={own.id}
              nickname={own.nickname}
              allowance={stakeAllowance({
                balance: own.balance,
                out: outCharacterIds.includes(own.id),
              })}
              onSend={async (action) => {
                const result = await sendAction.mutateAsync(action);
                if (result.ok) {
                  setJustSent(true);
                  askForHint();
                }
                return result;
              }}
            />
          ))}

        {(phase === 'closing' || phase === 'postponed') && own !== undefined && (
          <Card>
            <p className="text-reading">
              No moviste ficha: el piloto automático moverá a {own.nickname}. Y eso cuesta 1.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ children }: { readonly children: ReactNode }) {
  return <div className="card flex flex-col gap-3 rounded-[28px] p-[18px]">{children}</div>;
}
