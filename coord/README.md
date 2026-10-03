# Coordination protocol

This folder is how parallel Claude Code sessions, and the people steering them, build Peak State without stepping on each other. Each lane has its own branch, and the repository is the message bus. `tools/coord.py` is the only writer of coordination records, and the dashboard is a view over every branch.

## Pieces

| Path | What it holds | Written by |
|---|---|---|
| `coord/lanes.json` | Lanes, their missions, and the paths each one owns | coord lane, by hand |
| `coord/decisions/<lane>/D-<lane>-NNN.json` | One decision per file: context, decision, alternatives, consequences, what it `produces`, the session that made it | `coord.py decide`, `accept`, `reject` |
| `coord/status/<lane>.json` | The lane's current health, progress, now, next and blockers | `coord.py status` |
| `coord/messages/M-….json` | Messages between lanes, to `all`, or to `human` | `coord.py msg`, `borrow` |
| `coord/sessions/<lane>--<session>.json` | Which Claude Code session worked which lane, on which branch, with a link to reopen it | `coord.py claim` and every write |
| `coord/events/<lane>.jsonl` | Append-only activity log for the timeline | every write |
| `coord/trace/<lane>.json` | Every file the lane owns, its SHA-256, and the decisions covering it | `coord.py build` |
| `spec/<lane>.md` | The decision log rendered as the lane's spec | `coord.py build` |
| `schemas/coord/*.schema.json` | The data contract for every record above | coord lane |

Every record is validated against its schema when it is written and again in CI.

## Rules that make it deterministic

1. **Every path has exactly one owner.** The longest matching `owns` entry in `lanes.json` wins. A file outside every lane fails validation.
2. **Every owned file is covered by a decision.** A decision's `produces` lists the files or folders it produced or governs. A file no decision covers fails validation, so nothing reaches `main` without a recorded reason.
3. **The spec is generated.** `coord.py build` renders `spec/` and `coord/trace/` from `lanes.json`, the decisions and the exact file bytes, with no clocks, so the same tree always produces the same spec. CI fails if the committed spec is stale.
4. **Decisions are append-only.** After a decision is written, only `status`, `acceptedAt` and `acceptedBy` may change. To change your mind, write a new decision with `--supersedes`. CI compares against the merge base with `main`.
5. **Every record names its session.** Decisions, status, messages and events carry the session id, URL and branch. `coord.py why <file>` and `coord.py show <id>` lead from any artifact back to the decision and the conversation that produced it.

## How agents see each other in real time

- Each lane pushes to its own branch (`lane/<id>`, or the branch its session was given).
- `board`, `inbox`, `show`, `why` and `context` run `git fetch` and read `coord/` from every remote branch with `git ls-tree` and `git cat-file`. Nothing is merged. The working tree counts as one more source, so your unpushed writes show up too.
- Hooks keep that view in front of the agent:
  - **SessionStart** prints the board, the inbox and the loop.
  - **UserPromptSubmit** fetches at most every 90 seconds and announces new messages and stale status.
  - **PreToolUse (Edit/Write)** blocks edits before a lane is claimed, edits to another lane's files, and hand edits to generated records.
  - **PreToolUse (Bash `git push`)** rebuilds the spec and runs `validate`, and blocks the push until both are clean and committed.
  - **Stop** blocks the end of a turn once if the session changed files without a decision from this session, without coverage, or without a status newer than its latest edit.
- GitHub Actions (`.github/workflows/coord.yml`) runs the same validation on every push and PR. It then rebuilds the dashboard from all branches and force-pushes it to the `coord-dashboard` branch, which GitHub Pages serves.

## Messages

`to` is a lane id, `all`, or `human`. A message is a file on the sender's branch, so it reaches readers on their next fetch after the sender pushes. Reply with `--reply-to M-…`. Anything waiting on a person goes to `human` and shows on the dashboard under **Needs a person**.

## Resuming work

`python3 tools/coord.py context <lane>` prints:

- the lane's mission and status
- every session that worked the lane, with links to reopen it
- the lane's decisions
- its inbox
- recent events

A fresh session that claims the lane starts from there. A session resumed in a new container recovers its lane from `coord/sessions/`.

## Escape hatches

- `PEAK_COORD=off` disables the hooks for one process. It is for a person debugging `tools/coord.py`, never for getting past a check.
- `PEAK_LANE=<lane>` sets the lane through the environment, for scripted sessions.
- `PEAK_AUTHOR="Name"` records a person rather than `claude` as a decision's author or acceptor.
