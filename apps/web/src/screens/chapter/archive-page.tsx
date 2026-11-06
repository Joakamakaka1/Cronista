import { Link } from 'react-router';

import { dayLabel, seasonLabel } from '../../game/day-label.ts';
import { type ArchiveEntry, useArchive } from '../../game/game-queries.ts';
import { Loading, LoadFailed } from '../app-shell.tsx';

/** Every published chapter, newest first, grouped by season. */
export function ArchivePage() {
  const archive = useArchive();

  if (archive.isPending) return <Loading />;
  if (archive.isError) {
    return (
      <LoadFailed
        retry={() => {
          void archive.refetch();
        }}
      />
    );
  }

  // Map.groupBy would need iOS 17.4; the players' phones may be older.
  const seasons = new Map<number, ArchiveEntry[]>();
  for (const entry of archive.data) {
    seasons.set(entry.seasonNumber, [...(seasons.get(entry.seasonNumber) ?? []), entry]);
  }

  return (
    <article className="flex flex-col gap-8 pt-4">
      <h1 className="font-serif text-[2rem] leading-tight font-semibold tracking-tight text-ink">
        Capítulos
      </h1>
      {archive.data.length === 0 && (
        <p className="prose-reading text-muted">
          Aún no hay capítulos. El primero se publica a las 22:00 del primer día.
        </p>
      )}
      {[...seasons].map(([number, entries]) => (
        <section key={number} aria-label={seasonLabel(number)} className="flex flex-col gap-3">
          {seasons.size > 1 && (
            <h2 className="text-sm font-medium text-muted">{seasonLabel(number)}</h2>
          )}
          <ol className="flex flex-col divide-y divide-rule border-y border-rule">
            {entries.map((entry) => (
              <ArchiveRow key={entry.day} entry={entry} />
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}

function ArchiveRow({ entry }: { readonly entry: ArchiveEntry }) {
  return (
    <li>
      <Link to={`/capitulos/${entry.day}`} className="flex flex-col gap-1 py-4">
        <span className="text-sm text-muted first-letter:uppercase">{dayLabel(entry.day)}</span>
        <span className="font-serif text-lg leading-snug text-ink">{entry.title}</span>
      </Link>
    </li>
  );
}
