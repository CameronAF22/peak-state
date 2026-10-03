// Header voice controls: Typed / Browser voice / GPT live, a settings popover for GPT live, and a status dot.

import type { VoiceKind, VoiceStatus } from "../../types.ts";
import type { VoiceSettings } from "../../voice/index.ts";
import { h, ICONS, mount, svg } from "./dom.ts";

export interface VoiceControls {
  setStatus(status: VoiceStatus): void;
  openSettings(): void;
}

const STATE_TEXT: Record<VoiceStatus["state"], string> = {
  idle: "Off",
  connecting: "Connecting…",
  ready: "Ready",
  speaking: "Speaking",
  listening: "Listening",
  error: "Problem",
};

export function createVoiceControls(root: HTMLElement, initial: VoiceSettings, onChange: (s: VoiceSettings) => void): VoiceControls {
  let settings: VoiceSettings = { ...initial };

  const select = h(
    "select",
    { id: "voice-select", "data-testid": "voice-select", "aria-label": "Voice" },
    h("option", { value: "typed" }, "Typed"),
    h("option", { value: "browser" }, "Browser voice"),
    h("option", { value: "gpt-live" }, "GPT live"),
  );
  select.value = settings.kind;

  const statusText = h("span", { class: "status-text" }, "Ready");
  const status = h("span", { class: "status", "data-testid": "voice-status", "data-state": "ready", role: "status", title: "Voice status" }, h("span", { class: "dot" }), statusText);

  const model = h("input", { type: "text", id: "gpt-model", "data-testid": "gpt-model", value: settings.model, autocomplete: "off", spellcheck: "false" });
  const key = h("input", { type: "password", id: "gpt-key", "data-testid": "gpt-key", value: settings.apiKey ?? "", autocomplete: "off", placeholder: "sk-…" });
  const remember = h("input", { type: "checkbox", id: "gpt-remember", "data-testid": "gpt-remember" });
  remember.checked = settings.remember;

  const popover = h(
    "div",
    { class: "popover", "data-testid": "voice-settings", role: "dialog", "aria-label": "GPT live settings", hidden: true },
    h("h2", {}, "GPT live settings"),
    h("label", { class: "field", for: "gpt-model" }, "Model id", model),
    h("label", { class: "field", for: "gpt-key" }, "API key", key),
    h("label", { class: "check", for: "gpt-remember" }, remember, "Remember the key in this browser"),
    h("p", { class: "note" }, "The key is sent only to the realtime endpoint. Unless you tick remember, it is kept for this page only."),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn ghost", type: "button", onclick: () => (popover.hidden = true) }, "Cancel"),
      h(
        "button",
        {
          class: "btn primary",
          type: "button",
          "data-testid": "voice-settings-save",
          onclick: () => {
            settings = { ...settings, model: model.value.trim() || "gpt-live-1", apiKey: key.value.trim() || undefined, remember: remember.checked };
            popover.hidden = true;
            onChange(settings);
          },
        },
        "Save",
      ),
    ),
  );

  const gear = h(
    "button",
    {
      class: "icon-btn",
      type: "button",
      "data-testid": "voice-settings-button",
      "aria-label": "Voice settings",
      title: "Voice settings",
      onclick: () => {
        popover.hidden = !popover.hidden;
        if (!popover.hidden) (settings.apiKey ? model : key).focus();
      },
    },
    svg(ICONS.gear),
  );

  select.addEventListener("change", () => {
    settings = { ...settings, kind: select.value as VoiceKind };
    if (settings.kind === "gpt-live" && !settings.apiKey) {
      popover.hidden = false;
      key.focus();
    }
    onChange(settings);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") popover.hidden = true;
  });
  document.addEventListener("pointerdown", (e) => {
    if (!popover.hidden && !root.contains(e.target as Node)) popover.hidden = true;
  });

  mount(root, h("label", { class: "voice-label", for: "voice-select" }, "Voice"), select, status, gear, popover);

  return {
    setStatus(s) {
      status.dataset.state = s.state;
      const text = s.kind === "typed" && s.state === "ready" ? "Typed" : STATE_TEXT[s.state];
      statusText.textContent = text;
      status.title = s.detail ? `${text}: ${s.detail}` : text;
    },
    openSettings() {
      popover.hidden = false;
      key.focus();
    },
  };
}
