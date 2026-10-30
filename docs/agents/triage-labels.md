# Triage roles

The skills speak in five canonical triage roles. Team CR has no triage labels: each role maps to a workflow state, so the board shows it without extra labels.

| Role in mattpocock/skills | In Linear (team CR)                               | Meaning                                |
| ------------------------- | ------------------------------------------------- | -------------------------------------- |
| `needs-triage`            | Backlog                                           | Needs evaluating                       |
| `needs-info`              | Backlog, plus a comment that says what is missing | Waiting for more information           |
| `ready-for-agent`         | Todo                                              | Fully specified, ready for an agent    |
| `ready-for-human`         | Todo, plus the `Human` label                      | Needs a person (create the label once) |
| `wontfix`                 | Canceled                                          | Will not be done                       |

When a skill says to apply a role's label, set the state (and the label, for `ready-for-human`) from this table instead.
