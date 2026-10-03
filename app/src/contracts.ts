// Every cross-lane shape comes from @peak-state/contracts (D-contracts-007). The app never redeclares one.
// Below the re-export are app-only view helpers, built on contracts' derive functions.
import { chain, type State, type Step } from "@peak-state/contracts";

export * from "@peak-state/contracts";

/** The parts of a step the chain notation and the step chips need. */
export type StepHead = Pick<Step, "modality" | "direction" | "content">;

/** The chain notation for steps that are still filling in (no full State yet), for example "Ve → Ai". */
export function chainOf(steps: StepHead[]): string {
  return steps.length ? chain({ strategy: { steps: steps as Step[], fullyInAt: null, confirmed: false } } as State) : "";
}

/** The playbook letter code for one step, for example "Ve". */
export function stepCode(step: StepHead): string {
  return chainOf([step]);
}
