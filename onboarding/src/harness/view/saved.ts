// The saved strategy, the playback panel (with its 0..10 rating) and the run log, in the Horizon style
// (D-onboarding-021): one line of text at a time above the horizon, quiet actions, the steps shown as points of light.

import type { RepSession } from "@peak-state/contracts";
import type { SavedStrategy, StepView } from "../../types.ts";
import { h, mount, SENSE_LABEL } from "./dom.ts";
import { setHorizonMood } from "./horizon.ts";
import { clearSpoken, followSpoken } from "./spoken.ts";

export interface SavedHandlers {
  run(): void;
  /** The practice loop (D-onboarding-015). */
  practice?(): void;
  /** "I'm off": a rep right now, logged with a manual trigger (D-onboarding-023). */
  imOff?(): void;
  /** The anchor on its own: the installed test (D-reps-003). */
  anchorTest?(): void;
  download(): void;
  newStrategy(): void;
}

export interface SavedModel {
  saved: SavedStrategy;
  stateLabel: string;
  chain: string;
  steps: StepView[];
  running: boolean;
  /** A practice loop is open: the run buttons wait. */
  practicing?: boolean;
  /** "You've chosen to feel content 12 times…" (D-onboarding-016). */
  reminder?: string | null;
  /** Revision of the saved strategy, shown once it has changed. */
  revision?: number;
  /** Where conditioning stands: good reps, anchor test, installed (reps.conditioning). */
  conditioning?: string | null;
  /** The anchor-only test is due. */
  anchorTest?: boolean;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stepMeta(s: StepView): string {
  const parts = s.checklist.filter((c) => c.value !== null && c.value !== "").map((c) => (c.words?.trim() ? c.words : typeof c.value === "number" ? `${c.value}/10` : String(c.value).replace(/-/g, " ")));
  return [SENSE_LABEL[s.modality], ...parts].join(" · ");
}

/** The saved card is rebuilt on every render; it fades in only when it first appears or its strategy changes. */
let lastCardKey = "";

export function renderSavedCard(m: SavedModel, handlers: SavedHandlers): HTMLElement {
  const busy = m.running || m.practicing;
  const updated = m.revision && m.revision > 1;
  const key = `${m.saved.profile.profileId}|${m.saved.savedAt}|${m.revision ?? 1}`;
  const fade = key !== lastCardKey ? " fade-in" : "";
  lastCardKey = key;
  return h(
    "section",
    { class: "saved-card", "data-testid": "saved-card", "aria-labelledby": "saved-title" },
    h("p", { class: `section-label${fade}` }, updated ? `Strategy saved  ·  version ${m.revision}` : "Strategy saved"),
    h("h2", { class: `saved-title${fade}`, id: "saved-title" }, `Your way back to ${m.stateLabel} is saved.`),
    h("p", { class: `saved-meta${fade}`, title: m.chain }, `${updated ? `version ${m.revision}, updated` : "saved"} ${when(m.saved.savedAt)}`),
    m.reminder ? h("p", { class: `practice-reminder${fade}`, "data-testid": "reminder" }, m.reminder) : null,
    // The steps themselves are the points on the horizon; this list carries them for screen readers.
    h(
      "ol",
      { class: "saved-steps visually-hidden" },
      m.steps.map((s) =>
        h(
          "li",
          { class: "saved-step", "data-testid": "saved-step", "data-modality": s.modality, "data-anchor": s.isAnchor ? "true" : "false" },
          `${s.content}${s.isAnchor ? " (anchor)" : ""}. ${stepMeta(s)}`,
        ),
      ),
    ),
    h(
      "div",
      { class: `saved-run${fade}` },
      h(
        "button",
        { class: "run-btn", type: "button", "data-testid": "run", disabled: busy, onclick: () => handlers.run() },
        h("span", { class: "play", "aria-hidden": "true" }),
        m.running ? "Running…" : "Run my strategy",
      ),
      handlers.practice
        ? h("button", { class: "practice-btn", type: "button", "data-testid": "practice", disabled: busy, onclick: () => handlers.practice?.() }, "Practice: recall, rate, adjust")
        : null,
      handlers.imOff
        ? h("button", { class: "practice-btn", type: "button", "data-testid": "im-off", disabled: busy, onclick: () => handlers.imOff?.() }, "I'm off: bring it back now")
        : null,
      m.anchorTest && handlers.anchorTest
        ? h("button", { class: "practice-btn", type: "button", "data-testid": "anchor-test", disabled: busy, onclick: () => handlers.anchorTest?.() }, "Test the anchor on its own")
        : null,
    ),
    m.conditioning ? h("p", { class: `practice-reminder${fade}`, "data-testid": "conditioning" }, m.conditioning) : null,
    h(
      "div",
      { class: `quiet-row${fade}` },
      h("button", { class: "quiet", type: "button", "data-testid": "download", onclick: () => handlers.download() }, "download"),
      h("span", { class: "sep", "aria-hidden": "true" }, "·"),
      h("button", { class: "quiet", type: "button", "data-testid": "new-strategy", disabled: busy, onclick: () => handlers.newStrategy() }, "start a new one"),
    ),
  );
}

export function renderRunLog(runs: RepSession[]): HTMLElement {
  const items = runs
    .slice()
    .reverse()
    .map((r) => {
      const before = r.intensityBefore ?? "–";
      const after = r.intensityAfter ?? "–";
      const practice = r.trigger.kind === "practice" && r.intensityBefore === null;
      const up = typeof r.intensityBefore === "number" && typeof r.intensityAfter === "number" && r.intensityAfter > r.intensityBefore;
      return h(
        "li",
        { class: "run-entry", "data-testid": "run-entry", "data-ended-by": r.endedBy },
        h("span", {}, `run ${r.repIndex + 1}${practice ? " · practice" : r.kind === "anchor-only" ? " · anchor test" : r.trigger.kind === "manual" ? " · I'm off" : ""}`),
        h("span", { class: `delta${up ? " up" : ""}` }, practice ? `${after}/10` : `${before} → ${after}`),
        h("span", { class: "when" }, r.endedBy === "completed" ? when(r.startedAt) : `${when(r.startedAt)} · stopped`),
      );
    });
  return h(
    "div",
    { class: "run-log-wrap", "data-testid": "run-log", "data-count": runs.length },
    h("h2", { class: "visually-hidden" }, `Run log, ${runs.length} run${runs.length === 1 ? "" : "s"}`),
    items.length ? h("ul", { class: "run-log" }, items) : null,
  );
}

// ── playback panel ──────────────────────────────────────────────────────────

export interface PlaybackPanel {
  readonly el: HTMLElement;
  /** Index of the step in focus (-1 for intro), and the line being spoken. */
  setLine(stepIndex: number, line: string): void;
  /** Show the 0..10 pad; resolves with the tapped number. */
  rate(prompt: string): Promise<number>;
  /** Resolve an open rating from elsewhere (voice). Returns false when no rating is open. */
  answerRating(n: number): boolean;
  finish(text: string): void;
}

export function createPlaybackPanel(steps: StepView[], onStop: () => void): PlaybackPanel {
  const label = h("p", { class: "section-label" }, "");
  let line = h("h2", { class: "playback-line", "data-testid": "playback-line" }, "");
  // The horizon lights the steps; this list mirrors them for screen readers and tests.
  const chips = steps.map((s) =>
    h(
      "li",
      { class: "playback-step", "data-testid": "playback-step", "data-index": s.index, "data-modality": s.modality, "data-active": "false" },
      `${s.index + 1}. ${SENSE_LABEL[s.modality]}${s.isAnchor ? " (anchor)" : ""}`,
    ),
  );
  const ratingSlot = h("div", { class: "rating-slot" });
  const stopBtn = h("button", { class: "quiet", type: "button", "data-testid": "stop-run", onclick: () => onStop() }, "stop");
  const el = h(
    "section",
    { class: "playback", "data-testid": "playback", "aria-label": "Running your strategy" },
    label,
    line,
    h("ol", { class: "playback-steps visually-hidden" }, chips),
    ratingSlot,
    h("div", { class: "quiet-row" }, stopBtn),
  );

  let resolveRating: ((n: number) => void) | null = null;
  const seen = new Set<number>();

  const show = (text: string, labelText: string): void => {
    label.textContent = labelText;
    const next = h("h2", { class: `playback-line fade-in${text.length > 110 ? " long" : ""}`, "data-testid": "playback-line" }, text);
    line.replaceWith(next);
    line = next;
    followSpoken(next, text);
  };

  const closeRating = (n: number): void => {
    const r = resolveRating;
    resolveRating = null;
    mount(ratingSlot);
    r?.(n);
  };

  return {
    el,
    setLine(stepIndex, text) {
      const step = steps[stepIndex];
      const anchorLine = Boolean(step?.isAnchor && seen.size >= steps.length);
      if (stepIndex >= 0) seen.add(stepIndex);
      setHorizonMood(anchorLine ? "swell" : "playing");
      show(text, stepIndex < 0 ? "Ready" : anchorLine ? "Your anchor" : `${stepIndex + 1} of ${steps.length}  ·  ${SENSE_LABEL[step?.modality ?? "other"].toLowerCase()}`);
      let seenActive = false;
      for (const c of chips) {
        const active = Number(c.dataset.index) === stepIndex;
        c.dataset.active = active ? "true" : "false";
        if (active) seenActive = true;
        if (!seenActive && stepIndex >= 0) c.dataset.done = "true";
      }
    },
    rate(prompt) {
      const after = seen.size > 0;
      if (!after) setHorizonMood("playing");
      show(prompt, after ? "After" : "Before");
      for (const c of chips) c.dataset.active = "false";
      return new Promise<number>((resolve) => {
        resolveRating = resolve;
        const buttons = Array.from({ length: 11 }, (_, n) =>
          h("button", { class: "rate-btn", type: "button", style: `animation-delay:${200 + n * 40}ms`, "data-testid": `rate-${n}`, "aria-label": `${n} out of 10`, onclick: () => closeRating(n) }, String(n)),
        );
        mount(
          ratingSlot,
          h(
            "div",
            { class: "rating", "data-testid": "rating", role: "group", "aria-label": prompt },
            h("div", { class: "rating-pad" }, buttons),
            h("div", { class: "rating-scale" }, h("span", {}, "not at all"), h("span", {}, "completely")),
          ),
        );
        buttons[5]?.focus({ preventScroll: true });
      });
    },
    answerRating(n) {
      if (!resolveRating) return false;
      closeRating(Math.max(0, Math.min(10, Math.round(n))));
      return true;
    },
    finish(text) {
      clearSpoken();
      setHorizonMood("calm");
      label.textContent = "Last run";
      line.textContent = text;
      line.className = "playback-line";
      stopBtn.hidden = true;
      el.dataset.finished = "true";
      for (const c of chips) {
        c.dataset.active = "false";
        c.dataset.done = "true";
      }
      mount(ratingSlot);
    },
  };
}
