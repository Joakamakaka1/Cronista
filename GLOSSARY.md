# Cronista

A private daily game for five friends: each player sends one action a day, and at night an AI narrator resolves them all into a chapter.

## Language

### People and fiction

**Player**:
A real person on the closed list of five.
_Avoid_: User, account

**Character**:
The caricature of a player that acts in the fiction, known by a nickname.
_Players see_: personaje
_Avoid_: Avatar

**Narrator**:
The AI that runs the game: it writes the situation, the hints, the resolution and the chapter.
_Avoid_: Game master, resolver

**Bible**:
The owner's private description of a season's world, tone, characters and red lines. Play never changes it.
_Avoid_: Lore, world document

**Red line**:
A subject the narrator never writes about, either general or set by one player.
_Avoid_: Forbidden topic

**Newspaper**:
The in-fiction voice of the game's fixed messages to the players.
_Players see_: el periódico

**Censor**:
The in-fiction figure blamed when the narrator refuses.
_Players see_: el censor

### Time

**Season**:
A run of the game with fixed start and end dates and one winner.
_Players see_: temporada

**Pre-season**:
Season 0, played on v1 and v2: its game data can be reset, and it has no end date and no finale.
_Avoid_: Beta, test season

**Simulated season**:
A season of invented players run locally to test the game before real play.
_Avoid_: Rehearsal season, season 0

**Game day**:
One calendar day of a season in Europe/Madrid, from its situation to its published chapter.
_Avoid_: Round, turn

**Situation**:
The shared scene that opens a game day.
_Players see_: situación
_Avoid_: Dilemma, scenario

**Reserve situation**:
The fixed newspaper text that opens a game day when the narrator cannot write a situation.

**Close**:
The moment at 22:00 when actions stop and the game day is resolved.
_Avoid_: Deadline, resolver

**Finale**:
The last chapter of a season, which names the winner.

### Play

**Action**:
What a character attempts on a game day: one text, not editable once sent. It is an attempt, never a fact.
_Players see_: acción
_Avoid_: Move, turn

**Stake**:
The points a player declares with an action: the most the narrator may charge for it.
_Avoid_: Bet, investment

**Hint**:
A private comment on a player's own action, which promises nothing.
_Players see_: pista
_Avoid_: Clue, tip

**Autopilot**:
What the narrator writes for a character whose player sent no action.
_Players see_: piloto automático
_Avoid_: Bot, absence

**Resolution**:
What the narrator decides each action achieves, before any text is written: awards, charges and canon changes.
_Avoid_: Verdict, outcome

**Game engine**:
The code that applies the rules of a game day. The Lambdas and local runs call the same one.
_Avoid_: Game server, game service

**Chapter**:
The narrated text of a resolved game day.
_Players see_: capítulo
_Avoid_: Episode, post

### Points

**Points**:
The currency of a season, earned, spent and counted for victory.
_Players see_: puntos
_Avoid_: Score, coins

**Balance**:
The points a character holds, which change only when a chapter is published.
_Avoid_: Score, total, wallet

**Award**:
The points an action wins or loses, apart from what it charges.
_Avoid_: Reward, score

**Charge**:
The part of a stake the narrator uses. The rest returns to the balance.
_Avoid_: Fee, cost

**Payment**:
A charge that goes to another character instead of disappearing. Paying a debt is a payment.

**Debt**:
Points one character owes another, born only from the debtor's own action.
_Avoid_: Loan

### Canon and memory

**Canon**:
The validated state the narrator cannot contradict: balances, items, debts and status.
_Avoid_: Game state

**Item**:
A named thing in canon with one owner. It gives no numeric advantage.
_Players see_: objeto
_Avoid_: Object, inventory entry

**Status**:
Whether a character is active or out on a game day.

**Out**:
Dead, jailed or in hospital for one game day: the action is narrated from there, with no stake.
_Avoid_: Eliminated

**Memory**:
What the narrator recalls through retrieval. Canon wins over it.

**Moment**:
One self-contained fact extracted from a published chapter.
_Avoid_: Memory entry, event

**Superseded moment**:
A moment whose fact changed: it stays, pointing at the moment that replaced it, and retrieval leaves it out.

**Running joke**:
A joke that comes back across chapters, named by the label its moments share.
_Avoid_: Gag, meme

**Fixed bundle**:
What every resolve and narrate recalls whatever happens that day: each character's most important moments, the running jokes told most recently and the summary that bridges to the last chapters.

**Top-k**:
The moments retrieval finds for a day's situation and actions, on top of the fixed bundle.

### Failures

**Refusal**:
The model declining to answer, either through the API or in ordinary text.
_Avoid_: Block, filter hit

**Struck-out action**:
An action shown to cause a refusal, which never reaches the model or the other players again.
_Players see_: tachado
_Avoid_: Censored action, deleted action

**Comic penalty**:
The fixed points a struck-out action costs.
_Avoid_: Fine, sanction

**Postponed chapter**:
A chapter that could not be published at the close. No new game day opens until it is.
_Avoid_: Failed chapter, skipped day

**Reset**:
Removing the pre-season's game data while keeping the players, their push subscriptions and the spend ledger.
_Avoid_: Wipe
