// Corner voice control (Horizon style, D-onboarding-021): one quiet button showing the current voice and its state,
// opening a small menu: Typed · Browser voice · GPT live, with the GPT live model, key and status.

import type { VoiceKind, VoiceStatus } from "../../types.ts";
import type { VoiceSettings } from "../../voice/index.ts";
import { h, mount } from "./dom.ts";

export interface VoiceControls {
  setStatus(status: VoiceStatus): void;
  openSettings(): void;
}

const KIND_LABEL: Record<VoiceKind, string> = { typed: "Typed", browser: "Browser voice", "gpt-live": "GPT live" };
const SHORT: Record<VoiceKind, string> = { typed: "typing", browser: "voice", "gpt-live": "live voice" };

const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>`;

export function createVoiceControls(root: HTMLElement, initial: VoiceSettings, onChange: (s: VoiceSettings) => void): VoiceControls {
  let settings: VoiceSettings = { ...initial };

  const icon = h("span", { class: "vt-icon" });
  icon.innerHTML = MIC;
  const label = h("span", { class: "vt-label" }, SHORT[settings.kind]);
  const button = h(
    "button",
    { class: "vt", type: "button", "data-testid": "voice-toggle", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "voice-menu", "data-state": "ready", title: "Voice" },
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
  const remember = h("input", { type: "checkbox", "data-testid": "gpt-remember", id: "gpt-remember" });
  remember.checked = settings.remember;
  const gpt = h(
    "div",
    { class: "vt-gpt", hidden: settings.kind !== "gpt-live" },
    model,
    key,
    h("label", { class: "vt-check", for: "gpt-remember" }, remember, "remember the key in this browser"),
    h("p", { class: "vt-note" }, "The key goes only to the realtime endpoint. Signed in, the account can supply it."),
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
  const status = h("p", { class: "vt-status", "data-testid": "voice-status", role: "status" }, "");
  const menu = h("div", { class: "vt-menu", id: "voice-menu", "data-testid": "voice-settings", role: "menu", "aria-label": "Voice", hidden: true }, option("typed"), option("browser"), option("gpt-live"), gpt, status);

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
    // GPT live without a key keeps the menu open on the key field; a signed-in account may supply the key instead.
    if (kind === "gpt-live" && !settings.apiKey) key.focus();
    else close();
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
