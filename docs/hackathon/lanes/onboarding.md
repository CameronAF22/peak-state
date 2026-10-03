# Lane brief · onboarding (Onboarding and strategy elicitation)

**Mission.** Turn a first conversation into a confirmed three-emotion profile. Capture a short calibration of what each state looks like in the person's signals.

**Owns:** `onboarding/`, `prompts/`, `docs/elicitation.md`, `docs/state-change.md`

**Start from:**

- `prompts/strategy-extraction.md`
- `docs/state-change.md`: the Robbins triad turned into prompt rules
- `docs/elicitation.md`
- `README.md`: safety boundary

## Builds

| Gate | Deliverable |
|---|---|
| M1 | `onboarding/PLAN.md` and the voice script for `docs/hackathon/elicitation-playbook.md`: one person-chosen state. Elicit the strategy in order, then core submodalities per step, then the contrast and drivers, then recode, test and future pace. The script is built so it can run up to three times in the next version. |
| M2 | A module that turns a transcript (scripted for the demo) into a Profile v2, validated against `contracts/`. Include a fixture conversation. |
| M3 | Live conversation: a text chat with an LLM behind it, with optional browser speech. Calibration step: about 20 seconds of recall per emotion while sensing records. |
| M4 | The playback screen copy, and the safety stop wired into every prompt |

## Interfaces

- **Needs:**
  - contracts: Profile v2 and the calibration schema
  - sensing: a `record(seconds)` call during calibration
  - experience: where the conversation UI lives
- **Provides:** `onboarding.run()` returning a Profile

## Decisions to make early

These are `proposed` until a person answers:

- which conversation model and voice stack
- how much of onboarding is scripted for the demo

## Definition of done

A first-time user reaches a confirmed profile in under three minutes, in their own words, with no invented strategies.

## Your first session: verify the setup (gate M0)

Do these in order. Report anything that does not behave as described: it is a bug in the coordination setup, so message `coord`.

1. Confirm the SessionStart hook printed the coordination board. If it did not, run `python3 tools/coord.py board` and tell `coord`.
2. Claim your lane: `python3 tools/coord.py claim onboarding --purpose "M0 setup check and lane plan"`.
3. Prove the edit guard works. Try to create a scratch file in a path another lane owns (for example `tools/guard-test.txt`, which `coord` owns). The edit must be blocked with a message naming the owner. Do not create it any other way.
4. Write `onboarding/PLAN.md`: what you will build for M1 to M4, the interfaces you need from other lanes and the ones you provide, risks, and open questions.
5. Log a kickoff decision covering the plan, plus any real choices you made while planning: `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces onboarding/PLAN.md …`.
6. Message each lane you depend on, or that depends on you, with the one thing you need from them or will give them (`coord.py msg <lane> …`). Questions only a person can answer go to `human`.
7. Post status: `python3 tools/coord.py status --health green --phase M0 --progress 10 --summary "…" --now "…" --next "…"`.
8. Run `python3 tools/coord.py board` and check that the other lanes appear. Run `python3 tools/coord.py inbox`.
9. Commit and push to your branch. The pre-push check must pass. If it blocks, follow its instructions.
10. Stop and report: what worked, what did not, and your plan in five lines. Do not start M1 building until a person says go.
