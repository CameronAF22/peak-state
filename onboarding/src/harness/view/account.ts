// Header account control (D-onboarding-017): hidden without a server; otherwise a Sign in button that opens an
// email + invite code form (create an account, or sign in on another device), or the signed-in email and Sign out.

import { h, mount } from "./dom.ts";

export interface AccountHandlers {
  create(email: string, code: string): Promise<void>;
  signIn(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface AccountControls {
  /** null hides the control (no server). */
  render(state: { email: string | null; syncing?: boolean; note?: string | null } | null): void;
  open(): void;
}

export function createAccountControls(root: HTMLElement, handlers: AccountHandlers): AccountControls {
  const email = h("input", { type: "email", id: "account-email", "data-testid": "account-email", autocomplete: "email", placeholder: "you@example.com" });
  const code = h("input", { type: "password", id: "account-code", "data-testid": "account-code", autocomplete: "off", placeholder: "Invite code" });
  const error = h("p", { class: "note", "data-testid": "account-error", role: "alert" });
  let busy = false;

  const submit = async (kind: "create" | "signIn"): Promise<void> => {
    if (busy) return;
    busy = true;
    error.textContent = "";
    try {
      await handlers[kind](email.value.trim(), code.value);
      code.value = "";
      popover.hidden = true;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  };

  const popover = h(
    "form",
    {
      class: "popover",
      id: "account-form",
      "data-testid": "account-form",
      role: "dialog",
      "aria-label": "Your account",
      hidden: true,
      onsubmit: (e: Event) => {
        e.preventDefault();
        void submit("signIn");
      },
    },
    h("h2", {}, "Save your strategy to an account"),
    h("label", { class: "field", for: "account-email" }, "Email", email),
    h("label", { class: "field", for: "account-code" }, "Invite code", code),
    h("p", { class: "note" }, "New here? Create an account with the invite code. On another device, sign in with the same email and code."),
    error,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn ghost", type: "submit", "data-testid": "account-sign-in" }, "Sign in"),
      h("button", { class: "btn primary", type: "button", "data-testid": "account-create", onclick: () => void submit("create") }, "Create account"),
    ),
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") popover.hidden = true;
  });
  document.addEventListener("pointerdown", (e) => {
    if (!popover.hidden && !root.contains(e.target as Node)) popover.hidden = true;
  });

  const open = (): void => {
    popover.hidden = false;
    email.focus();
  };

  return {
    render(state) {
      root.hidden = state === null;
      if (!state) {
        mount(root);
        return;
      }
      if (state.email) {
        mount(
          root,
          h("span", { class: "status", "data-testid": "account-status", "data-state": state.syncing ? "connecting" : "ready", title: state.note ?? "Saved to your account" }, h("span", { class: "dot" }), state.email, state.syncing ? h("span", { class: "visually-hidden" }, " (syncing)") : null),
          h("button", { class: "btn ghost", type: "button", "data-testid": "account-sign-out", onclick: () => void handlers.signOut() }, "Sign out"),
        );
      } else {
        mount(root, h("button", { class: "btn", type: "button", "data-testid": "account-open", "aria-controls": "account-form", "aria-haspopup": "dialog", onclick: open }, "Sign in"), popover);
      }
    },
    open,
  };
}
