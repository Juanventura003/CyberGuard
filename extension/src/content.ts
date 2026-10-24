const extensionChrome = (
	globalThis as unknown as {
		chrome: {
			runtime: {
				id?: string;
				onMessage?: {
					addListener(listener: (message: unknown) => void): void;
				};
				sendMessage(
					message:
						| { type: "setAuthToken"; accessToken: string | null }
						| { type: "setHistoryEnabled"; enabled: boolean }
						| { type: "suppressUrl"; url: string }
						| { type: "clearHistory" }
						| { type: "getBlockedSites" }
						| {
								type: "organizationProtection";
								action: "status" | "enroll" | "sync" | "disconnect";
								organizationId?: string;
								organizationName?: string;
								name?: string;
								userId?: string;
								accessToken?: string;
						  }
						| {
								type: "setSiteBlocked";
								domain: string;
								blocked: boolean;
						  },
				): Promise<unknown>;
			};
			storage: {
				local: {
					set(values: Record<string, unknown>): Promise<void>;
				};
			};
		};
	}
).chrome;

let pendingMessage = Promise.resolve();
let contextExpired = false;

function hasExtensionContext() {
	try {
		return !contextExpired && Boolean(extensionChrome.runtime.id);
	} catch {
		return false;
	}
}

function stopBridge() {
	contextExpired = true;
	window.removeEventListener("message", handleDashboardMessage);
}

function sendToExtension(
	message:
		| { type: "setAuthToken"; accessToken: string | null }
		| { type: "setHistoryEnabled"; enabled: boolean }
		| { type: "suppressUrl"; url: string }
		| { type: "clearHistory" },
) {
	if (!hasExtensionContext()) {
		stopBridge();
		return;
	}
	pendingMessage = pendingMessage
		.catch(() => undefined)
		.then(async () => {
			if (!hasExtensionContext()) {
				stopBridge();
				return;
			}
			if (message.type === "setAuthToken") {
				await extensionChrome.storage.local.set({
					supabaseAccessToken: message.accessToken,
				});
			}
			if (message.type === "setHistoryEnabled") {
				await extensionChrome.storage.local.set({
					historyEnabled: message.enabled,
				});
			}
			await extensionChrome.runtime.sendMessage(message);
		})
		.catch((error) => {
			if (
				!hasExtensionContext() ||
				(error instanceof Error &&
					error.message.includes("Extension context invalidated"))
			) {
				stopBridge();
				return;
			}
			console.error("CyberGuard extension message failed", error);
		});
}

function handleDashboardMessage(event: MessageEvent) {
	if (
		event.source !== window ||
		event.origin !== window.location.origin ||
		!event.data
	)
		return;
	if (
		event.data.type === "CYBERGUARD_PROTECTION_REQUEST" &&
		typeof event.data.requestId === "string"
	) {
		const {
			requestId,
			action,
			organizationId,
			organizationName,
			name,
			userId,
			accessToken,
		} = event.data;
		if (!["status", "enroll", "sync", "disconnect"].includes(action)) return;
		void (async () => {
			try {
				// Protection uses its own credential or request-specific account token.
				// Do not wait for unrelated history/auth messages to finish.
				if (!hasExtensionContext())
					throw new Error("Reload this tab after reloading the extension.");
				const state = await extensionChrome.runtime.sendMessage({
					type: "organizationProtection",
					action,
					organizationId,
					organizationName,
					name,
					userId,
					accessToken,
				});
				window.postMessage(
					{ type: "CYBERGUARD_PROTECTION_RESPONSE", requestId, state },
					window.location.origin,
				);
			} catch {
				window.postMessage(
					{
						type: "CYBERGUARD_PROTECTION_RESPONSE",
						requestId,
						error: "Extension unavailable. Reload the extension and this tab.",
					},
					window.location.origin,
				);
			}
		})();
		return;
	}
	if (
		event.data.type === "CYBERGUARD_BLOCKING_REQUEST" &&
		typeof event.data.requestId === "string"
	) {
		const { requestId, domain, blocked } = event.data;
		void (async () => {
			try {
				if (!hasExtensionContext()) {
					stopBridge();
					return;
				}
				if (typeof domain === "string" && typeof blocked === "boolean") {
					const changed = (await extensionChrome.runtime.sendMessage({
						type: "setSiteBlocked",
						domain,
						blocked,
					})) as { error?: string };
					if (changed?.error) throw new Error(changed.error);
				}
				const state = await extensionChrome.runtime.sendMessage({
					type: "getBlockedSites",
				});
				window.postMessage(
					{ type: "CYBERGUARD_BLOCKING_RESPONSE", requestId, state },
					window.location.origin,
				);
			} catch {
				if (!hasExtensionContext()) {
					stopBridge();
					return;
				}
				window.postMessage(
					{
						type: "CYBERGUARD_BLOCKING_RESPONSE",
						requestId,
						error: "Could not update extension blocking.",
					},
					window.location.origin,
				);
			}
		})();
		return;
	}

	if (event.data.type === "CYBERGUARD_AUTH") {
		sendToExtension({
			type: "setAuthToken",
			accessToken:
				typeof event.data.accessToken === "string"
					? event.data.accessToken
					: null,
		});
	}

	if (event.data.type === "CYBERGUARD_HISTORY") {
		sendToExtension({
			type: "setHistoryEnabled",
			enabled: event.data.enabled === true,
		});
	}

	if (
		event.data.type === "CYBERGUARD_HISTORY_DELETE_ALL" ||
		(event.data.type === "CYBERGUARD_HISTORY_DELETE" &&
			typeof event.data.url === "string")
	) {
		const { requestId, url, type } = event.data;
		const reply = (values: Record<string, unknown>) => {
			if (typeof requestId === "string")
				window.postMessage(
					{ type: "CYBERGUARD_HISTORY_DELETE_RESPONSE", requestId, ...values },
					window.location.origin,
				);
		};
		reply({ phase: "started" });
		void (async () => {
			try {
				if (!hasExtensionContext())
					throw new Error(
						"Reload the extension and refresh this tab before deleting history.",
					);
				const result = await extensionChrome.runtime.sendMessage(
					type === "CYBERGUARD_HISTORY_DELETE_ALL"
						? { type: "clearHistory" }
						: { type: "suppressUrl", url },
				);
				if (!(result as { ok?: boolean })?.ok)
					throw new Error(
						"Could not clear extension history. Reload the extension and try again.",
					);
				reply({ phase: "complete" });
			} catch (error) {
				reply({
					error:
						error instanceof Error
							? error.message
							: "Could not prepare history deletion.",
				});
			}
		})();
	}
}

window.addEventListener("message", handleDashboardMessage);
window.dispatchEvent(new Event("cyberguard-auth-request"));

// The extension reports each risky website visit so this CyberGuard tab can
// show an in-app card for it. Pass it on to the page.
try {
	extensionChrome.runtime.onMessage?.addListener((message) => {
		const data = message as { type?: unknown; visit?: unknown } | null;
		if (data?.type !== "cyberguardRiskyVisit" || !data.visit) return;
		window.postMessage(
			{ type: "CYBERGUARD_RISKY_VISIT", visit: data.visit },
			window.location.origin,
		);
	});
} catch {
	// Extension was reloaded; this tab needs a refresh to reconnect.
}
