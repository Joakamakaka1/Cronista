import { ChevronLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Link, useParams } from 'react-router';

import { Mascot } from '../../brand/mascot.tsx';
import { RepeatWords } from '../../brand/repeat-words.tsx';
import { Rise } from '../../brand/rise.tsx';
import { Slap } from '../../brand/slap.tsx';
import { seatOf } from '../../brand/seat.ts';
import { Star } from '../../brand/star.tsx';
import { type CanonChange, chapterLedger, type LedgerEntry } from '../../game/chapter-ledger.ts';
import { readingMinutes } from '../../game/clock-labels.ts';
import { dayLabel } from '../../game/day-label.ts';
import { useChapter, useCurrentSeason } from '../../game/game-queries.ts';
import { paragraphs } from '../../game/paragraphs.ts';
import { pointsLabel } from '../../game/points-label.ts';
import { STAKE_WORD } from '../../stake-word.ts';
import { AnimatedList } from '../../ui/animated-list.tsx';
import { cn } from '../../ui/class-names.ts';
import { InView } from '../../ui/in-view.tsx';
import { Loading, LoadFailed, Notice } from '../load-states.tsx';

const purposeLabel = { influence: 'influencia', item: 'un objeto', payment: 'un pago' } as const;
const counted = ['Ningún', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco'] as const;

/**
 * A published chapter: its cover, its text, still on the page with one line pulled out, then the
 * accounts of what each character attempted and paid, and what changed in canon.
 */
export function ChapterPage() {
  const { day = '' } = useParams();
  const chapter = useChapter(day);
  const season = useCurrentSeason();
  const still = useReducedMotion() === true;

  if (chapter.isPending) return <Loading />;
  if (chapter.isError) {
    return (
      <LoadFailed
        retry={() => {
          void chapter.refetch();
        }}
      />
    );
  }
  if (chapter.data === null) {
    return (
      <div className="flex flex-col gap-6 px-4 pt-4">
        <BackToChapters />
        <Notice>
          No hay ningún capítulo publicado del{' '}
          {/^\d{4}-\d{2}-\d{2}$/.test(day) ? dayLabel(day) : day}. Ni fiambre ni nada.
        </Notice>
      </div>
    );
  }

  const { pullQuote } = chapter.data;
  const minutes = readingMinutes(chapter.data.body);
  const { entries, changes } = chapterLedger(chapter.data.records);
  const ownCharacterId = season.data?.ownCharacterId ?? null;
  const characters = chapter.data.records.characters;
  const implicated = entries.filter(({ kind }) => kind === 'action' || kind === 'struck_out');
  const parts = paragraphs(chapter.data.body);
  // The pull quote sits after the second paragraph, or at the end of a short chapter.
  const quoteAfter = Math.min(2, parts.length) - 1;

  return (
    <article className="flex flex-col pb-[calc(48px+env(safe-area-inset-bottom))]">
      <header className="relative min-h-[440px] overflow-hidden rounded-b-[36px] bg-accent text-sticker-ink">
        <RepeatWords
          word="FIAMBRE"
          count={4}
          className="absolute top-10 -left-10 w-[520px] -rotate-8 text-[86px] text-[#f95f30]"
        />
        <div className="relative flex min-h-[440px] flex-col px-[18px] pt-[max(16px,env(safe-area-inset-top))] pb-[22px]">
          <div className="flex items-center justify-between">
            <BackToChapters />
            <span className="text-[13px] font-semibold text-[#2b1209]">
              {minutes} {minutes === 1 ? 'minuto' : 'minutos'} de lectura
            </span>
          </div>
          <Slap
            rotate={-6}
            delay={0.2}
            className="sticker sticker-strong mt-[46px] self-start rounded-2xl px-3.5 py-2 text-[21px]"
          >
            #{String(chapter.data.number).padStart(2, '0')}
          </Slap>
          <Rise delay={0.05}>
            <h1 className="mt-[22px] font-display text-[39px] leading-none text-sticker-ink">
              {chapter.data.title}
            </h1>
          </Rise>
          <div className="mt-auto flex items-center gap-2.5 pt-8">
            {implicated.length > 0 && (
              <span className="flex">
                {implicated.map(({ characterId }, index) => (
                  <motion.span
                    key={characterId}
                    className="-mr-3 block last:mr-0"
                    initial={still ? false : { scale: 0, rotate: -25, y: 10 }}
                    animate={{ scale: 1, rotate: 0, y: 0 }}
                    transition={
                      still
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 420, damping: 14, delay: 0.4 + index * 0.08 }
                    }
                  >
                    <Mascot who={seatOf(characters, characterId)} size={48} />
                  </motion.span>
                ))}
              </span>
            )}
            <span className="text-[13px] leading-[1.3] font-semibold text-[#2b1209] first-letter:uppercase">
              {dayLabel(chapter.data.day).replace(',', '')}.
              <br />
              {implicated.length === 0
                ? 'Nadie movió ficha. Culpables igual.'
                : `${counted[implicated.length] ?? String(implicated.length)} ${implicated.length === 1 ? 'implicado' : 'implicados'}. Ningún inocente.`}
            </span>
          </div>
        </div>
      </header>

      <div className="prose-reading flex flex-col px-[22px] pt-8">
        {parts.map((paragraph, index) => (
          <div key={index}>
            <p className={index > 0 ? 'mt-[18px]' : undefined}>{paragraph}</p>
            {index === quoteAfter && pullQuote !== null && (
              <InView>
                <figure className="card relative my-[30px] rounded-[28px] px-5 py-[22px]">
                  <Star size={26} color="#f44612" className="absolute -top-3 right-4" twinkle />
                  <blockquote className="font-display text-2xl leading-none text-heading">
                    {pullQuote}
                  </blockquote>
                </figure>
              </InView>
            )}
          </div>
        ))}
      </div>

      <section aria-labelledby="accounts-heading" className="mx-4 mt-10 flex flex-col gap-2">
        <h2
          id="accounts-heading"
          className="mx-1 mb-1 font-display text-2xl leading-none text-heading"
        >
          Las cuentas{' '}
          <Slap rotate={-8} onView delay={0.15} className="stamp ml-2 align-middle text-[13px]">
            <span aria-hidden>CULPABLES</span>
          </Slap>
        </h2>
        <p className="mx-1 mb-1 text-[13px] text-muted">
          La cifra de la derecha es cuánto cambió el saldo de cada uno este día.
        </p>
        <AnimatedList
          className="flex flex-col gap-2"
          items={entries.map((entry) => ({
            key: entry.characterId,
            content: (
              <LedgerRow
                entry={entry}
                seat={seatOf(characters, entry.characterId)}
                own={entry.characterId === ownCharacterId}
              />
            ),
          }))}
        />
      </section>

      {changes.length > 0 && (
        <section aria-labelledby="changes-heading" className="mx-4 mt-8 flex flex-col gap-2">
          <h2 id="changes-heading" className="mx-1 font-display text-2xl leading-none text-heading">
            Lo que cambió
          </h2>
          <ul className="card flex flex-col gap-2 rounded-3xl px-5 py-4 text-[15px] text-reading">
            {changes.map((change, index) => (
              <li key={index}>{changeSentence(change)}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-[34px] flex items-center justify-center gap-2.5 px-6">
        <Mascot who="narrator" size={36} alive />
        <span className="text-sm font-semibold text-muted">
          Mañana a las 08:00, otro marrón. Dormid si podéis.
        </span>
      </div>
    </article>
  );
}

function BackToChapters() {
  return (
    <Link
      to="/capitulos"
      className="inline-flex min-h-11 items-center gap-0.5 self-start rounded-full bg-sticker-ink py-0 pr-3.5 pl-2 text-sm font-bold text-white"
    >
      <ChevronLeft aria-hidden size={18} strokeWidth={2.2} />
      Capítulos
    </Link>
  );
}

function LedgerRow({
  entry,
  seat,
  own,
}: {
  readonly entry: LedgerEntry;
  readonly seat: ReturnType<typeof seatOf>;
  readonly own: boolean;
}) {
  const struck = entry.kind === 'struck_out';
  const details = [
    entry.stake !== null && entry.kind === 'action'
      ? entry.stake === 0
        ? `Sin ${STAKE_WORD.lower}`
        : `${STAKE_WORD.title} de ${String(entry.stake)}`
      : null,
    entry.award !== null && entry.kind === 'action' ? `${signed(entry.award)} del narrador` : null,
    ...entry.charges.map(
      (charge) =>
        `pagó ${String(charge.points)} por ${purposeLabel[charge.purpose]}${charge.recipient === null ? '' : ` a ${charge.recipient}`}`,
    ),
  ].filter((detail) => detail !== null);

  return (
    <div className="card grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-3 rounded-3xl py-2.5 pr-3.5 pl-2.5">
      <span className={cn('block', entry.kind === 'autopilot' && 'opacity-55 grayscale')}>
        <Mascot who={seat} size={48} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 pt-1">
        <span className="relative self-start text-[15px] font-bold text-ink">
          {entry.nickname}
          {own && <span className="font-normal text-muted"> (tú)</span>}
          {struck && (
            <svg
              aria-hidden
              viewBox="0 0 82 14"
              preserveAspectRatio="none"
              className="absolute top-1 -left-[3px] h-3.5 w-[calc(100%+6px)]"
            >
              <path
                d="M2 9 C 16 5, 30 10, 46 6 S 72 4, 80 7"
                fill="none"
                stroke="#f44612"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>
        {entry.kind === 'autopilot' && (
          <span className="text-[13px] leading-[1.35] text-muted">
            Ni se presentó. Piloto automático y menos uno, por rata.
          </span>
        )}
        {entry.kind === 'none' && (
          <span className="text-[13px] leading-[1.35] text-muted">Sin acción este día.</span>
        )}
        {struck && (
          <>
            <span className="text-[13px] leading-[1.35] text-[var(--struck-note)]">
              Tachada por el censor. Multa por bocazas.
            </span>
            {entry.text !== null && (
              <span className="text-[13px] leading-[1.45] whitespace-pre-line text-muted line-through decoration-accent decoration-2">
                {entry.text}
                <span className="sr-only"> (solo tú puedes leerla)</span>
              </span>
            )}
          </>
        )}
        {entry.kind === 'action' && entry.text !== null && (
          <span className="text-[14px] leading-[1.45] whitespace-pre-line text-reading">
            {entry.text}
          </span>
        )}
        {details.length > 0 && (
          <span className="text-[12px] leading-[1.35] text-muted first-letter:uppercase">
            {details.join(' · ')}
          </span>
        )}
      </span>
      <span
        className={cn(
          'pt-1 font-display text-[22px] tabular-nums',
          entry.change < 0 ? 'text-loss' : 'text-ink',
        )}
      >
        <span className="sr-only">Saldo: </span>
        {signed(entry.change)}
      </span>
    </div>
  );
}

function changeSentence(change: CanonChange): string {
  switch (change.kind) {
    case 'new_item':
      return `${change.owner} se agencia «${change.item}».`;
    case 'moved_item':
      return `«${change.item}» pasa de ${change.from} a ${change.to}.`;
    case 'new_debt':
      return `${change.debtor} queda debiendo ${pointsLabel(change.points)} a ${change.creditor}.`;
    case 'paid_debt':
      return `${change.debtor} salda su deuda de ${pointsLabel(change.points)} con ${change.creditor}.`;
    case 'out':
      return `${change.character} queda fuera de juego el próximo día.`;
  }
}

function signed(points: number): string {
  return points > 0 ? `+${String(points)}` : points < 0 ? `−${String(-points)}` : '0';
}
