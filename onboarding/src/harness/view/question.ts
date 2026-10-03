// The current question: a quiet section label, one line of question text (its spoken word highlighted), choices,
// a single underline to answer in, the two hints after the delay, and back / start over.

import type { Answer, EngineSnapshot, Question } from "../../types.ts";
import { h, mount } from "./dom.ts";
import { followSpoken } from "./spoken.ts";

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

const SENSE_WORD: Record<string, string> = { visual: "picture", auditory: "sound", kinesthetic: "feeling" };

function sectionLabel(q: Question, snap: EngineSnapshot): string {
  const parts: string[] = [];
  if (snap.stateLabel) parts.push(snap.stateLabel);
  const i = q.target?.stepIndex ?? (q.kind === "first-step" ? 0 : q.kind === "next-step" ? snap.steps.length : null);
  if (i !== null && i !== undefined) parts.push(`step ${i + 1}`);
  if (q.target) parts.push(SENSE_WORD[q.target.modality] ?? q.target.modality);
  if (q.kind === "anchor") parts.push("anchor");
  else if (q.kind === "confirm") parts.push(SECTION_LABEL.playback.toLowerCase());
  if (parts.length === 0) parts.push("Peak State");
  return parts.join("  ·  ");
}

export function createQuestionView(handlers: QuestionHandlers): QuestionView {
  const el = h("div", { class: "question-card", "data-testid": "question-card" });
  let current: Question | null = null;
  let renderedKey = "";
  let input: HTMLInputElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;
  let answerRow: HTMLElement | null = null;
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
    answerRow?.classList.add("filled");
    input.focus({ preventScroll: true });
    input.setSelectionRange(text.length, text.length);
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
      const isState = q.kind === "choose-state";
      input = h("input", {
        type: "text",
        class: "answer-input",
        "data-testid": "answer-input",
        autocomplete: "off",
        enterkeyhint: "send",
        placeholder: isState ? "or name your own" : q.choices.length ? "or in your own words" : "in your own words",
        "aria-label": "Your answer",
        oninput: () => {
          handlers.activity();
          answerRow?.classList.toggle("filled", Boolean(input?.value.trim()));
        },
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Enter" && !ke.isComposing) {
            ke.preventDefault();
            send();
          }
        },
      });
      sendBtn = h("button", { class: "send-btn", type: "button", "data-testid": "send", "aria-label": "Send", title: "Send", onclick: send }, "→");
      hintSlot = h("div", { class: "hint-slot" });
      answerRow = h("div", { class: "answer-row fade-in" }, input, sendBtn);
      const questionEl = h("h2", { class: `question-text fade-in${q.text.length > 110 ? " long" : ""}`, "data-testid": "question", id: "question-text" }, q.text);

      mount(
        el,
        h("div", { class: "section-label fade-in", "data-testid": "section-label" }, sectionLabel(q, snap)),
        questionEl,
        q.choices.length
          ? h(
              "div",
              { class: `choices${isState ? " big" : ""}${q.choices.length > 4 ? " many" : ""}`, role: "group", "aria-labelledby": "question-text" },
              q.choices.map((c, i) =>
                h(
                  "button",
                  {
                    class: "choice fade-in",
                    style: `animation-delay:${250 + i * 60}ms`,
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
        answerRow,
        hintSlot,
        h(
          "div",
          { class: "quiet-row" },
          h("button", { class: "quiet", type: "button", "data-testid": "back", disabled: !canGoBack, onclick: () => handlers.back() }, "← back"),
          canGoBack ? h("button", { class: "quiet", type: "button", "data-testid": "reset", onclick: () => handlers.reset() }, "start over") : null,
        ),
      );
      followSpoken(questionEl, q.text);
    },
    showHints() {
      if (!current || !hintSlot) return;
      const q = current;
      mount(
        hintSlot,
        h(
          "div",
          { class: "suggestions", "data-testid": "suggestions", role: "group", "aria-label": "Suggested phrasings" },
          q.suggestions.map((text, i) =>
            h(
              "button",
              {
                class: "hint",
                type: "button",
                style: `animation-delay:${i * 450}ms`,
                "data-testid": "suggestion",
                title: "Use these words (you can edit them). Double-click to send.",
                onclick: () => fill(text),
                ondblclick: () => submit(text, "suggestion"),
              },
              text,
            ),
          ),
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
