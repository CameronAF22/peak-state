// The practice panel (D-onboarding-015): one prompt at a time from the practice loop, with the person's saved
// answer under it, the 0..10 pad for the rating, choices for the strategy question, and a box for their own words.
// Built from the existing card, choice, rating and playback-step styles so a restyle of those carries over.

import type { PracticeSnapshot } from "../../practice/loop.ts";
import type { Answer, StepView } from "../../types.ts";
import { h, ICONS, mount, SENSE_LABEL, svg } from "./dom.ts";

export interface PracticeHandlers {
  answer(answer: Answer): void;
  stop(): void;
  close(): void;
}

export interface PracticeView {
  readonly el: HTMLElement;
  render(snap: PracticeSnapshot, steps: StepView[], reminder: string | null): void;
  setDraft(text: string): void;
  focus(): void;
}

export function createPracticeView(handlers: PracticeHandlers): PracticeView {
  const el = h("div", { class: "card playback practice", "data-testid": "practice-panel", role: "region", "aria-labelledby": "practice-title" });
  let renderedKey = "";
  let input: HTMLTextAreaElement | null = null;

  const send = (): void => {
    const text = input?.value.trim() ?? "";
    if (text) handlers.answer({ text, via: "typed" });
    else input?.focus();
  };

  return {
    el,
    render(snap, steps, reminder) {
      const p = snap.prompt;
      const key = `${snap.phase}|${p?.id ?? ""}|${snap.notice ?? ""}|${snap.runs.length}`;
      if (key === renderedKey) return;
      renderedKey = key;
      input = null;

      const recallStep = snap.phase === "recall" && snap.recallAt !== null ? snap.recallOrder[snap.recallAt] : null;
      const chips = h(
        "ol",
        { class: "playback-steps" },
        steps.map((s) => {
          const pos = snap.recallOrder.indexOf(s.index);
          const done = snap.phase !== "recall" || (snap.recallAt !== null && pos >= 0 && pos < snap.recallAt);
          return h(
            "li",
            {
              class: "playback-step",
              "data-testid": "practice-step",
              "data-index": s.index,
              "data-modality": s.modality,
              "data-active": recallStep === s.index ? "true" : "false",
              "data-done": done ? "true" : "false",
              "aria-current": recallStep === s.index ? "step" : null,
            },
            svg(ICONS[s.modality]),
            `${s.index + 1}. ${SENSE_LABEL[s.modality]}`,
            s.isAnchor ? h("span", { "aria-hidden": "true" }, " ⚓") : "",
            s.isAnchor ? h("span", { class: "visually-hidden" }, " (anchor)") : "",
          );
        }),
      );

      const title = h(
        "div",
        { class: "card-title" },
        h("h2", { id: "practice-title", class: "practice-title" }, snap.phase === "done" ? "Practice done" : snap.phase === "stopped" ? "Practice stopped" : `Practice · try ${snap.attempt} of ${snap.maxTries}`),
        snap.phase === "done" || snap.phase === "stopped"
          ? h("button", { class: "btn ghost", type: "button", "data-testid": "practice-close", onclick: () => handlers.close() }, "Close")
          : h("button", { class: "btn ghost", type: "button", "data-testid": "practice-stop", onclick: () => handlers.stop() }, "Stop"),
      );
      const notice = snap.notice ? h("p", { class: "practice-notice", "data-testid": "practice-notice", role: "status" }, snap.notice) : null;

      if (!p && snap.safetyStopped) {
        mount(
          el,
          title,
          h(
            "div",
            { class: "stop-banner", "data-testid": "stop-banner", role: "alert" },
            h("h2", {}, "Let's stop here"),
            h("p", {}, snap.stopReason ?? "Peak State is not the right support for this."),
            h("p", {}, "If you are in distress, reach out to someone you trust or local emergency services."),
          ),
        );
        return;
      }

      if (!p) {
        const last = snap.runs[snap.runs.length - 1];
        const changed = snap.changes.length;
        const lines =
          snap.phase === "stopped"
            ? ["Stopped. Nothing else was changed."]
            : [
                last?.intensityAfter !== null && last?.intensityAfter !== undefined ? `You got to ${last.intensityAfter} out of 10.` : "",
                changed ? `Your strategy was updated ${changed === 1 ? "once" : `${changed} times`} this session.` : "Your strategy stays as it is.",
              ];
        mount(
          el,
          title,
          chips,
          notice,
          h("p", { class: "playback-line", "data-testid": "practice-summary" }, lines.filter(Boolean).join(" ")),
          reminder ? h("p", { class: "practice-reminder", "data-testid": "practice-reminder" }, reminder) : null,
        );
        return;
      }

      const choices =
        p.kind === "rate"
          ? h(
              "div",
              { class: "rating", "data-testid": "practice-rating", role: "group", "aria-label": p.text },
              h(
                "div",
                { class: "rating-pad" },
                p.choices.map((c) => h("button", { class: "rate-btn", type: "button", "data-testid": `practice-rate-${c.value}`, "aria-label": `${c.value} out of 10`, onclick: () => handlers.answer({ text: c.label, via: "choice", choiceValue: c.value }) }, c.label)),
              ),
              h("div", { class: "rating-scale" }, h("span", {}, "0 · not at all"), h("span", {}, "10 · completely")),
            )
          : h(
              "div",
              { class: "choices", role: "group", "aria-label": p.text },
              p.choices.map((c) => h("button", { class: "choice", type: "button", "data-testid": "practice-choice", "data-value": c.value, onclick: () => handlers.answer({ text: c.label, via: "choice", choiceValue: c.value }) }, c.label)),
            );

      input = h("textarea", {
        class: "answer-input",
        "data-testid": "practice-input",
        rows: 2,
        placeholder: p.kind === "rate" ? "Or say a number…" : p.kind === "recall" ? "Say what comes back, or press Next…" : "Or say it in your own words…",
        "aria-label": "Your answer",
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Enter" && !ke.shiftKey && !ke.isComposing) {
            ke.preventDefault();
            send();
          }
        },
      });

      mount(
        el,
        title,
        chips,
        notice,
        h("p", { class: "playback-line", "data-testid": "practice-question", "aria-live": "polite" }, p.text),
        p.remembered ? h("p", { class: "practice-remembered", "data-testid": "practice-remembered" }, h("span", { class: "section-label" }, "Last time"), " ", p.remembered) : null,
        choices,
        h("div", { class: "answer-row" }, input, h("div", { class: "answer-actions" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", type: "button", "data-testid": "practice-send", onclick: send }, "Send"))),
      );
    },
    setDraft(text) {
      if (input) input.value = text;
    },
    focus() {
      input?.focus({ preventScroll: true });
    },
  };
}
