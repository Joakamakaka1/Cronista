# Triage roles

The skills speak in five canonical triage roles. Each role maps to a workflow state of team CR, so the board shows it; only `ready-for-human` adds a label.

| Role in mattpocock/skills | In Linear (team CR)                               | Meaning                                |
| ------------------------- | ------------------------------------------------- | -------------------------------------- |
| `needs-triage`            | Backlog                                           | Needs evaluating                       |
| `needs-info`              | Backlog, plus a comment that says what is missing | Waiting for more information           |
| `ready-for-agent`         | Todo                                              | Fully specified, ready for an agent    |
| `ready-for-human`         | Todo, plus the `Human` label                      | Needs a person (create the label once) |
| `wontfix`                 | Canceled                                          | Will not be done                       |

When a skill says to apply a role's label, set the state from this table instead. For `ready-for-human`, add the `Human` label with `addLabels` (`labels` replaces the whole set); for any other role, remove it with `removeLabels`, keeping the other labels.
