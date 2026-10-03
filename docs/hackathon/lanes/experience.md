# Lane brief · experience (App experience and demo)

**Mission.** Own what a judge touches: the web app that runs onboard, calibrate, live, rep and progress, wired to the other lanes' modules, and the three-minute demo.

**Owns:** `app/`, `demo/`

## Builds

| Gate | Deliverable |
|---|---|
| M1 | `app/PLAN.md`. Pick the app stack and record it as a decision; the default is Vite with TypeScript, offline once loaded. Five screens as stubs on fixture data from `contracts/`. |
| M2 | Vertical slice: fixture profile, then a simulated drift, then a fired rep, then a logged RepSession, then progress, all in the app |
| M3 | Swap in real onboarding, the strap, and the live chart. Local persistence of the profile and rep log. |
| M4 | `demo/`: the three-minute script, a pinned simulator scenario, a fallback screen recording, pitch notes, and the safety copy on screen |

## Interfaces

- **Needs:** every lane's module behind the API in `contracts/API.md`.
- **Provides:**
  - the app shell and screen slots the modules render into
  - the demo timeline other lanes rehearse against

## Definition of done

A judge can watch the full loop in three minutes, on the simulator, with no network.

## Your first session: verify the setup (gate M0)

Do these in order. Report anything that does not behave as described: it is a bug in the coordination setup, so message `coord`.

1. Confirm the SessionStart hook printed the coordination board. If it did not, run `python3 tools/coord.py board` and tell `coord`.
2. Claim your lane: `python3 tools/coord.py claim experience --purpose "M0 setup check and lane plan"`.
3. Prove the edit guard works. Try to create a scratch file in a path another lane owns (for example `tools/guard-test.txt`, which `coord` owns). The edit must be blocked with a message naming the owner. Do not create it any other way.
4. Write `app/PLAN.md`: what you will build for M1 to M4, the interfaces you need from other lanes and the ones you provide, risks, and open questions.
5. Log a kickoff decision covering the plan, plus any real choices you made while planning: `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces app/PLAN.md …`.
6. Message each lane you depend on, or that depends on you, with the one thing you need from them or will give them (`coord.py msg <lane> …`). Questions only a person can answer go to `human`.
7. Post status: `python3 tools/coord.py status --health green --phase M0 --progress 10 --summary "…" --now "…" --next "…"`.
8. Run `python3 tools/coord.py board` and check that the other lanes appear. Run `python3 tools/coord.py inbox`.
9. Commit and push to your branch. The pre-push check must pass. If it blocks, follow its instructions.
10. Stop and report: what worked, what did not, and your plan in five lines. Do not start M1 building until a person says go.
