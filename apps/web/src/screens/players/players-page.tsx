import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Mascot } from '../../brand/mascot.tsx';
import { RepeatWords } from '../../brand/repeat-words.tsx';
import { type Seat, seatOf } from '../../brand/seat.ts';
import { Slap } from '../../brand/slap.tsx';
import { characterStats, rankLabel } from '../../game/character-stats.ts';
import { useCanon, useCurrentSeason, useSeasonLedger } from '../../game/game-queries.ts';
import { inSentence, patternWord } from '../../game/nickname.ts';
import { signedPoints } from '../../game/points-label.ts';
import { CardFlip } from '../../ui/card-flip.tsx';
import { cn } from '../../ui/class-names.ts';
import { CountUp } from '../../ui/count-up.tsx';
import { Loading, LoadFailed, Notice } from '../load-states.tsx';

// Each seat's card: its colour, the tone-on-tone word, the text on it and its bars.
const seatCards: Readonly<Record<Seat, { bg: string; pattern: string; fg: string; bar: string }>> =
  {
    0: { bg: '#ffb21f', pattern: '#ffc451', fg: '#1f1e1b', bar: '#ffb21f' },
    1: { bg: '#2a97ff', pattern: '#4aa8ff', fg: '#0d1b2e', bar: '#2a97ff' },
    2: { bg: '#22c493', pattern: '#45d3a8', fg: '#0b2a20', bar: '#22c493' },
    3: { bg: '#33309e', pattern: '#4240b3', fg: '#ffffff', bar: '#4a46c8' },
    4: { bg: '#f44612', pattern: '#f95f30', fg: '#1f1e1b', bar: '#f44612' },
  };

