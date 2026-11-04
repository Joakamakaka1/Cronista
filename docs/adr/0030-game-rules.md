# Game rules for v1

The design doc left the game's rules undefined, and they block the schema and narrator cards. The owner settled them on 2026-11-04. They hold for the pre-season and can still change before season 1, because its data can be reset. This ADR's number continues ADR-01 to ADR-29 in the private architecture document, so each number names one decision. `GLOSSARY.md` defines the terms.

## A game day

- **08:00**: the narrator writes one shared situation. `dilemmas()` and the "5 dilemas" are gone: ADR-23 has three AI moments, and something personal can come back in v2 if real play asks for it.
- **08:00 to 22:00**: each player may send one action, not editable, with a stake. An action is an attempt, never a fact: writing "I win 100 points" grants nothing.
- **On sending**: the player gets one hint, a private comment on their own action. It is built from the situation, canon and that action, never another player's. It promises nothing, and the narrator does not see it at the close.
- **22:00**: autopilot covers absent characters, then `resolve` returns the awards, charges and canon changes, code validates them, and `narrate` writes the chapter from what passed. Balances and canon change once, when the chapter is published, so a postponed chapter changes nothing and a dropped change never appears in the text. A day with no real action still gets a chapter.
- **After publishing**: moments are extracted. If that fails, the chapter stands and extraction runs again at the next close.

## Characters

Each player controls a caricature of themselves, known by a nickname. That is what makes the humour work between friends, and it is why the bible holds real data. The narrator uses nicknames only, never real names or emails.

A character can be out for one game day (dead, jailed, in hospital). That day the action is narrated from there and carries no stake, and the character is back after that close. Nobody is out two days in a row and nobody is eliminated: these are five friends playing every day.

Autopilot narrates what an absent character does and shows it as autopilot. It costs a fixed -1, so being absent always costs something, though less than a -3 from playing badly. The character declares nothing and changes no canon of its own, but other players' actions can still affect it.

## Points

Points are a currency. A ranking alone was the simpler option; the currency was chosen for more game, at the cost of more rules to build and test before v1.

- Every character starts a season with a balance of 10. It can go negative.
- The narrator awards from -3 to +5 for each action, apart from what it charges. Autopilot (-1) and the comic penalty (-2) are fixed by code.
- A stake goes from 0 to the balance. A player at zero or below, or out, still plays but declares nothing.
- The narrator charges at most the stake, and the rest returns. A failed bribe is lost if the narrator charges it.
- A charge can buy influence on the action, buy an item, or go to another character as a payment. A paid extra hint was rejected: it arrives with the action already sent, so it would add AI cost and little else.
- A balance only changes when a chapter is published. So a stake needs no reservation, and points received today can be staked tomorrow at the earliest.

## Canon

Canon is balances, items, debts and status. Relationships stay in memory, because code cannot tell whether "they get on badly" is false. Code enforces:

- **Items**: a new item needs a charge. An item changes hands only from its current owner, for example when another action resolves as a theft. It gives no numeric advantage.
- **Debts**: from 1 to 5 points, born only from the debtor's own real action, so nobody can owe points because another player wrote that they do. Paying comes out of the debtor's stake. Fines are negative awards, not debts.
- **Status**: the one-day and not-two-days-in-a-row limits above.

## Seasons

A season has fixed start and end dates, set when it is created, and its last chapter is the finale. Open debts move from debtor to creditor, the highest balance wins, and a tie is a shared win. The finale's `narrate` runs after that count, so it can name the winner.

The pre-season (season 0) has no end date and no finale: it ends when season 1 starts. Season 1's length is chosen before v3.

A private SQL function with pgTAP resets the pre-season: it removes actions, chapters, canon, memory and quotas, and refuses once season 1 has started. It keeps `players`, push subscriptions and the spend ledger, which counts credit cycles, not seasons. It runs when v3 arrives, and earlier only if the schema or the rules demand it: a week of real memory is worth more for testing the RAG than a clean start at v2. A migration written by hand for each reset would leave nothing dangerous in production, but it would be untested and slow when something breaks at night.

## Who sees what

