import { useState } from 'react';

import { Mascot } from '../../brand/mascot.tsx';
import { seatOf } from '../../brand/seat.ts';
import { sinceLabel } from '../../game/clock-labels.ts';
import type { Character } from '../../game/game-queries.ts';
import { inSentence, isFeminine } from '../../game/nickname.ts';

/**
 * "Avisos": who else has moved today and when, newest on top of a little stack. It never says what
 * anyone did or staked.
 */
export function PlayNotices({
  now,
  characters,
  plays,
  ownCharacterId,
}: {
  readonly now: Date;
  readonly characters: readonly Character[];
  readonly plays: readonly { readonly characterId: number; readonly at: string }[];
  readonly ownCharacterId: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const others = plays.filter(({ characterId }) => characterId !== ownCharacterId);
  if (others.length === 0) return null;

  const played = new Set(plays.map(({ characterId }) => characterId));
  const missing = characters.filter(({ id }) => !played.has(id));
  const nickname = (id: number) =>
    characters.find((character) => character.id === id)?.nickname ?? '¿?';
  const stillMissing =
    missing.length === 0
      ? 'Ya han movido ficha todos.'
      : missing.length === 1 && missing[0] !== undefined
        ? `Solo falta ${inSentence(missing[0].nickname)}, ${isFeminine(missing[0].nickname) ? 'escondida' : 'escondido'} en algún váter.`
        : `Faltan ${String(missing.length)} gallinas.`;

  const notice = (play: { readonly characterId: number; readonly at: string }, first: boolean) => (
    <div className="card flex min-h-[76px] items-center gap-3 rounded-[22px] px-3.5 py-2.5 shadow-[0_10px_24px_rgb(0_0_0/0.08)]">
      <Mascot who={seatOf(characters, play.characterId)} size={48} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[15px] leading-tight font-bold text-ink">
          {nickname(play.characterId)} ya ha hecho de las suyas
        </span>
        <span className="line-clamp-2 text-[13px] text-muted">
          {sinceLabel(play.at, now)}.{first ? ` ${stillMissing}` : ''}
        </span>
      </span>
    </div>
  );

  return (
    <section aria-labelledby="notices-heading" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <h2 id="notices-heading" className="font-display text-[19px] text-heading">
          Avisos
        </h2>
        {others.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            className="card min-h-11 rounded-full px-3.5 text-[13px] font-bold text-ink"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? 'Recoger' : `Ver los ${String(others.length)}`}
          </button>
        )}
      </div>
      {expanded ? (
        <ul className="flex flex-col gap-2">
          {others.map((play, index) => (
            <li key={play.characterId}>{notice(play, index === 0)}</li>
          ))}
        </ul>
      ) : (
        <div className="relative min-h-[98px] pb-[22px]">
          {others.length > 2 && (
            <span
              aria-hidden
              className="card absolute inset-x-[22px] top-[22px] h-[70px] rounded-[22px] opacity-55"
            />
          )}
          {others.length > 1 && (
            <span
              aria-hidden
              className="card absolute inset-x-[11px] top-[11px] h-[74px] rounded-[22px] opacity-80"
            />
          )}
          <div className="relative">{others[0] && notice(others[0], true)}</div>
        </div>
      )}
    </section>
  );
}
