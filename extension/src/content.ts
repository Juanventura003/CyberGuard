const extensionChrome = (
	globalThis as unknown as {
		chrome: {
			runtime: {
				id?: string;
				sendMessage(
					message:
						| { type: "setAuthToken"; accessToken: string | null }
						| { type: "setHistoryEnabled"; enabled: boolean }
						| { type: "suppressUrl"; url: string }
						| { type: "clearHistory" }
						| { type: "getBlockedSites" }
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
				if (
					typeof domain === "string" &&
					typeof blocked === "boolean"
				) {
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
		event.data.type === "CYBERGUARD_HISTORY_DELETE" &&
		typeof event.data.url === "string"
	) {
		sendToExtension({
			type: "suppressUrl",
			url: event.data.url,
		});
	}

	if (event.data.type === "CYBERGUARD_HISTORY_DELETE_ALL") {
		sendToExtension({ type: "clearHistory" });
	}
}

window.addEventListener("message", handleDashboardMessage);
window.dispatchEvent(new Event("cyberguard-auth-request"));
