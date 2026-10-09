const extensionChrome = (globalThis as unknown as { chrome: {
	runtime: {
		sendMessage(message:
			| { type: "setAuthToken"; accessToken: string | null }
			| { type: "setHistoryEnabled"; enabled: boolean }
			| { type: "suppressUrl"; url: string }
			| { type: "clearHistory" }
		): Promise<void>;
	};
	storage: {
		local: {
			set(values: Record<string, unknown>): Promise<void>;
		};
	};
} }).chrome;

let pendingMessage = Promise.resolve();

function sendToExtension(message:
	| { type: "setAuthToken"; accessToken: string | null }
	| { type: "setHistoryEnabled"; enabled: boolean }
	| { type: "suppressUrl"; url: string }
	| { type: "clearHistory" }
) {
	pendingMessage = pendingMessage
		.catch(() => undefined)
		.then(async () => {
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
			console.error("CyberGuard extension message failed", error);
		});
}

window.addEventListener("message", (event) => {
	if (event.origin !== window.location.origin || !event.data) return;

	if (event.data.type === "CYBERGUARD_AUTH") {
		sendToExtension({
			type: "setAuthToken",
			accessToken: typeof event.data.accessToken === "string" ? event.data.accessToken : null,
		});
	}

	if (event.data.type === "CYBERGUARD_HISTORY") {
		sendToExtension({
			type: "setHistoryEnabled",
			enabled: event.data.enabled === true,
		});
	}

	if (event.data.type === "CYBERGUARD_HISTORY_DELETE" && typeof event.data.url === "string") {
		sendToExtension({
			type: "suppressUrl",
		url: event.data.url,
	});
	}

	if (event.data.type === "CYBERGUARD_HISTORY_DELETE_ALL") {
		sendToExtension({ type: "clearHistory" });
	}
});

window.dispatchEvent(new Event("cyberguard-auth-request"));
