# Lane brief · coord (Coordination and spec)

**Mission.** Run the protocol, the dashboard, the hooks and CI. Merge lane branches into `main` at each gate, and keep the board honest.

**Owns:** `README.md`, `LICENSE`, `.gitignore`, `CLAUDE.md`, `.claude/`, `.github/`, `coord/`, `tools/`, `site/`, `docs/`, `schemas/coord/`

## Responsibilities

- Keep `coord/lanes.json` true: ownership, dependencies, human owners.
- Answer `coord` messages from lanes within one loop. Ownership requests are decisions.
- At each gate, merge green lane branches into `main` in dependency order: contracts, then onboarding, sensing and reps, then experience. Rebuild the spec after each merge.
- Republish the Artifact snapshot of the dashboard after each gate.
- Route questions in the `human` inbox to the person and record the answers as accepted decisions.

## Definition of done

Every gate on the dashboard is green. `main` validates. The spec in `spec/` matches the shipped code.
