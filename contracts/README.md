# @peak-state/contracts

Every shape the lanes exchange: JSON Schemas (`../schemas/`), TypeScript types, validators, derive helpers and fixtures. Import from here and never redeclare a shape.

```ts
import { validateProfile, chain, driversForStep, fixtures, type ProfileV2, type RepSession } from "@peak-state/contracts";
```

| Shape | Schema | Type | Fixtures |
|---|---|---|---|
| Profile v2 (1 to 3 states, ordered strategy) | `schemas/profile.v2.schema.json` | `ProfileV2`, `State`, `Step` | `profile.demo.json` (one state, the demo), `profile.three-states.json`, `profile.draft.json` |
| Calibration summary | `schemas/calibration.schema.json` | `CalibrationSummary` | `calibration.peak.json`, `calibration.contrast.json` |
| Signal frame | `schemas/signal-frame.schema.json` | `SignalFrame` | `frames.drift.json` (peak baseline → drift → rep → recovery, 1 Hz) |
| Detection event | `schemas/detection-event.schema.json` | `DetectionEvent` | `detection.drift.json`, `detection.manual.json` |
| Rep session | `schemas/rep-session.schema.json` | `RepSession`, `ProgressByState` | `rep-session.full.json`, `rep-session.sham.json`, `rep-session.anchor-only.json`, `rep-log.demo.json` (11 reps, ends installed) |
| Onboarding event | `schemas/onboarding-event.schema.json` | `OnboardingEvent`, `OnboardingResult` | `onboarding.events.demo.json` (scripted 95 s playbook run) |
| Module API | `API.md` | `ModuleHost`, `OnboardingModule`, `SensingModule`, `RepsModule` | |

`fixtures/invalid/` holds cases that must be rejected. The tests prove they are.

## Changing a fixture

Edit the story in `fixtures/_generate.py`, run `python3 contracts/fixtures/_generate.py`, then run `npm test`. The script rewrites the JSON files and `src/fixtures.ts`, so never edit those by hand.

## Changing a shape

Message `contracts` first. The change has to go through these steps:

1. a `--type contract` decision
2. the schema
3. the matching type in `src/`
4. the generator
5. a `schemaVersion` bump if the change breaks consumers
6. a message to every consumer lane

The tests fail if the TS vocabulary and the schema enums drift apart, or if any fixture stops validating.

## Scripts

- `npm test`: node's test runner over `test/**/*.test.ts`, using type stripping (Node 22.18 or later)
- `npm run typecheck`: `tsc`, which also checks every fixture against its type through `src/fixtures.ts`

Imports between source files use `.ts` extensions (`allowImportingTsExtensions`), which Vite and Node both resolve.
