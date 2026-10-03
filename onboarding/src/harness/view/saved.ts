// The saved strategy card, the playback panel (with its 0..10 rating pad) and the run log.

import type { RepSession } from "@peak-state/contracts";
import type { SavedStrategy, StepView } from "../../types.ts";
import { h, ICONS, mount, SENSE_LABEL, svg } from "./dom.ts";

export interface SavedHandlers {
  run(): void;
  download(): void;
  newStrategy(): void;
}

export interface SavedModel {
  saved: SavedStrategy;
  stateLabel: string;
  chain: string;
  steps: StepView[];
  running: boolean;
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

export function renderSavedCard(m: SavedModel, handlers: SavedHandlers): HTMLElement {
  return h(
    "div",
    { class: "card saved-card", "data-testid": "saved-card" },
    h(
      "div",
      { class: "saved-head" },
      h("div", { class: "tick-circle" }, svg(ICONS.check)),
      h("div", {}, h("h2", {}, "Strategy saved"), h("p", {}, `${m.stateLabel} · ${m.chain} · saved ${when(m.saved.savedAt)}`)),
    ),
    h(
      "ol",
      { class: "saved-steps" },
      m.steps.map((s) =>
        h(
          "li",
          { class: "saved-step", "data-testid": "saved-step", "data-modality": s.modality, "data-anchor": s.isAnchor ? "true" : "false" },
          h("div", {}, h("span", { class: "what" }, s.content), s.isAnchor ? h("span", { class: "badge anchor", style: "margin-left:8px" }, "⚓ Anchor") : null, h("span", { class: "meta" }, stepMeta(s))),
        ),
      ),
    ),
    h(
      "button",
      { class: "btn primary big run-btn", type: "button", "data-testid": "run", disabled: m.running, onclick: () => handlers.run() },
      h("span", { class: "play", "aria-hidden": "true" }, "▶"),
      m.running ? "Running…" : "Run my strategy",
    ),
    h(
      "div",
      { class: "saved-actions" },
      h("button", { class: "btn", type: "button", "data-testid": "download", onclick: () => handlers.download() }, "Download JSON"),
      h("span", { style: "flex:1" }),
      h("button", { class: "btn ghost", type: "button", "data-testid": "new-strategy", disabled: m.running, onclick: () => handlers.newStrategy() }, "Start a new one"),
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
      const up = typeof r.intensityBefore === "number" && typeof r.intensityAfter === "number" && r.intensityAfter > r.intensityBefore;
      return h(
        "li",
        { class: "run-entry", "data-testid": "run-entry", "data-ended-by": r.endedBy },
        h("span", {}, `Run ${r.repIndex + 1}`),
        h("span", { class: `delta${up ? " up" : ""}` }, `${before} → ${after}`),
        h("span", { class: "when" }, r.endedBy === "completed" ? when(r.startedAt) : `${when(r.startedAt)} · stopped`),
      );
    });
  return h(
    "div",
    { class: "card", "data-testid": "run-log" },
    h("h2", { class: "card-title" }, "Run log", h("span", {}, `${runs.length} run${runs.length === 1 ? "" : "s"}`)),
    items.length ? h("ul", { class: "run-log" }, items) : h("p", { class: "empty" }, "No runs yet. Each run is logged with your rating before → after."),
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
  const line = h("p", { class: "playback-line", "data-testid": "playback-line" }, "");
  const chips = steps.map((s) =>
    h(
      "li",
      { class: "playback-step", "data-testid": "playback-step", "data-index": s.index, "data-modality": s.modality, "data-active": "false" },
      svg(ICONS[s.modality]),
      `${s.index + 1}. ${SENSE_LABEL[s.modality]}`,
      s.isAnchor ? " ⚓" : "",
    ),
  );
  const ratingSlot = h("div", {});
  const stopBtn = h("button", { class: "btn ghost", type: "button", "data-testid": "stop-run", onclick: () => onStop() }, "Stop");
  const el = h(
    "div",
    { class: "card playback", "data-testid": "playback" },
    h("h2", { class: "card-title" }, "Running your strategy", stopBtn),
    h("ol", { class: "playback-steps" }, chips),
    line,
    ratingSlot,
  );

  let resolveRating: ((n: number) => void) | null = null;

  const closeRating = (n: number): void => {
    const r = resolveRating;
    resolveRating = null;
    mount(ratingSlot);
    r?.(n);
  };

  return {
    el,
    setLine(stepIndex, text) {
      line.textContent = text;
      let seenActive = false;
      for (const c of chips) {
        const idx = Number(c.dataset.index);
        const active = idx === stepIndex;
        c.dataset.active = active ? "true" : "false";
        if (active) seenActive = true;
        if (!seenActive && stepIndex >= 0) c.dataset.done = "true";
      }
    },
    rate(prompt) {
      line.textContent = prompt;
      for (const c of chips) c.dataset.active = "false";
      return new Promise<number>((resolve) => {
        resolveRating = resolve;
        const buttons = Array.from({ length: 11 }, (_, n) =>
          h("button", { class: "rate-btn", type: "button", "data-testid": `rate-${n}`, "aria-label": `${n} out of 10`, onclick: () => closeRating(n) }, String(n)),
        );
        mount(
          ratingSlot,
          h(
            "div",
            { class: "rating", "data-testid": "rating", role: "group", "aria-label": prompt },
            h("p", {}, prompt),
            h("div", { class: "rating-pad" }, buttons),
            h("div", { class: "rating-scale" }, h("span", {}, "0 · not at all"), h("span", {}, "10 · completely")),
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
      line.textContent = text;
      stopBtn.hidden = true;
      for (const c of chips) {
        c.dataset.active = "false";
        c.dataset.done = "true";
      }
      mount(ratingSlot);
      el.querySelector(".card-title")?.firstChild?.replaceWith("Last run");
    },
  };
}
