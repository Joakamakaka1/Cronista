import { seasonLabel } from '../../game/day-label.ts';
import { useCanon, useCurrentSeason } from '../../game/game-queries.ts';
import { cn } from '../../ui/class-names.ts';
import { Loading, LoadFailed } from '../app-shell.tsx';

/** Each character's balance, items, debts and status, as of the latest published chapter. */
export function PlayersPage() {
  const season = useCurrentSeason();
  const canon = useCanon(season.data);

  if (season.isPending || (season.data && canon.isPending)) return <Loading />;
  if (season.isError || canon.isError) {
    return (
      <LoadFailed
        retry={() => {
          void season.refetch();
          void canon.refetch();
        }}
      />
    );
  }
  if (season.data === null) {
    return <p className="prose-reading pt-10 text-muted">Todavía no hay ninguna temporada.</p>;
  }

  const { characters, ownCharacterId, outCharacterIds } = season.data;
  const nickname = (id: number) => characters.find((character) => character.id === id)?.nickname;
  const items = canon.data?.items ?? [];
  const debts = canon.data?.openDebts ?? [];
  const ranked = [...characters].sort((first, second) => second.balance - first.balance);

  return (
    <article className="flex flex-col gap-8 pt-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{seasonLabel(season.data.number)}</p>
        <h1 className="font-serif text-[2rem] leading-tight font-semibold tracking-tight text-ink">
          Personajes
        </h1>
      </header>

      <ol className="flex flex-col divide-y divide-rule border-y border-rule">
        {ranked.map((character) => {
          const owned = items.filter(({ ownerCharacterId }) => ownerCharacterId === character.id);
          const owes = debts.filter(({ debtorCharacterId }) => debtorCharacterId === character.id);
          const owed = debts.filter(
            ({ creditorCharacterId }) => creditorCharacterId === character.id,
          );
          const own = character.id === ownCharacterId;
          return (
            <li key={character.id} className="flex flex-col gap-3 py-5">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className={cn('text-lg font-semibold', own ? 'text-pen' : 'text-ink')}>
                  {character.nickname}
                  {own && <span className="font-normal text-muted"> (tú)</span>}
                </h2>
                <p className="font-serif text-2xl tabular-nums text-ink">
                  {character.balance}
                  <span className="ml-1 font-sans text-sm text-muted">puntos</span>
                </p>
              </div>
              {outCharacterIds.includes(character.id) && (
                <p className="self-start rounded-full bg-censor/10 px-3 py-0.5 text-sm text-censor">
                  Fuera de juego
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Objetos</dt>
                <dd className="text-ink">
                  {owned.length === 0 ? 'Ninguno' : owned.map(({ name }) => `«${name}»`).join(', ')}
                </dd>
                <dt className="text-muted">Debe</dt>
                <dd className="text-ink">
                  {owes.length === 0
                    ? 'Nada'
                    : owes
                        .map(
                          ({ points, creditorCharacterId }) =>
                            `${String(points)} a ${nickname(creditorCharacterId) ?? '¿?'}`,
                        )
                        .join(', ')}
                </dd>
                <dt className="text-muted">Le deben</dt>
                <dd className="text-ink">
                  {owed.length === 0
                    ? 'Nada'
                    : owed
                        .map(
                          ({ points, debtorCharacterId }) =>
                            `${String(points)} de ${nickname(debtorCharacterId) ?? '¿?'}`,
                        )
                        .join(', ')}
                </dd>
              </dl>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted">Los saldos solo cambian cuando se publica un capítulo.</p>
    </article>
  );
}