/** Each character's card, form, belongings and record, as of the latest published chapter. */
export function PlayersPage() {
  const season = useCurrentSeason();
  const canon = useCanon(season.data);
  const ledger = useSeasonLedger(season.data);
  const [picked, setPicked] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const still = useReducedMotion() === true;
  const spring = still
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 380, damping: 18 } as const);

  if (season.isPending || (season.data && (canon.isPending || ledger.isPending))) {
    return <Loading />;
  }
  if (season.isError || canon.isError || ledger.isError) {
    return (
      <LoadFailed
        retry={() => {
          void season.refetch();
          void canon.refetch();
          void ledger.refetch();
        }}
      />
    );
  }
  if (season.data === null) return <Notice>Todavía no hay temporada, ni sospechosos.</Notice>;

  const { characters, ownCharacterId, outCharacterIds, startsOn } = season.data;
  const seated = [...characters].sort((first, second) => first.id - second.id);
  const current =
    seated.find(({ id }) => id === picked) ??
    seated.find(({ id }) => id === ownCharacterId) ??
    seated[0];
  if (current === undefined) return <Notice>Esta temporada no tiene personajes.</Notice>;

  const seat = seatOf(characters, current.id);
  const look = seatCards[seat];
  const stats = characterStats({
    characterId: current.id,
    characters,
    ledger: ledger.data ?? [],
    startsOn,
  });
  const nickname = (id: number) =>
    characters.find((character) => character.id === id)?.nickname ?? '¿?';
  const items = (canon.data?.items ?? []).filter(
    ({ ownerCharacterId }) => ownerCharacterId === current.id,
  );
  const debts = canon.data?.openDebts ?? [];
  const owes = debts.filter(({ debtorCharacterId }) => debtorCharacterId === current.id);
  const owed = debts.filter(({ creditorCharacterId }) => creditorCharacterId === current.id);
  const out = outCharacterIds.includes(current.id);
  const highest = Math.max(1, ...stats.balances.map(({ balance }) => balance));

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-[22px]">
      <div className="flex items-end justify-between px-1">
        <h1 className="font-display text-[30px] leading-none text-heading">Personajes</h1>
        <span className="pb-1 text-[13px] text-muted">Aún respiran</span>
      </div>

      <ul aria-label="Elegir personaje" className="grid grid-cols-5 gap-1.5">
        {seated.map((character) => {
          const chosen = character.id === current.id;
          return (
            <li key={character.id} className="flex justify-center">
              <motion.button
                type="button"
                aria-pressed={chosen}
                aria-label={character.nickname}
                className={cn(
                  'grid size-16 place-items-center rounded-3xl',
                  chosen && 'sticker sticker-strong',
                )}
                initial={false}
                animate={chosen ? { rotate: -4, scale: 1.04 } : { rotate: 0, scale: 1 }}
                whileTap={still ? {} : { scale: 0.86 }}
                transition={spring}
                onClick={() => {
                  setPicked(character.id);
                  setFlipped(false);
                }}
              >
                <Mascot who={seatOf(characters, character.id)} size={54} />
              </motion.button>
            </li>
          );
        })}
      </ul>

      <section
        aria-live="polite"
        aria-label={current.nickname}
        className="relative h-[430px] overflow-hidden rounded-[34px] transition-colors duration-500"
        style={{ backgroundColor: look.bg }}
      >
        <RepeatWords
          key={`words-${String(current.id)}`}
          word={patternWord(current.nickname)}
          count={5}
          color={look.pattern}
          className="absolute -top-2.5 -left-8 w-[520px] -rotate-8 text-[81px]"
        />
        <Slap
          key={`rank-${String(current.id)}`}
          rotate={-6}
          delay={0.15}
          className="sticker sticker-strong absolute top-[18px] left-[18px] rounded-[15px] px-[13px] py-[7px] text-[19px]"
        >
          {rankLabel(stats.rank, current.nickname)}
        </Slap>
        <Slap
          key={`stamp-${String(current.id)}`}
          rotate={8}
          delay={0.3}
          className="stamp absolute top-[22px] right-4 text-xs"
        >
          CON ANTECEDENTES
        </Slap>
        <motion.div
          key={`mascot-${String(current.id)}`}
          className="absolute top-[74px] left-1/2 -translate-x-1/2"
          initial={still ? false : { y: 60, scale: 0.7, rotate: 10, opacity: 0 }}
          animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 16 }}
        >
          <Mascot who={seat} size={220} label={current.nickname} alive />
        </motion.div>
        <div
          className="absolute inset-x-5 bottom-[18px] flex items-end justify-between gap-3"
          style={{ color: look.fg }}
        >
          <span className="flex flex-col gap-[3px]">
            <span className="max-w-[200px] font-display text-xl leading-[1.05]">
              {current.nickname}
              {current.id === ownCharacterId && <span className="sr-only"> (tú)</span>}
            </span>
            <span className="text-sm font-semibold">
              {out ? 'Entre rejas hasta mañana. Que aproveche.' : 'Vivo, de momento'}
            </span>
          </span>
          <span className="flex flex-col items-end">
            <CountUp value={current.balance} className="font-display text-[43px] leading-none" />
            <span className="text-[13px] font-semibold">
              puntos
              {stats.lastChange === null ? '' : `, ${signedPoints(stats.lastChange)} el último día`}
            </span>
          </span>
        </div>
      </section>

      <CardFlip
        label={`Números y secretos de ${current.nickname}`}
        flipped={flipped}
        onFlippedChange={setFlipped}
        className="h-[236px]"
        front={
          <div className="grid h-full grid-cols-2 grid-rows-[auto_1fr] gap-2.5">
            <Stat
              label="Envites ganados"
              value={`${String(stats.stakes.won)}/${String(stats.stakes.staked)}`}
            />
            <Stat
              label="Racha"
              value={stats.streak === 1 ? '1 día' : `${String(stats.streak)} días`}
            />
            <div className="card col-span-2 flex flex-col gap-2.5 rounded-[26px] p-4">
              <span className="text-[13px] font-semibold text-muted">Puntos por día</span>
              {stats.balances.length === 0 ? (
                <span className="text-[13px] text-muted">Sin capítulos, sin números.</span>
              ) : (
                <div aria-hidden className="grid flex-1 grid-cols-5 items-end gap-2">
                  {stats.balances.map(({ day, balance }, index) => (
                    <span key={day} className="flex h-full flex-col items-center justify-end gap-1">
                      <span className="text-[11px] font-semibold text-muted">{balance}</span>
                      <motion.span
                        key={`${String(current.id)}-${day}`}
                        className="w-full origin-bottom rounded-[10px]"
                        initial={still ? false : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={
                          still
                            ? { duration: 0 }
                            : {
                                type: 'spring',
                                stiffness: 260,
                                damping: 20,
                                delay: 0.1 + index * 0.07,
                              }
                        }
                        style={{
                          height: `${String(Math.max(4, Math.round((Math.max(0, balance) / highest) * 52)))}px`,
                          backgroundColor:
                            index === stats.balances.length - 1 ? look.bar : 'var(--track)',
                        }}
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
        back={
          <div className="card flex h-full flex-col gap-2.5 rounded-[26px] p-[18px]">
            <span className="text-[13px] font-semibold text-muted">Objetos</span>
            <span className="flex flex-wrap gap-1.5">
              {items.length === 0 ? (
                <span className="text-sm font-semibold text-ink">Ni un clavo.</span>
              ) : (
                items.map(({ name }) => (
                  <span
                    key={name}
                    className="rounded-full bg-chip px-[13px] py-2 text-sm font-semibold text-ink"
                  >
                    {name}
                  </span>
                ))
              )}
            </span>
            <span className="mt-1.5 text-[13px] font-semibold text-muted">Deudas</span>
            <span className="font-display text-[19px] leading-tight text-heading">
              {owes.length === 0 && owed.length === 0
                ? 'Ninguna. Sospechoso.'
                : [
                    ...owes.map(
                      ({ points, creditorCharacterId }) =>
                        `Debe ${String(points)} a ${inSentence(nickname(creditorCharacterId))}`,
                    ),
                    ...owed.map(
                      ({ points, debtorCharacterId }) =>
                        `${nickname(debtorCharacterId)} le debe ${String(points)}`,
                    ),
                  ].join('. ')}
            </span>
          </div>
        }
      />
      <motion.button
        type="button"
        whileTap={still ? {} : { scale: 0.97 }}
        className="h-[54px] rounded-full bg-primary text-[15px] font-bold text-on-primary"
        onClick={() => {
          setFlipped(!flipped);
        }}
      >
        {flipped ? 'Ver sus números, si te atreves' : 'Ver qué esconde'}
      </motion.button>

      <section aria-labelledby="record-heading" className="mt-2 flex flex-col gap-2">
        <h2
          id="record-heading"
          className="mx-1 mb-0.5 font-display text-[22px] leading-[1.1] text-heading"
        >
          Historial delictivo
        </h2>
        {stats.record.length === 0 ? (
          <p className="px-1 text-[15px] text-muted">Limpio. Por ahora.</p>
        ) : (
          stats.record.map((row, index) => (
            <motion.div
              key={`${String(current.id)}-${row.day}`}
              initial={still ? false : { opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={
                still
                  ? { duration: 0 }
                  : { duration: 0.35, delay: index * 0.06, ease: [0.23, 1, 0.32, 1] }
              }
            >
              <Link
                to={`/capitulos/${row.day}`}
                className="card grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl py-3 pr-3.5 pl-3"
              >
                <span className="grid size-11 place-items-center rounded-[14px] bg-chip font-display text-[15px] text-heading">
                  D{row.dayNumber}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm leading-[1.35] font-semibold text-ink">
                    {row.text}
                  </span>
                  <span className="text-xs text-muted">{row.meta}</span>
                </span>
                <span
                  className={cn('font-display text-lg', row.change < 0 ? 'text-loss' : 'text-ink')}
                >
                  {signedPoints(row.change)}
                </span>
              </Link>
            </motion.div>
          ))
        )}
        <p className="px-1 pt-2 text-[13px] text-muted">
          Los saldos solo cambian cuando se publica un capítulo.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="card flex flex-col gap-0.5 rounded-[26px] p-4">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <span className="font-display text-[29px] text-heading">{value}</span>
    </div>
  );
}
