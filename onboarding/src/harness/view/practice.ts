// The practice panel (D-onboarding-015): one prompt at a time from the practice loop, with the person's saved
// answer under it, the 0..10 pad for the rating, choices for the strategy question, and an underline for their own
// words. Horizon style (D-onboarding-021): the step being recalled is lit on the horizon, the prompt's spoken word glows.

import type { PracticeSnapshot } from "../../practice/loop.ts";
import type { Answer, StepView } from "../../types.ts";
import { h, mount, SENSE_LABEL } from "./dom.ts";
import { followSpoken } from "./spoken.ts";

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
  const el = h("section", { class: "practice", "data-testid": "practice-panel", role: "region", "aria-labelledby": "practice-title" });
  let renderedKey = "";
  let input: HTMLInputElement | null = null;

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

      // The step being recalled is lit on the horizon; this names it for the label.
      const recallStep = snap.phase === "recall" && snap.recallAt !== null ? steps.find((s) => s.index === snap.recallOrder[snap.recallAt as number]) : undefined;
      const titleText = snap.phase === "done" ? "Practice done" : snap.phase === "stopped" ? "Practice stopped" : `Practice  ·  try ${snap.attempt} of ${snap.maxTries}`;
      const label = h(
        "p",
        { class: "section-label fade-in" },
        h("span", { id: "practice-title", class: "practice-title" }, titleText),
        recallStep ? `  ·  step ${recallStep.index + 1}  ·  ${SENSE_LABEL[recallStep.modality].toLowerCase()}${recallStep.isAnchor ? "  ·  anchor" : ""}` : "",
      );
      const finished = snap.phase === "done" || snap.phase === "stopped";
      const actions = h(
        "div",
        { class: "quiet-row" },
        finished
          ? h("button", { class: "quiet", type: "button", "data-testid": "practice-close", onclick: () => handlers.close() }, "close")
          : h("button", { class: "quiet", type: "button", "data-testid": "practice-stop", onclick: () => handlers.stop() }, "stop"),
      );
      const notice = snap.notice ? h("p", { class: "practice-notice fade-in", "data-testid": "practice-notice", role: "status" }, snap.notice) : null;

      if (!p && snap.safetyStopped) {
        mount(
          el,
          h(
            "div",
            { class: "stop-banner", "data-testid": "stop-banner", role: "alert" },
            h("h2", {}, "Let's stop here"),
            h("p", {}, snap.stopReason ?? "Peak State is not the right support for this."),
            h("p", {}, "If you are in distress, reach out to someone you trust or local emergency services."),
          ),
          actions,
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
          label,
          notice,
          h("h2", { class: "practice-line fade-in", "data-testid": "practice-summary" }, lines.filter(Boolean).join(" ")),
          reminder ? h("p", { class: "practice-reminder fade-in", "data-testid": "practice-reminder" }, reminder) : null,
          actions,
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
                p.choices.map((c, i) =>
                  h(
                    "button",
                    { class: "rate-btn", type: "button", style: `animation-delay:${200 + i * 40}ms`, "data-testid": `practice-rate-${c.value}`, "aria-label": `${c.value} out of 10`, onclick: () => handlers.answer({ text: c.label, via: "choice", choiceValue: c.value }) },
                    c.label,
                  ),
                ),
              ),
              h("div", { class: "rating-scale" }, h("span", {}, "not at all"), h("span", {}, "completely")),
            )
          : h(
              "div",
              { class: `choices${p.choices.length > 4 ? " many" : ""}`, role: "group", "aria-label": p.text },
              p.choices.map((c, i) =>
                h(
                  "button",
                  { class: "choice fade-in", style: `animation-delay:${250 + i * 60}ms`, type: "button", "data-testid": "practice-choice", "data-value": c.value, onclick: () => handlers.answer({ text: c.label, via: "choice", choiceValue: c.value }) },
                  c.label,
                ),
              ),
            );

      const row = h("div", { class: "answer-row fade-in" });
      input = h("input", {
        type: "text",
        class: "answer-input",
        "data-testid": "practice-input",
        autocomplete: "off",
        enterkeyhint: "send",
        placeholder: p.kind === "rate" ? "or say a number" : p.kind === "recall" ? "say what comes back, or press Next" : "or in your own words",
        "aria-label": "Your answer",
        oninput: () => row.classList.toggle("filled", Boolean(input?.value.trim())),
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Enter" && !ke.isComposing) {
            ke.preventDefault();
            send();
          }
        },
      });
      mount(row, input, h("button", { class: "send-btn", type: "button", "data-testid": "practice-send", "aria-label": "Send", title: "Send", onclick: send }, "→"));

      const question = h("h2", { class: `practice-line fade-in${p.text.length > 110 ? " long" : ""}`, "data-testid": "practice-question", "aria-live": "polite" }, p.text);
      mount(
        el,
        label,
        notice,
        question,
        p.remembered ? h("p", { class: "practice-remembered fade-in", "data-testid": "practice-remembered" }, h("span", { class: "remembered-label" }, "Last time"), " ", p.remembered) : null,
        choices,
        row,
        actions,
      );
      followSpoken(question, p.text);
    },
    setDraft(text) {
      if (input) input.value = text;
    },
    focus() {
      input?.focus({ preventScroll: true });
    },
  };
}
