import type { Canon, CanonDebt, Finale } from './narrator.ts';
import type { ResolutionOutput } from './schemas/narrator-output.ts';

/** The lowest award the narrator can give an action. */
export const MIN_AWARD = -3;

/** The highest award the narrator can give an action. */
export const MAX_AWARD = 5;

/** What being absent costs, fixed by code. */
export const AUTOPILOT_AWARD = -1;

/** What a struck-out action costs, fixed by code. */
export const COMIC_PENALTY = -2;

/** The smallest debt a character can take on. */
export const MIN_DEBT = 1;

/** The largest debt a character can take on. */
export const MAX_DEBT = 5;

/**
 * The longest name of an item. It stays in canon, and so in every later prompt, for the whole season:
 * a name that holds a paragraph, or lines of its own, could pass for canon itself.
 */
export const MAX_ITEM_NAME_CHARACTERS = 60;

/** The kinds of canon change the narrator can decide, which a problem can drop one by one. */
export type CanonChange = 'payment' | 'new_item' | 'moved_item' | 'new_debt' | 'paid_debt' | 'out';

/**
 * A canon change that broke a rule. `message` can quote what the model wrote, so it goes back to the
 * model and never to the logs: those get `change` alone.
 */
export interface CanonIssue {
  readonly change: CanonChange;
  readonly message: string;
}

/** What {@link validateResolution} checks a resolution against. */
export interface DayToValidate {
  readonly canon: Canon;
  /** The characters whose players sent an action, autopilot and struck-out ones excluded. */
  readonly actions: readonly { readonly nickname: string; readonly stake: number }[];
}

/** What {@link validateResolution} found. */
export interface ResolutionValidation {
  /** What makes the resolution unusable: a missing action, or an award or charge out of range. */
  readonly issues: readonly string[];
  /** The canon changes that broke a rule, which `kept` leaves out. */
  readonly canonIssues: readonly CanonIssue[];
  /** The resolution without those changes. Their charges return to the stake. */
  readonly kept: ResolutionOutput;
  /** The open debts that `kept` pays, in the order it pays them. */
  readonly paidDebts: readonly CanonDebt[];
}

/**
 * Checks a resolution against the day's real actions and canon. Model output never grants points or
 * changes canon without passing this. Changes apply in order, so that once one action takes an item
 * another cannot take it from its old owner.
 */