| What                              | Before the chapter                         | After the chapter                                                          |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| An action and its stake           | Its player; others only see "X has played" | Everyone                                                                   |
| A struck-out action               | Its player                                 | Its player; others see it struck out, and it never reaches the model again |
| A hint                            | Its player                                 | Its player                                                                 |
| A day's balance and canon changes | Nobody                                     | Everyone                                                                   |
| The bible                         | The owner                                  | The owner                                                                  |

## The bible

One file per season in the private, versioned S3 bucket, read by `ai-worker` and `ai-api` with access to that prefix only. The owner writes it and is the only one who changes it; each player approves their own caricature and gives their red lines, which sit next to the general ones. Its text goes to Anthropic and stays in the Langfuse traces, which is why each player sees their part first. Play never changes it: what happens in a season lives in canon and memory. The repo holds an invented bible in the same format for the evals and the simulated season.

An action that crosses a red line, and that the model does not refuse, resolves as a failure with normal points and its content is not repeated in the chapter. It is not a refusal and gets no comic penalty: code cannot detect it, so a model's output would be penalising a player, and one action could try to force that on another. The prompt and the evals carry this rule.

## When something fails

| What fails                                                                           | What happens                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve` output: invalid JSON, a missing action, or an award or charge out of range | One retry with the list of errors, then the chapter is postponed                                                                                                                                                 |
| `resolve` output: an invalid canon change                                            | One retry with the list of errors, then that change is dropped and logged, and the day goes on                                                                                                                   |
| `narrate` output: invalid or empty                                                   | One retry with the list of errors, then the chapter is postponed                                                                                                                                                 |
| `resolve` or `narrate` is refused                                                    | One softer retry, then each real action is tested alone. Refused ones are struck out and both steps run again without them. If none is refused, or the chapter is still refused, nobody pays and it is postponed |
| The situation is refused or invalid                                                  | One retry, then a fixed generic newspaper text opens the day and the owner gets an alert                                                                                                                         |
| The hint is refused                                                                  | No retry and no penalty: a fixed censor line, the quota is spent and the refusal is recorded with its category. A technical failure can be retried and spends no quota                                           |
| The workspace spend limit                                                            | The chapter is postponed (`narrator.md`)                                                                                                                                                                         |

**A postponed chapter** brings a newspaper message and an alert. The 08:00 job retries it first; if it fails again, the day does not open. Canon never advances over an unresolved day. If it keeps failing, the game waits for the owner, who fixes the cause and runs the close and the opening by hand. Rejected alternative: opening anyway and resolving two days together, because the new situation would be written without knowing what happened.

**The comic penalty** is a fixed -2: worse than not playing, but not the minimum, because with this humour a refusal can be bad luck. Code applies it with no canon changes, the stake returns, and the chapter carries the paragraph "tachado por el censor del periódico". The narrator can joke about the censor without quoting the action.

**Why each action is tested alone.** [Anthropic's docs](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) say partial output must be discarded, so a refused response leaves no chapter to publish; `stop_details` gives a category and points at nothing in the input; and re-sending the same request usually refuses again. Asking the model which action caused it would let an action dictate the answer. Writing the chapter again without each action in turn tests the real context, but costs up to five chapters and fails with two culprits. The short calls cost cents and run only in this case.

## What this changes

- **`Narrator`**: `situation`, `hint`, `resolve`, `narrate` and `extractMoments`. The private doc's interface, AI budget and N2 cases still mention dilemmas.
- **`actionSchema`** gains the stake.
- **Infrastructure**: `ai-worker` and `ai-api` get read access to the bible's prefix in the private bucket.
- **Schema card**: seasons with dates, one character per player, game days with their state, actions with stake and origin (player or autopilot), struck-out actions, the hint quota, awards and charges, items, debts, status per day, and RLS from the table above. The (season, day) guard covers publishing as a single step.
- **Evals**: stakes and charges, payments, debts, thefts, out characters, struck-out actions and the finale need cases.

## Not decided here

Season 1's length, the Spanish word players see for a stake, whether memory carries over between later seasons, and player feedback on chapters.
