const AUTH_KEY = "peakTestAuth";

const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

function readStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.username !== "string" || !data.username) return null;
    if (data.next !== "/onboarding" && data.next !== "/action") return null;
    return { username: data.username, next: data.next };
  } catch {
    return null;
  }
}

function storeAuth(username, next) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ username, next }));
}

function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function showError(message) {
  if (!authError) return;
  authError.textContent = message;
  authError.hidden = !message;
}

async function verifySession(username) {
  const params = new URLSearchParams({ username });
  const res = await fetch(`/api/auth/me?${params}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.username === username;
}

async function authRequest(path, username, password) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? detail[0].msg
          : "Request failed";
    throw new Error(message);
  }
  return data;
}

function goAfterAuth(username, next) {
  storeAuth(username, next);
  window.location.href = next;
}

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const username = usernameInput?.value.trim() ?? "";
  const password = passwordInput?.value ?? "";
  try {
    await authRequest("/api/auth/login", username, password);
    goAfterAuth(username, "/action");
  } catch (err) {
    showError(err.message || "Login failed");
  }
});

document.getElementById("create-account-btn")?.addEventListener("click", async () => {
  showError("");
  const username = usernameInput?.value.trim() ?? "";
  const password = passwordInput?.value ?? "";
  if (!username || !password) {
    showError("Enter a username and password");
    return;
  }
  try {
    await authRequest("/api/auth/register", username, password);
    goAfterAuth(username, "/onboarding");
  } catch (err) {
    showError(err.message || "Could not create account");
  }
});

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has("signout")) {
    clearStoredAuth();
    window.history.replaceState({}, "", "/");
    return;
  }

  const stored = readStoredAuth();
  if (!stored) return;
  const ok = await verifySession(stored.username);
  if (!ok) {
    clearStoredAuth();
    return;
  }
  window.location.replace(stored.next);
})();
