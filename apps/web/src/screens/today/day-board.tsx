import { Check } from 'lucide-react';

import { Mascot } from '../../brand/mascot.tsx';
import { seatOf } from '../../brand/seat.ts';
import { timeLeftToClose } from '../../game/clock-labels.ts';
import type { Character } from '../../game/game-queries.ts';
import { shortName } from '../../game/nickname.ts';
import type { SeasonCalendar } from '../../game/season-calendar.ts';
import { cn } from '../../ui/class-names.ts';

/**
 * The day at a glance: time left to 22:00, days survived, and a seat per character that lights up
 * once its player has moved. Nothing here says what anyone wrote.
 */
export function DayBoard({
  day,
  now,
  open,
  calendar,
  characters,
  playedCharacterIds,
  ownCharacterId,
}: {
  readonly day: string;
  readonly now: Date;
  readonly open: boolean;
  readonly calendar: SeasonCalendar;
  readonly characters: readonly Character[];
  readonly playedCharacterIds: readonly number[];
  readonly ownCharacterId: number | null;
}) {
  const played = characters.filter(({ id }) => playedCharacterIds.includes(id)).length;
  const missing = characters.length - played;
  const seated = [...characters].sort((first, second) => first.id - second.id);
  const clock = open ? timeLeftToClose(now, day) : '22:00';

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="relative flex h-[150px] flex-col justify-between overflow-hidden rounded-[28px] bg-accent p-4 text-white">
        <span className="text-[15px] font-bold text-accent-soft">
          {open ? 'Te quedan' : 'Plazo'}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'font-display leading-none tabular-nums',
              clock.length > 4 ? 'text-[36px]' : 'text-[46px]',
            )}
          >
            {clock}
          </span>
          <span className="text-base font-bold">{open ? 'h' : 'cerrado'}</span>
        </span>
      </div>

      <div className="card flex h-[150px] flex-col justify-between rounded-[28px] p-4">
        <span className="text-[15px] font-bold text-muted">Sigues vivo</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-[46px] leading-none text-heading tabular-nums">
            {calendar.daysSurvived}
          </span>
          <span className="text-base font-bold text-muted">
            {calendar.daysSurvived === 1 ? 'día' : 'días'}
          </span>
        </span>
        <span aria-hidden className="grid grid-cols-7 gap-[3px]">
          {calendar.week.map(({ state }, index) => (
            <span
              key={index}
              className={cn(
                'h-1.5 rounded-[3px]',
                state === 'done' ? 'bg-track-done' : state === 'today' ? 'bg-accent' : 'bg-track',
              )}
            />
          ))}
        </span>
      </div>

      <section
        aria-labelledby="played-heading"
        className="card col-span-2 flex flex-col gap-3.5 rounded-[28px] p-4"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="played-heading" className="text-[15px] font-bold text-ink">
            Han movido ficha {played} de {characters.length}
          </h2>
          <span className="text-[13px] text-muted">
            {missing === 0
              ? 'Ni una gallina'
              : missing === 1
                ? 'Falta 1 gallina'
                : `Faltan ${String(missing)} gallinas`}
          </span>
        </div>
        <ul className="grid grid-cols-5 gap-1">
          {seated.map((character) => {
            const hasPlayed = playedCharacterIds.includes(character.id);
            const own = character.id === ownCharacterId;
            return (
              <li key={character.id} className="flex min-w-0 flex-col items-center gap-1.5">
                <span className={cn('relative block', !hasPlayed && 'opacity-50 grayscale')}>
                  <Mascot who={seatOf(characters, character.id)} size={58} />
                  {hasPlayed && (
                    <span
                      aria-hidden
                      className="absolute -right-[3px] -bottom-px grid size-5 place-items-center rounded-full bg-sticker-ink text-white shadow-[0_0_0_2.5px_var(--card)]"
                    >
                      <Check size={11} strokeWidth={3.5} />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'w-full truncate text-center text-xs font-semibold',
                    hasPlayed ? 'text-ink' : 'text-muted',
                  )}
                >
                  {own ? 'Tú' : shortName(character.nickname)}
                </span>
                <span className="sr-only">
                  {character.nickname}, {hasPlayed ? 'ha jugado' : 'no ha jugado'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