export function validateResolution(
  resolution: ResolutionOutput,
  { canon, actions }: DayToValidate,
): ResolutionValidation {
  const stakes = new Map(actions.map(({ nickname, stake }) => [nickname, stake]));
  const characters = new Set(canon.characters.map(({ nickname }) => nickname));
  const owners = new Map(canon.items.map(({ name, owner }) => [name, owner]));
  const outToday = new Set(
    canon.characters.filter(({ out }) => out).map(({ nickname }) => nickname),
  );
  const goingOut = new Set<string>();
  const openDebts = [...canon.debts];
  const paidDebts: CanonDebt[] = [];
  const seen = new Set<string>();
  const issues: string[] = [];
  const canonIssues: CanonIssue[] = [];

  const drop = (change: CanonChange, message: string) => {
    canonIssues.push({ change, message });
    return false;
  };

  const outcomes = resolution.outcomes.map((outcome) => {
    const { nickname, award, influence } = outcome;
    if (!stakes.has(nickname)) issues.push(`outcome for unknown character ${nickname}`);
    else if (seen.has(nickname)) issues.push(`more than one outcome for ${nickname}`);
    seen.add(nickname);
    if (award < MIN_AWARD || award > MAX_AWARD) {
      issues.push(`award ${String(award)} for ${nickname} is out of range`);
    }
    if (influence < 0) {
      issues.push(`influence of ${String(influence)} for ${nickname} is out of range`);
    }
    for (const { points } of outcome.payments) {
      if (points < 1) issues.push(`payment of ${String(points)} for ${nickname} is out of range`);
    }

    const payments = outcome.payments.filter(
      ({ to }) =>
        (characters.has(to) && to !== nickname) ||
        drop('payment', `${nickname} pays nothing to ${to}, who cannot receive it`),
    );

    const newItems = outcome.newItems.filter(({ name, price }) => {
      if (name.length > MAX_ITEM_NAME_CHARACTERS || /\p{Cc}/u.test(name)) {
        return drop('new_item', `${nickname} buys no item, because its name is not one short line`);
      }
      if (price < 1)
        return drop(
          'new_item',
          `${nickname} does not get the new item ${name}, which needs a charge`,
        );
      if (owners.has(name))
        return drop(
          'new_item',
          `${nickname} does not get the new item ${name}, which already exists`,
        );
      owners.set(name, nickname);
      return true;
    });

    const movedItems = outcome.movedItems.filter(({ item, from, to }) => {
      if (owners.get(item) !== from) {
        return drop(
          'moved_item',
          `the item ${item} does not go to ${to}, because ${from} does not own it`,
        );
      }
      if (!characters.has(to) || to === from) {
        return drop('moved_item', `the item ${item} does not go to ${to}, who cannot receive it`);
      }
      owners.set(item, to);
      return true;
    });

    let debtBorn = false;
    const newDebts = outcome.newDebts.filter(({ creditor, points }) => {
      // Nothing proves which action a debt came from, so this bounds what one text can do to another.
      if (debtBorn)
        return drop(
          'new_debt',
          `${nickname} takes on one debt at most in one action, and not this one`,
        );
      if (points < MIN_DEBT || points > MAX_DEBT) {
        return drop(
          'new_debt',
          `${nickname} takes on no debt of ${String(points)}, which is out of range`,
        );
      }
      if (!characters.has(creditor) || creditor === nickname) {
        return drop('new_debt', `${nickname} does not owe ${creditor}, who cannot be its creditor`);
      }
      debtBorn = true;
      return true;
    });

    let debtPayments = 0;
    const paid = outcome.paidDebts.filter(({ creditor }) => {
      const index = openDebts.findIndex(
        (debt) => debt.debtor === nickname && debt.creditor === creditor,
      );
      const [debt] = index < 0 ? [] : openDebts.splice(index, 1);
      if (debt === undefined)
        return drop(
          'paid_debt',
          `${nickname} pays no debt to ${creditor}, because it owes nothing`,
        );
      paidDebts.push(debt);
      debtPayments += debt.points;
      return true;
    });

    const outCharacters = outcome.outCharacters.filter((character) => {
      if (!characters.has(character))
        return drop('out', `${character} does not go out, because that character does not exist`);
      if (outToday.has(character)) {
        return drop('out', `${character} does not go out again: nobody is out two days in a row`);
      }
      if (goingOut.has(character)) return drop('out', `${character} goes out only once`);
      goingOut.add(character);
      return true;
    });

    const charged =
      influence +
      sumOf(payments.map(({ points }) => points)) +
      sumOf(newItems.map(({ price }) => price)) +
      debtPayments;
    const stake = stakes.get(nickname) ?? 0;
    if (charged > stake) {
      issues.push(
        `charges of ${String(charged)} for ${nickname} are over its stake of ${String(stake)}`,
      );
    }

    return { ...outcome, payments, newItems, movedItems, newDebts, paidDebts: paid, outCharacters };
  });

  for (const { nickname } of actions) {
    if (!seen.has(nickname)) issues.push(`missing outcome for ${nickname}`);
  }

  return { issues, canonIssues, kept: { outcomes }, paidDebts };
}

/**
 * The balances after a season's last chapter and who wins: the day's movements, then open debts from
 * debtor to creditor. The highest balance wins, and a tie is a shared win.
 *
 * @remarks
 * `publish_chapter` applies the same count, and the game engine's tests prove that they agree.
 */
export function finalStandings(
  canon: Canon,
  resolution: ResolutionOutput,
  {
    absent,
    struckOut,
  }: { readonly absent: readonly string[]; readonly struckOut: readonly string[] },
): Finale {
  const balances = new Map(canon.characters.map(({ nickname, balance }) => [nickname, balance]));
  const move = (nickname: string, points: number) => {
    balances.set(nickname, (balances.get(nickname) ?? 0) + points);
  };

  for (const outcome of resolution.outcomes) {
    move(outcome.nickname, outcome.award - outcome.influence);
    for (const { to, points } of outcome.payments) {
      move(outcome.nickname, -points);
      move(to, points);
    }
    for (const { price } of outcome.newItems) move(outcome.nickname, -price);
    for (const { creditor, points } of outcome.newDebts) {
      move(outcome.nickname, -points);
      move(creditor, points);
    }
  }
  for (const nickname of absent) move(nickname, AUTOPILOT_AWARD);
  for (const nickname of struckOut) move(nickname, COMIC_PENALTY);

  // Once each, whether paid today as a charge or moved by the finale: either way, debtor to creditor.
  for (const { debtor, creditor, points } of canon.debts) {
    move(debtor, -points);
    move(creditor, points);
  }

  const standings = canon.characters.map(({ nickname }) => ({
    nickname,
    balance: balances.get(nickname) ?? 0,
  }));
  const highest = Math.max(...standings.map(({ balance }) => balance));
  return {
    winners: standings.filter(({ balance }) => balance === highest).map(({ nickname }) => nickname),
    balances: standings,
  };
}

const sumOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
