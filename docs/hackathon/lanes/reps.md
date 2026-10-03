# Lane brief · reps (Repetition and conditioning engine)

**Mission.** Install each state as measurable reps. The method follows Robbins' conditioning steps; the log is what makes them testable.

**Owns:** `reps/`

**Start from:**

- `docs/on-aim-closed-loop.html`, sections 3 to 5: Neuro-Associative Conditioning mapped step by step, the 20-second cue, sham trials, the learning rule
- `prompts/intervention.md`
- `docs/state-change.md`

## Builds

| Gate | Deliverable |
|---|---|
| M1 | `reps/PLAN.md`. The rep script format: anchor, then physiology, then focus, then language, then rate. 20 to 40 seconds, generated from one emotion in Profile v2. |
| M2 | Rep runner that plays a rep with timed steps and browser speech, and records a RepSession: intensity before and after, recovery time, cue or sham. Works from a fixture profile. |
| M3 | Conditioning and the installed test. Count reps per emotion. After N good reps, run an anchor-only test. Mark the emotion installed when the anchor alone brings the state back. Add a sham arm at a fixed rate. |
| M4 | Progress data for experience: reps per emotion, intensity trend, recovery after cue versus sham |

## Interfaces

- **Needs:**
  - contracts: Profile v2 and RepSession
  - sensing: DetectionEvent, plus recovery signal after a cue
- **Provides:**
  - `reps.run(profile, emotionId, trigger)` returning a RepSession
  - progress aggregates

## Decisions to make early

- the installed criterion
- the sham rate for the demo, which may be zero on stage but stays in the log design
- rep length

## Definition of done

Every rep is logged with enough data to tell a cue from a sham. The installed badge follows a rule written down as a decision.

## Your first session: verify the setup (gate M0)

Do these in order. Report anything that does not behave as described: it is a bug in the coordination setup, so message `coord`.

1. Confirm the SessionStart hook printed the coordination board. If it did not, run `python3 tools/coord.py board` and tell `coord`.
2. Claim your lane: `python3 tools/coord.py claim reps --purpose "M0 setup check and lane plan"`.
3. Prove the edit guard works. Try to create a scratch file in a path another lane owns (for example `tools/guard-test.txt`, which `coord` owns). The edit must be blocked with a message naming the owner. Do not create it any other way.
4. Write `reps/PLAN.md`: what you will build for M1 to M4, the interfaces you need from other lanes and the ones you provide, risks, and open questions.
5. Log a kickoff decision covering the plan, plus any real choices you made while planning: `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces reps/PLAN.md …`.
6. Message each lane you depend on, or that depends on you, with the one thing you need from them or will give them (`coord.py msg <lane> …`). Questions only a person can answer go to `human`.
7. Post status: `python3 tools/coord.py status --health green --phase M0 --progress 10 --summary "…" --now "…" --next "…"`.
8. Run `python3 tools/coord.py board` and check that the other lanes appear. Run `python3 tools/coord.py inbox`.
9. Commit and push to your branch. The pre-push check must pass. If it blocks, follow its instructions.
10. Stop and report: what worked, what did not, and your plan in five lines. Do not start M1 building until a person says go.
