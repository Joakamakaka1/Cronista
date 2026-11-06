import { useParams } from 'react-router';

import { type CanonChange, chapterLedger, type LedgerEntry } from '../../game/chapter-ledger.ts';
import { dayLabel, seasonLabel } from '../../game/day-label.ts';
import { useChapter, useCurrentSeason } from '../../game/game-queries.ts';
import { paragraphs } from '../../game/paragraphs.ts';
import { STAKE_WORD } from '../../stake-word.ts';
import { cn } from '../../ui/class-names.ts';
import { Loading, LoadFailed } from '../app-shell.tsx';

const purposeLabel = { influence: 'influencia', item: 'un objeto', payment: 'un pago' } as const;

/**
 * A published chapter: its text, still on the page, then what each character attempted, what it
 * cost and what changed in canon.
 */
export function ChapterPage() {
  const { day = '' } = useParams();
  const chapter = useChapter(day);
  const season = useCurrentSeason();

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
      <p className="prose-reading pt-10 text-muted">
        No hay ningún capítulo publicado del {/^\d{4}-\d{2}-\d{2}$/.test(day) ? dayLabel(day) : day}
        .
      </p>
    );
  }

  const { entries, changes } = chapterLedger(chapter.data.records);
  const ownCharacterId = season.data?.ownCharacterId ?? null;

  return (
    <article className="flex flex-col gap-12 pt-4">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted first-letter:uppercase">
          {seasonLabel(chapter.data.seasonNumber)}, {dayLabel(chapter.data.day)}
        </p>
        <h1 className="font-serif text-[2.25rem] leading-[1.1] font-semibold tracking-tight text-ink [font-variation-settings:'opsz'_60]">
          {chapter.data.title}
        </h1>
      </header>

      <div className="prose-reading text-ink">
        {paragraphs(chapter.data.body).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      <section aria-labelledby="actions-heading" className="flex flex-col gap-6">
        <h2 id="actions-heading" className="font-serif text-xl font-semibold text-ink">
          Lo que intentó cada uno
        </h2>
        <ol className="flex flex-col divide-y divide-rule border-y border-rule">
          {entries.map((entry) => (
            <LedgerRow
              key={entry.characterId}
              entry={entry}
              own={entry.characterId === ownCharacterId}
            />
          ))}
        </ol>
      </section>

      {changes.length > 0 && (
        <section aria-labelledby="changes-heading" className="flex flex-col gap-4">
          <h2 id="changes-heading" className="font-serif text-xl font-semibold text-ink">
            Lo que cambió
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink marker:text-muted">
            {changes.map((change, index) => (
              <li key={index}>{changeSentence(change)}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function LedgerRow({ entry, own }: { readonly entry: LedgerEntry; readonly own: boolean }) {
  return (
    <li className="flex flex-col gap-2 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className={cn('font-semibold text-ink', own && 'text-pen')}>
          {entry.nickname}
          {own && <span className="font-normal text-muted"> (tú)</span>}
        </p>
        <p
          className={cn(
            'font-serif text-lg tabular-nums',
            entry.change < 0 ? 'text-censor' : 'text-ink',
          )}
          aria-label={`Saldo: ${signed(entry.change)} puntos`}
        >
          {signed(entry.change)}
        </p>
      </div>

      {entry.kind === 'autopilot' && (
        <p className="text-sm text-muted">Piloto automático: no envió acción.</p>
      )}
      {entry.kind === 'none' && <p className="text-sm text-muted">Sin acción este día.</p>}
      {entry.kind === 'struck_out' &&
        (entry.text === null ? (
          <p className="text-censor">Tachada por el censor del periódico.</p>
        ) : (
          <>
            <p className="prose-reading struck whitespace-pre-line text-muted">{entry.text}</p>
            <p className="text-sm text-censor">Tachada por el censor: solo tú puedes leerla.</p>
          </>
        ))}
      {entry.kind === 'action' && entry.text !== null && (
        <p className="prose-reading whitespace-pre-line text-ink">{entry.text}</p>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        {entry.stake !== null && entry.kind !== 'autopilot' && (
          <div className="flex gap-1">
            <dt>{STAKE_WORD.title}</dt>
            <dd className="tabular-nums text-ink">{entry.stake}</dd>
          </div>
        )}
        {entry.award !== null && (
          <div className="flex gap-1">
            <dt>{entry.kind === 'struck_out' ? 'Multa del censor' : 'Puntos'}</dt>
            <dd className="tabular-nums text-ink">{signed(entry.award)}</dd>
          </div>
        )}
        {entry.charges.map((charge, index) => (
          <div key={index} className="flex gap-1">
            <dt>
              Pagó {charge.points} por {purposeLabel[charge.purpose]}
              {charge.recipient !== null && ` a ${charge.recipient}`}
            </dt>
          </div>
        ))}
      </dl>
    </li>
  );
}

function changeSentence(change: CanonChange): string {
  switch (change.kind) {
    case 'new_item':
      return `${change.owner} consigue «${change.item}».`;
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

function pointsLabel(points: number): string {
  return points === 1 ? '1 punto' : `${String(points)} puntos`;
}

function signed(points: number): string {
  return points > 0 ? `+${String(points)}` : points < 0 ? `−${String(-points)}` : '0';
}
