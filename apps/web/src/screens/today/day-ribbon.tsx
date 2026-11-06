import {
  CLOSING_MINUTE_OF_DAY,
  gameDayOf,
  gameMinuteOfDay,
  OPENING_MINUTE_OF_DAY,
} from '@cronista/core';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import type { Character } from '../../game/game-queries.ts';
import { cn } from '../../ui/class-names.ts';

/**
 * The day's ribbon: the stretch from 08:00 to 22:00 with a mark for now, and a seat per character
 * that lights up when its player has played. Nothing here says what anyone wrote.
 */
export function DayRibbon({
  day,
  closed,
  characters,
  playedCharacterIds,
  ownCharacterId,
}: {
  readonly day: string;
  readonly closed: boolean;
  readonly characters: readonly Character[];
  readonly playedCharacterIds: readonly number[];
  readonly ownCharacterId: number | null;
}) {
  const progress = useDayProgress(day, closed);
  const played = characters.filter(({ id }) => playedCharacterIds.includes(id)).length;

  return (
    <section aria-label="Quién ha jugado hoy" className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>08:00</span>
        <div className="relative h-px flex-1 bg-rule">
          <motion.div
            className="absolute inset-y-0 left-0 bg-pen"
            initial={{ width: 0 }}
            animate={{ width: `${String(progress * 100)}%` }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            aria-hidden
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pen ring-4 ring-paper"
            initial={{ left: '0%' }}
            animate={{ left: `${String(progress * 100)}%` }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <span>22:00</span>
      </div>

      <ul className="grid grid-cols-5 gap-2">
        {characters.map((character) => {
          const hasPlayed = playedCharacterIds.includes(character.id);
          return (
            <li key={character.id} className="flex min-w-0 flex-col items-center gap-1.5">
              <motion.span
                aria-hidden
                className={cn(
                  'grid size-10 place-items-center rounded-full border font-serif text-sm',
                  hasPlayed ? 'border-pen bg-pen text-paper' : 'border-rule text-muted',
                )}
                initial={false}
                animate={{ scale: hasPlayed ? [1, 1.18, 1] : 1 }}
                transition={{ duration: 0.45 }}
              >
                {initials(character.nickname)}
              </motion.span>
              <span
                className={cn(
                  'w-full truncate text-center text-[0.6875rem] leading-tight',
                  character.id === ownCharacterId ? 'font-semibold text-ink' : 'text-muted',
                )}
              >
                {character.nickname}
              </span>
              <span className="sr-only">{hasPlayed ? 'ha jugado' : 'no ha jugado'}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        {played === 0
          ? 'Todavía no ha jugado nadie.'
          : `Han jugado ${String(played)} de ${String(characters.length)}.`}
      </p>
    </section>
  );
}

// "La Farera" → "F": the article is not the name.
function initials(nickname: string): string {
  const words = nickname.split(/\s+/).filter((word) => !/^(el|la|los|las)$/i.test(word));
  return (words[0] ?? nickname).charAt(0).toUpperCase();
}

// How far through 08:00-22:00 the day is: full once it has closed or for a day already past.
function useDayProgress(day: string, closed: boolean): number {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  if (closed) return 1;
  const today = gameDayOf(now);
  if (today < day) return 0;
  if (today > day) return 1;
  const minute = gameMinuteOfDay(now);
  const span = CLOSING_MINUTE_OF_DAY - OPENING_MINUTE_OF_DAY;
  return Math.min(1, Math.max(0, (minute - OPENING_MINUTE_OF_DAY) / span));
}
