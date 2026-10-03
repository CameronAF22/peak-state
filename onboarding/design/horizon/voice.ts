// A tiny corner control for the voice: one quiet button that shows the current voice and its state,
// opening a small menu (Typed · Browser voice · GPT live, with the GPT live key and model).

import type { VoiceKind, VoiceStatus } from "../../src/types.ts";
import type { VoiceSettings } from "../../src/voice/index.ts";
import { h, mount } from "../../src/harness/view/dom.ts";

export interface VoiceToggle {
  setStatus(status: VoiceStatus): void;
  openSettings(): void;
}

const KIND_LABEL: Record<VoiceKind, string> = { typed: "Typed", browser: "Browser voice", "gpt-live": "GPT live" };
const SHORT: Record<VoiceKind, string> = { typed: "typing", browser: "voice", "gpt-live": "live voice" };

const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>`;

export function createVoiceToggle(root: HTMLElement, initial: VoiceSettings, onChange: (s: VoiceSettings) => void): VoiceToggle {
  let settings: VoiceSettings = { ...initial };

  const icon = h("span", { class: "vt-icon" });
  icon.innerHTML = MIC;
  const label = h("span", { class: "vt-label" }, SHORT[settings.kind]);
  const button = h(
    "button",
    { class: "vt", type: "button", "data-testid": "voice-toggle", "aria-haspopup": "true", "aria-expanded": "false", "data-state": "ready", title: "Voice" },
    icon,
    label,
  );

  const option = (kind: VoiceKind) =>
    h(
      "button",
      {
        class: "vt-opt",
        type: "button",
        role: "menuitemradio",
        "data-testid": `voice-${kind}`,
        "aria-checked": settings.kind === kind ? "true" : "false",
        onclick: () => choose(kind),
      },
      KIND_LABEL[kind],
    );

  const model = h("input", { type: "text", "data-testid": "gpt-model", value: settings.model, autocomplete: "off", spellcheck: "false", "aria-label": "Model id" });
  const key = h("input", { type: "password", "data-testid": "gpt-key", value: settings.apiKey ?? "", autocomplete: "off", placeholder: "API key", "aria-label": "API key" });
  const remember = h("input", { type: "checkbox", "data-testid": "gpt-remember", id: "hz-remember" });
  remember.checked = settings.remember;
  const gpt = h(
    "div",
    { class: "vt-gpt", hidden: settings.kind !== "gpt-live" },
    model,
    key,
    h("label", { class: "vt-check", for: "hz-remember" }, remember, "remember key here"),
    h(
      "button",
      {
        class: "vt-save",
        type: "button",
        "data-testid": "voice-settings-save",
        onclick: () => {
          settings = { ...settings, model: model.value.trim() || settings.model, apiKey: key.value.trim() || undefined, remember: remember.checked };
          close();
          onChange(settings);
        },
      },
      "save",
    ),
  );
  const status = h("p", { class: "vt-status", "data-testid": "voice-status" }, "");
  const menu = h("div", { class: "vt-menu", role: "menu", hidden: true }, option("typed"), option("browser"), option("gpt-live"), gpt, status);

  const syncOptions = (): void => {
    for (const b of menu.querySelectorAll<HTMLElement>(".vt-opt")) b.setAttribute("aria-checked", b.dataset.testid === `voice-${settings.kind}` ? "true" : "false");
    gpt.hidden = settings.kind !== "gpt-live";
    label.textContent = SHORT[settings.kind];
  };
  const open = (): void => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  const close = (): void => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  function choose(kind: VoiceKind): void {
    settings = { ...settings, kind };
    syncOptions();
    if (kind === "gpt-live" && !settings.apiKey) {
      key.focus();
      return; // wait for save
    }
    close();
    onChange(settings);
  }

  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !root.contains(e.target as Node)) close();
  });

  mount(root, button, menu);

  return {
    setStatus(s) {
      button.dataset.state = s.state;
      const text = s.kind === "typed" ? "Typing. Switch to a voice to speak your answers." : `${KIND_LABEL[s.kind]}: ${s.state}${s.detail ? `. ${s.detail}` : ""}`;
      status.textContent = text;
      button.title = text;
      label.textContent = s.state === "listening" ? "listening" : s.state === "speaking" ? "speaking" : SHORT[s.kind];
    },
    openSettings() {
      open();
      gpt.hidden = false;
      key.focus();
    },
  };
}
