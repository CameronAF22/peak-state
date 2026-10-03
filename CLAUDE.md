# Peak State · rules for every Claude Code session

Several Claude Code sessions build this repo in parallel, one per **lane**. They coordinate through the repo itself, and that coordination is required. Hooks in `.claude/settings.json` enforce it, and CI enforces it again on every push.

The product and the hackathon plan are in `docs/hackathon/mvp.md`. Your lane's brief is `docs/hackathon/lanes/<lane>.md`. The full protocol is `coord/README.md`.

## Start of every session

The SessionStart hook prints the board: every lane's health, recent decisions, proposals waiting on someone, and your inbox. Read it.

If you have no lane, claim the one your task names before you touch a file. Edits are blocked until you do.

```bash
python3 tools/coord.py claim <lane> --purpose "<one line>"
```

Lanes: `coord`, `contracts`, `onboarding`, `sensing`, `reps`, `experience` (see `coord/lanes.json`).

## The loop

Run this for every unit of work, however small.

1. **Decide.** Before you build something another lane depends on, or pick between real options, log it:
   `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces <paths> [--alternatives "…" "…"] [--depends-on D-…]`
   Use `--status proposed` when another lane or a human must agree, and message them. Otherwise it is `accepted`.
2. **Build** only inside the paths your lane owns. Every file you create must be covered by a decision's `--produces`.
3. **Status.** Update it at every milestone and before you stop:
   `python3 tools/coord.py status --health green --progress 40 --summary "…" --now "…" --next "…" [--blocker "…"]`
4. **Ship.** `git add -A && git commit && git push -u origin <your branch>`. The pre-push hook rebuilds `spec/` and validates. If it blocks, do what it says, commit, and push again.

## Talking to other lanes

- Read everyone: `coord.py board`, `coord.py inbox`, `coord.py show D-…`, `coord.py why <path>`, `coord.py context <lane>`. These read every remote branch, so you see other lanes' work without merging it.
- Read another lane's file: `git show origin/<branch>:<path>`. Their branch is on the board.
- Ask or tell: `coord.py msg <lane|all|human> --subject "…" --body "…" [--refs D-…]`. The message reaches them when you push.
- Need to edit a file another lane owns? Message the owner first. If the change is agreed, run `coord.py borrow <path> --reason "…"`.
- Questions only a person can answer go to `human`. Keep working on everything that does not depend on the answer.

## Contracts

Shapes that cross lanes live in `schemas/` and `contracts/`, and the `contracts` lane owns them. Never invent a second shape for the same data. Build against the fixtures in `contracts/` or `examples/`. If a shape is missing or wrong, message `contracts` and log a `proposed` decision.

## Never

- Edit `coord/decisions|status|messages|sessions|events|trace/` or `spec/` by hand. `tools/coord.py` writes them.
- Change a decision after it is written, except to accept or reject it. Supersede it with a new one: `--supersedes D-…`.
- Push to another lane's branch, or rewrite history on a shared branch.
- Disable the hooks to get past a check. `PEAK_COORD=off` exists for a person debugging the tool, not for agents.
- Treat Peak State as therapy or diagnosis. The safety boundary in `README.md` applies to every prompt, script and screen.
