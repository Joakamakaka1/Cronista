# Issue tracker: Linear

Issues and specs for this repo live in Linear, team **CR** (Cronista). Use the Linear MCP tools (`save_issue`, `get_issue`, `list_issues`, `list_projects`, `save_comment`). An issue's ID, `CR-<n>`, names its branch and is closed from its PR with `Closes CR-<n>` (see [`workflow.md`](../../.claude/rules/workflow.md)).

## Conventions

- **Create an issue**: `save_issue` with `team: "CR"`, a `title`, a Markdown `description`, one label (`Feature`, `Bug` or `Improvement`) and the `project` of the current phase (`list_projects`). Ask the user before creating it.
- **Read an issue**: `get_issue` with the identifier; add `includeRelations: true` to see its blockers.
- **List issues**: `list_issues` with `team: "CR"` and the `state`, `label`, `project` or `parentId` filters.
- **Make an issue a sub-issue of a parent**: `parentId: "CR-<n>"` on `save_issue`.
- **Blocking**: Linear's native relations, `blockedBy: ["CR-<n>"]` (or `blocks`) on `save_issue`. A ticket is unblocked when every blocker is Done.
- **Comment on an issue**: `save_comment`.
- **States**: Backlog, Todo, In Progress, Done, Canceled and Duplicate. Change them with `state` on `save_issue`.
- **Close**: work closes through its PR. To close without one, comment why, then set the state to Done or Canceled.

**PRs as a request surface: no.** The repo is public but takes no outside contributions.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team CR as above. A spec is a parent issue; its tickets are its sub-issues, linked by `blockedBy`.

## When a skill says "fetch the relevant ticket"

`get_issue` with the `CR-<n>` identifier.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue and its tickets are sub-issues.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create the label in team CR the first time.
- **Child ticket**: a sub-issue of the map, labelled `wayfinder:<type>` (`research`, `prototype`, `grilling` or `task`).
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: `list_issues` with `parentId` set to the map and an open state, minus any with an open blocker or an assignee; the oldest wins.
- **Claim**: `save_issue` with `assignee: "me"` and `state: "In Progress"`, the session's first write.
- **Resolve**: `save_comment` with the answer, set the state to Done, then append a context pointer (gist + link) to the map's Decisions-so-far with `save_issue` and an `append` patch.
