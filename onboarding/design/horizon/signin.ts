// A quiet sheet that signs in before the live voice starts (D-onboarding-024). On the Cloudflare Worker, GPT live
// sessions are started with the server's key for signed-in accounts only; an email and the invite code are enough.

import { h } from "../../src/harness/view/dom.ts";

export interface SignInSheet {
  open(): void;
  close(): void;
}

/** onSubmit returns an error message to show, or null when signed in. */
export function createSignIn(onSubmit: (email: string, code: string) => Promise<string | null>): SignInSheet {
  const email = h("input", { type: "email", autocomplete: "email", placeholder: "email", "aria-label": "Email", "data-testid": "signin-email" });
  const code = h("input", { type: "password", autocomplete: "off", placeholder: "invite code", "aria-label": "Invite code", "data-testid": "signin-code" });
  const error = h("p", { class: "si-error", role: "alert" }, "");
  const submit = h("button", { class: "si-go", type: "submit", "data-testid": "signin-go" }, "Begin");
  const form = h(
    "form",
    { class: "si-card", "aria-label": "Sign in to start the live voice" },
    h("p", { class: "si-title" }, "Sign in to begin with the live voice"),
    email,
    code,
    error,
    submit,
  );
  const sheet = h("div", { class: "si", hidden: true, "data-testid": "signin" }, form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const em = email.value.trim();
    const c = code.value.trim();
    if (!em || !c) {
      error.textContent = "Enter your email and the invite code.";
      return;
    }
    submit.disabled = true;
    error.textContent = "";
    try {
      const problem = await onSubmit(em, c);
      if (problem) error.textContent = problem;
    } finally {
      submit.disabled = false;
    }
  });

  document.body.append(sheet);
  return {
    open() {
      sheet.hidden = false;
      (email.value ? code : email).focus();
    },
    close() {
      sheet.hidden = true;
    },
  };
}
