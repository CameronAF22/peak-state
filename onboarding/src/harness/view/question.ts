// The current question card: section label, question text, choices, the answer box, the two hints.

import type { Answer, EngineSnapshot, Question } from "../../types.ts";
import { h, mount } from "./dom.ts";

export interface QuestionHandlers {
  answer(answer: Answer): void;
  back(): void;
  reset(): void;
  /** The person typed: restarts the hint countdown. */
  activity(): void;
}

export interface QuestionView {
  readonly el: HTMLElement;
  /** Render the snapshot's question. Rebuilds only when the question changes, so a draft survives other updates. */
  render(snap: EngineSnapshot): void;
  /** Show the current question's two suggestions. */
  showHints(): void;
  /** Put text in the answer box (voice partials). */
  setDraft(text: string): void;
  focus(): void;
}

const SECTION_LABEL: Record<Question["section"], string> = {
  strategy: "Your strategy",
  submodalities: "The details",
  playback: "Playback",
};

function sectionLabel(q: Question, snap: EngineSnapshot): string {
  const base = SECTION_LABEL[q.section] ?? q.section;
  const state = snap.stateLabel ? ` · ${snap.stateLabel}` : "";
  if (q.target) return `${base} · step ${q.target.stepIndex + 1}${state}`;
  return `${base}${state}`;
}

export function createQuestionView(handlers: QuestionHandlers): QuestionView {
  const el = h("div", { class: "card question-card", "data-testid": "question-card" });
  let current: Question | null = null;
  let renderedKey = "";
  let input: HTMLTextAreaElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;
  let hintSlot: HTMLElement | null = null;
  let usedSuggestion: string | null = null;

  const submit = (text: string, via: Answer["via"]): void => {
    const t = text.trim();
    if (!t) {
      input?.focus();
      return;
    }
    handlers.answer({ text: t, via });
  };

  const send = (): void => {
    const text = input?.value ?? "";
    const via: Answer["via"] = usedSuggestion !== null && text.trim() === usedSuggestion.trim() ? "suggestion" : "typed";
    submit(text, via);
  };

  const fill = (text: string): void => {
    if (!input) return;
    input.value = text;
    usedSuggestion = text;
    sendBtn?.focus();
  };

  const view: QuestionView = {
    el,
    render(snap) {
      const q = snap.question;
      const key = q ? `${q.id}|${snap.transcript.length}` : "none";
      if (key === renderedKey) return;
      renderedKey = key;
      current = q;
      usedSuggestion = null;
      if (!q) {
        mount(el);
        input = null;
        return;
      }
      const canGoBack = snap.transcript.some((t) => t.who === "person");
      input = h("textarea", {
        class: "answer-input",
        "data-testid": "answer-input",
        rows: 3,
        placeholder: q.choices.length ? "Pick one above, or say it in your own words…" : "In your own words…",
        "aria-label": "Your answer",
        oninput: () => handlers.activity(),
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Enter" && !ke.shiftKey && !ke.isComposing) {
            ke.preventDefault();
            send();
          }
        },
      });
      sendBtn = h("button", { class: "btn primary", type: "button", "data-testid": "send", onclick: send }, "Send");
      hintSlot = h("div", { class: "hint-slot" });

      mount(
        el,
        h("div", { class: "section-label", "data-testid": "section-label" }, sectionLabel(q, snap)),
        h("h2", { class: "question-text", "data-testid": "question", id: "question-text" }, q.text),
        q.choices.length
          ? h(
              "div",
              { class: `choices${q.kind === "choose-state" ? " big" : ""}`, role: "group", "aria-labelledby": "question-text" },
              q.choices.map((c) =>
                h(
                  "button",
                  {
                    class: "choice",
                    type: "button",
                    "data-testid": "choice",
                    "data-value": c.value,
                    onclick: () => handlers.answer({ text: c.label, via: "choice", choiceValue: c.value }),
                  },
                  c.label,
                ),
              ),
            )
          : null,
        hintSlot,
        h(
          "div",
          { class: "answer-row" },
          input,
          h(
            "div",
            { class: "answer-actions" },
            h("button", { class: "btn ghost", type: "button", "data-testid": "back", disabled: !canGoBack, onclick: () => handlers.back() }, "← Back"),
            h("button", { class: "btn ghost", type: "button", "data-testid": "reset", onclick: () => handlers.reset() }, "Start over"),
            h("span", { class: "spacer" }),
            sendBtn,
          ),
        ),
      );
    },
    showHints() {
      if (!current || !hintSlot) return;
      const q = current;
      const [a, b] = q.suggestions;
      const chip = (text: string) =>
        h(
          "div",
          { class: "chip", "data-testid": "suggestion" },
          h(
            "button",
            {
              class: "chip-text",
              type: "button",
              title: "Put this in the box to edit, or double-click to send it",
              onclick: () => fill(text),
              ondblclick: () => submit(text, "suggestion"),
            },
            text,
          ),
          h("button", { class: "chip-use", type: "button", "data-testid": "suggestion-use", "aria-label": `Send: ${text}`, onclick: () => submit(text, "suggestion") }, "Use ↵"),
        );
      mount(
        hintSlot,
        h(
          "div",
          { class: "suggestions", "data-testid": "suggestions", role: "group", "aria-label": "Suggested phrasings" },
          h("p", { class: "suggestions-title" }, "Need words? Try one:"),
          h("div", { class: "suggestion-list" }, chip(a), chip(b)),
        ),
      );
    },
    setDraft(text) {
      if (input) input.value = text;
    },
    focus() {
      input?.focus({ preventScroll: true });
    },
  };
  return view;
}
