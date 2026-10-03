# Lane brief · contracts (Data contracts and API)

**Mission.** Own every shape the lanes exchange, and ship it first so every other lane can build against fixtures in parallel.

**Owns:** `schemas/` (except `schemas/coord/`), `examples/`, `contracts/`

## Builds

| Gate | Deliverable |
|---|---|
| M1 | `schemas/profile.v2.schema.json`: exactly three emotions. Each has `id`, `label`, `words` (the person's phrasing), `strategy.physiology`, `strategy.focus` and `strategy.language`, each `{action, cue, status}`, an optional `anchor` `{kind: sound, gesture or word, value}`, an optional `calibration` summary, and `confirmedAt` on the profile. Keep v1 (`peak-strategies`, `user-state-profile`) valid; v2 is a new file. |
| M1 | `schemas/signal-frame`, `detection-event`, `rep-session` and `calibration` schemas, following `docs/hackathon/mvp.md` |
| M1 | `contracts/`: TypeScript types (`contracts/src/*.ts`), fixtures (`contracts/fixtures/*.json`, one complete demo profile and one scripted drift), and tests that validate every fixture against its schema |
| M1 | `contracts/API.md`: the module interfaces `onboarding.run`, `sensing.start` and `reps.run`, plus the event flow between them |
| M2 onward | Version bumps on request. Every change is a decision with `--type contract`, and every consumer lane gets a message. |

## Interfaces

- **Provides to:** every lane.
- **Needs from:**
  - onboarding: which fields the conversation can actually fill
  - sensing: the window stats the detector emits
  - reps: the step list a rep logs

## Definition of done

All fixtures validate in CI. The other four lanes import types from `contracts/` instead of declaring their own.

## Your first session: verify the setup (gate M0)

Do these in order. Report anything that does not behave as described: it is a bug in the coordination setup, so message `coord`.

1. Confirm the SessionStart hook printed the coordination board. If it did not, run `python3 tools/coord.py board` and tell `coord`.
2. Claim your lane: `python3 tools/coord.py claim contracts --purpose "M0 setup check and lane plan"`.
3. Prove the edit guard works. Try to create a scratch file in a path another lane owns (for example `tools/guard-test.txt`, which `coord` owns). The edit must be blocked with a message naming the owner. Do not create it any other way.
4. Write `contracts/PLAN.md`: what you will build for M1 to M4, the interfaces you need from other lanes and the ones you provide, risks, and open questions.
5. Log a kickoff decision covering the plan, plus any real choices you made while planning: `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces contracts/PLAN.md …`.
6. Message each lane you depend on, or that depends on you, with the one thing you need from them or will give them (`coord.py msg <lane> …`). Questions only a person can answer go to `human`.
7. Post status: `python3 tools/coord.py status --health green --phase M0 --progress 10 --summary "…" --now "…" --next "…"`.
8. Run `python3 tools/coord.py board` and check that the other lanes appear. Run `python3 tools/coord.py inbox`.
9. Commit and push to your branch. The pre-push check must pass. If it blocks, follow its instructions.
10. Stop and report: what worked, what did not, and your plan in five lines. Do not start M1 building until a person says go.
