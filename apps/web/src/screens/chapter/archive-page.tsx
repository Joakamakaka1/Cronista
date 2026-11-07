import { gameDayOf } from '@cronista/core';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';

import { Blend } from '../../brand/blend.tsx';
import { Mascot } from '../../brand/mascot.tsx';
import { Rise } from '../../brand/rise.tsx';
import { Slap } from '../../brand/slap.tsx';
import { seatOf } from '../../brand/seat.ts';
import { seasonLabel } from '../../game/day-label.ts';
import {
  type ArchiveEntry,
  type Character,
  useArchive,
  useCurrentSeason,
  useToday,
} from '../../game/game-queries.ts';
import { seasonCalendar } from '../../game/season-calendar.ts';
import { useNow } from '../../game/use-now.ts';
import { AnimatedGroup } from '../../ui/animated-group.tsx';
import { cn } from '../../ui/class-names.ts';
import { Loading, LoadFailed } from '../load-states.tsx';

const numberWords = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'] as const;
const cardDate = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/** The season: its calendar, then every published chapter, newest first. */
export function ArchivePage() {
  const now = useNow();
  const archive = useArchive();
  const season = useCurrentSeason();
  const today = useToday(season.data);
  const still = useReducedMotion() === true;

  if (archive.isPending || season.isPending) return <Loading />;
  if (archive.isError || season.isError) {
    return (
      <LoadFailed
        retry={() => {
          void archive.refetch();
          void season.refetch();
        }}
      />
    );
  }

  const current = season.data;
  const multipleSeasons = new Set(archive.data.map(({ seasonNumber }) => seasonNumber)).size > 1;
  const calendar =
    current === null
      ? null
      : seasonCalendar({
          number: current.number,
          startsOn: current.startsOn,
          endsOn: current.endsOn,
          today: today.data?.day ?? gameDayOf(now),
          publishedDays: archive.data
            .filter(({ seasonNumber }) => seasonNumber === current.number)
            .map(({ day }) => day),
        });
  const chapters = archive.data.filter(
    ({ seasonNumber }) => current === null || seasonNumber === current.number,
  ).length;

  return (
    <div className="relative">
      <Blend variant={3} className="absolute inset-x-0 top-0 h-[300px] w-full" />
      <div className="relative flex flex-col gap-3.5 px-4 pt-[22px]">
        <div className="flex flex-col items-start gap-4 px-1 pt-3.5 pb-1.5">
          <Slap
            rotate={-4}
            delay={0.15}
            className="sticker sticker-strong rounded-[14px] bg-accent px-3 py-1.5 text-base text-white"
          >
            que empiece la carnicería
          </Slap>
          <Rise>
            <h1 className="over-blend font-display text-[40px] leading-none whitespace-pre-line text-heading">
              {current === null
                ? 'Capítulos'
                : current.number === 0
                  ? 'Temporada\ncero'
                  : `Temporada\n${numberWords[current.number] ?? String(current.number)}`}
            </h1>
          </Rise>
        </div>

        {calendar !== null && (
          <section
            aria-label="Días de la temporada"
            className="card flex flex-col gap-3 rounded-[28px] p-4"
          >
            <div
              aria-hidden
              className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted"
            >
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <ol className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: calendar.leadingBlanks }, (_, index) => (
                <li key={`blank-${String(index)}`} aria-hidden />
              ))}
              {calendar.days.map((day, index) => (
                <motion.li
                  key={day.date}
                  aria-label={day.label}
                  initial={still ? false : { scale: 0.4, opacity: 0 }}
                  animate={
                    day.state === 'today'
                      ? { scale: 1, opacity: 1, rotate: -6 }
                      : { scale: 1, opacity: 1 }
                  }
                  whileTap={still ? {} : { scale: 0.88 }}
                  transition={
                    still
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 18, delay: 0.2 + index * 0.018 }
                  }
                  className={cn(
                    'grid aspect-square place-items-center rounded-[14px] font-display text-[15px]',
                    day.state === 'done' &&
                      'bg-[var(--calendar-done)] text-[var(--calendar-done-ink)]',
                    day.state === 'today' && 'sticker-strong bg-accent text-white',
                    day.state === 'future' &&
                      'text-muted shadow-[inset_0_0_0_1.5px_var(--hairline)]',
                  )}
                >
                  {day.dayOfMonth}
                </motion.li>
              ))}
            </ol>
            <div className="flex justify-between gap-2 text-[13px] text-muted">
              <span>
                {chapters === 1 ? '1 capítulo' : `${String(chapters)} capítulos`}, ningún final
                feliz
              </span>
              {calendar.endsOn !== null && (
                <span>
                  Funeral el{' '}
                  {cardDate.format(new Date(`${calendar.endsOn}T12:00:00Z`)).replace(',', '')}
                </span>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="chapters-heading" className="flex flex-col gap-2">
          <h2
            id="chapters-heading"
            className="mx-1 mt-2.5 mb-1 font-display text-2xl leading-none text-heading"
          >
            Capítulos
          </h2>
          {archive.data.length === 0 ? (
            <p className="px-1 text-[15px] text-muted">
              Aún no hay capítulos. El primero se publica a las 22:00 del primer día.
            </p>
          ) : (
            <AnimatedGroup className="flex flex-col gap-2">
              {archive.data.map((entry) => ({
                key: `${String(entry.seasonNumber)}-${entry.day}`,
                node: (
                  <ChapterCard
                    entry={entry}
                    characters={current?.characters ?? []}
                    seasonPrefix={
                      multipleSeasons && entry.seasonNumber !== current?.number
                        ? seasonLabel(entry.seasonNumber)
                        : null
                    }
                  />
                ),
              }))}
            </AnimatedGroup>
          )}
        </section>

        <motion.div
          aria-hidden
          className="hazard-tape -mx-12 mt-10 mb-6 flex h-[34px] rotate-4 items-center justify-center"
          initial={still ? false : { x: '110%' }}
          whileInView={{ x: 0 }}
          viewport={{ once: true }}
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
        >
          <span className="rounded-md bg-sticker-ink px-3 py-[3px] font-display text-[13px] tracking-[0.04em] text-white">
            NADIE SALE LIMPIO
          </span>
        </motion.div>
      </div>
    </div>
  );
}

function ChapterCard({
  entry,
  characters,
  seasonPrefix,
}: {
  readonly entry: ArchiveEntry;
  readonly characters: readonly Character[];
  readonly seasonPrefix: string | null;
}) {
  const date = cardDate.format(new Date(`${entry.day}T12:00:00Z`)).replace(',', '');
  return (
    <Link
      to={`/capitulos/${entry.day}`}
      className="card grid grid-cols-[66px_minmax(0,1fr)] items-center gap-3 rounded-[26px] py-3.5 pr-4 pl-3.5"
    >
      <span className="font-display text-4xl leading-none text-accent">
        {String(entry.number).padStart(2, '0')}
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="font-display text-lg leading-[1.02] text-ink">{entry.title}</span>
        <span className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted first-letter:uppercase">
            {seasonPrefix === null ? '' : `${seasonPrefix}, `}
            {date}, {entry.minutes} min
          </span>
          <span aria-hidden className="flex pl-2">
            {entry.actedCharacterIds.map((id) => (
              <span key={id} className="-ml-2 block">
                <Mascot who={seatOf(characters, id)} size={30} />
              </span>
            ))}
          </span>
        </span>
      </span>
    </Link>
  );
}
