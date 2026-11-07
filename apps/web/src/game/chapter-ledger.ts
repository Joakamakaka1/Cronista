/** A character of the season, as the ledger names it. */
export interface LedgerCharacter {
  readonly id: number;
  readonly nickname: string;
}

/** One action of a published day as the database returns it to this player. */
export interface ChapterAction {
  readonly characterId: number;
  readonly origin: 'player' | 'autopilot';
  readonly struckOut: boolean;
  /** Null when RLS hides it: an autopilot action, or another player's struck-out one. */
  readonly content: { readonly text: string; readonly stake: number } | null;
  readonly award: {
    readonly points: number;
    readonly kind: 'narrator' | 'autopilot' | 'comic_penalty';
  } | null;
  readonly charges: readonly {
    readonly points: number;
    readonly purpose: 'influence' | 'item' | 'payment';
    readonly recipientCharacterId: number | null;
  }[];
}

/** Everything a published day changed, keyed by character id. */
export interface ChapterRecords {
  readonly characters: readonly LedgerCharacter[];
  readonly actions: readonly ChapterAction[];
  readonly newItems: readonly { readonly name: string; readonly firstOwnerCharacterId: number }[];
  readonly movedItems: readonly {
    readonly name: string;
    readonly fromCharacterId: number;
    readonly toCharacterId: number;
  }[];
  readonly bornDebts: readonly DebtRecord[];
  readonly paidDebts: readonly DebtRecord[];
  readonly outCharacterIds: readonly number[];
}

interface DebtRecord {
  readonly debtorCharacterId: number;
  readonly creditorCharacterId: number;
  readonly points: number;
}

/** What one character did on the day and how their balance moved. */
export interface LedgerEntry {
  readonly characterId: number;
  readonly nickname: string;
  readonly kind: 'action' | 'autopilot' | 'struck_out' | 'none';
  readonly text: string | null;
  readonly stake: number | null;
  readonly award: number | null;
  readonly charges: readonly {
    readonly points: number;
    readonly purpose: 'influence' | 'item' | 'payment';
    readonly recipient: string | null;
  }[];
  /** The day's award, minus what was charged, plus payments received. */
  readonly change: number;
}

/** A canon change of the day, named by nickname. */
export type CanonChange =
  | { readonly kind: 'new_item'; readonly item: string; readonly owner: string }
  | {
      readonly kind: 'moved_item';
      readonly item: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: 'new_debt' | 'paid_debt';
      readonly debtor: string;
      readonly creditor: string;
      readonly points: number;
    }
  | { readonly kind: 'out'; readonly character: string };

/** A published day, character by character, and its canon changes. */
export function chapterLedger(records: ChapterRecords): {
  readonly entries: readonly LedgerEntry[];
  readonly changes: readonly CanonChange[];
} {
  const nickname = (id: number) =>
    records.characters.find((character) => character.id === id)?.nickname ?? '¿?';

  const entries = records.characters.map((character): LedgerEntry => {
    const action = records.actions.find(({ characterId }) => characterId === character.id);
    const received = records.actions
      .flatMap(({ charges }) => charges)
      .filter(({ recipientCharacterId }) => recipientCharacterId === character.id)
      .reduce((sum, { points }) => sum + points, 0);
    if (action === undefined) {
      return {
        characterId: character.id,
        nickname: character.nickname,
        kind: 'none',
        text: null,
        stake: null,
        award: null,
        charges: [],
        change: received,
      };
    }
    const award = action.award?.points ?? 0;
    const charged = action.charges.reduce((sum, { points }) => sum + points, 0);
    return {
      characterId: character.id,
      nickname: character.nickname,
      kind:
        action.origin === 'autopilot' ? 'autopilot' : action.struckOut ? 'struck_out' : 'action',
      text: action.content?.text ?? null,
      stake: action.content?.stake ?? null,
      award: action.award?.points ?? null,
      charges: action.charges.map(({ points, purpose, recipientCharacterId }) => ({
        points,
        purpose,
        recipient: recipientCharacterId === null ? null : nickname(recipientCharacterId),
      })),
      change: award - charged + received,
    };
  });

  const debt = (kind: 'new_debt' | 'paid_debt') => (record: DebtRecord) => ({
    kind,
    debtor: nickname(record.debtorCharacterId),
    creditor: nickname(record.creditorCharacterId),
    points: record.points,
  });

  const changes: CanonChange[] = [
    ...records.newItems.map(({ name, firstOwnerCharacterId }) => ({
      kind: 'new_item' as const,
      item: name,
      owner: nickname(firstOwnerCharacterId),
    })),
    ...records.movedItems.map(({ name, fromCharacterId, toCharacterId }) => ({
      kind: 'moved_item' as const,
      item: name,
      from: nickname(fromCharacterId),
      to: nickname(toCharacterId),
    })),
    ...records.bornDebts.map(debt('new_debt')),
    ...records.paidDebts.map(debt('paid_debt')),
    ...records.outCharacterIds.map((id) => ({ kind: 'out' as const, character: nickname(id) })),
  ];

  return { entries, changes };
}
