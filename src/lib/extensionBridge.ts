export type ExtensionState = {
  enrolled: boolean;
  userId?: string;
  id?: string;
  organizationId?: string;
  organizationName?: string;
  name?: string;
  revision?: number;
  domains?: string[];
  lastSync?: string;
  error?: string;
};
export type ExtensionAction = "status" | "enroll" | "sync" | "disconnect";
export function requestExtension(
  action: ExtensionAction,
  payload: Record<string, string | boolean> = {},
  signal?: AbortSignal,
): Promise<ExtensionState> {
  if (
    !["http://localhost:5173", "http://127.0.0.1:5173"].includes(
      window.location.origin,
    )
  ) {
    return Promise.reject(
      new Error(
        "The extension connection supports http://localhost:5173 or http://127.0.0.1:5173. Open CyberGuard at one of those addresses, then check again.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const clean = () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(new DOMException("Connection check cancelled.", "AbortError"));
    };
    const timeout = window.setTimeout(
      () => {
        clean();
        reject(
          new Error(
            "Extension did not respond. Reload CyberGuard in chrome://extensions, then refresh this tab.",
          ),
        );
      },
      action === "status" ? 8000 : 55000,
    );
    function receive(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== "CYBERGUARD_PROTECTION_RESPONSE" ||
        event.data.requestId !== requestId
      )
        return;
      clean();
      const state = event.data.state;
      if (event.data.error) reject(new Error(event.data.error));
      else if (!state || typeof state.enrolled !== "boolean")
        reject(new Error("Invalid extension response."));
      else resolve(state);
    }
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", receive);
    window.postMessage(
      { ...payload, type: "CYBERGUARD_PROTECTION_REQUEST", requestId, action },
      window.location.origin,
    );
  });
}

// Wait for old extension writes before deleting server history. Without an extension,
// deletion remains available; a detected extension must confirm preparation.
export function prepareHistoryDeletion(url?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const clean = () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
    let timeout = window.setTimeout(() => {
      clean();
      resolve();
    }, 1500);
    function receive(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== "CYBERGUARD_HISTORY_DELETE_RESPONSE" ||
        event.data.requestId !== requestId
      )
        return;
      if (event.data.error) {
        clean();
        reject(new Error(event.data.error));
      } else if (event.data.phase === "complete") {
        clean();
        resolve();
      } else if (event.data.phase === "started") {
        clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          clean();
          reject(
            new Error(
              "Extension history cleanup timed out. Reload the extension and try again.",
            ),
          );
        }, 45000);
      }
    }
    window.addEventListener("message", receive);
    window.postMessage(
      {
        type: url
          ? "CYBERGUARD_HISTORY_DELETE"
          : "CYBERGUARD_HISTORY_DELETE_ALL",
        requestId,
        ...(url ? { url } : {}),
      },
      window.location.origin,
    );
  });
}
