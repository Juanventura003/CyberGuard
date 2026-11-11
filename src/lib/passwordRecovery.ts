import { supabase } from "./supabase";

let recoveryActive = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hashParams.get("type") === "recovery") {
    recoveryActive = true;
  }
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    recoveryActive = true;
    listeners.forEach((listener) => listener());
  }
});

export function isPasswordRecoveryActive() {
  return recoveryActive;
}

export function clearPasswordRecovery() {
  recoveryActive = false;
}

export function onPasswordRecovery(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sessionIsRecovery(accessToken: string | undefined) {
  if (!accessToken) return false;

  try {
    const payload = JSON.parse(
      atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return (
      Array.isArray(payload.amr) &&
      payload.amr.some((entry: { method?: string }) => entry.method === "recovery")
    );
  } catch {
    return false;
  }
}