type WebsiteActivity = {
	url: string;
	domain: string;
	visitedAt: string;
	riskScore: number | null;
	riskLevel: string;
	pageWarning?: boolean;
	threatTypes: string[];
	explanation: string[];
	source: string;
};

type ExtensionState = {
	monitoringEnabled: boolean;
	bannerEnabled: boolean;
	historyEnabled: boolean;
	authenticated: boolean;
	activity: WebsiteActivity[];
};

declare const chrome: {
	storage: {
		onChanged: {
			addListener(
				listener: (
					changes: Record<string, { newValue?: unknown }>,
					area: string,
				) => void,
			): void;
		};
	};
	runtime: {
		sendMessage(message: {
			type: "getBlockedSites";
		}): Promise<{ domains: string[]; error?: string }>;
		sendMessage(message: {
			type: "setSiteBlocked";
			domain: string;
			blocked: boolean;
		}): Promise<{ ok?: boolean; error?: string }>;
		sendMessage(message: {
			type: "getState" | "refresh";
		}): Promise<ExtensionState>;
		sendMessage(message: {
			type: "setBanner";
			enabled: boolean;
		}): Promise<{ bannerEnabled: boolean }>;
		sendMessage(message: {
			type: "setMonitoring";
			enabled: boolean;
		}): Promise<{ monitoringEnabled: boolean }>;
		sendMessage(message: { type: "openDashboard" }): Promise<{ ok: boolean }>;
	};
	tabs: {
		query: (queryInfo: {
			active: boolean;
			currentWindow: boolean;
		}) => Promise<{ url?: string }[]>;
		create: (createProperties: { url: string }) => Promise<unknown>;
	};
};

const bannerToggle = document.querySelector<HTMLInputElement>("#banner-toggle");
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes.bannerEnabled && bannerToggle) {
		bannerToggle.checked = changes.bannerEnabled.newValue === true;
	}
});
bannerToggle?.addEventListener("change", async () => {
	try {
		await chrome.runtime.sendMessage({
			type: "setBanner",
			enabled: bannerToggle.checked,
		});
		setStatus(
			bannerToggle.checked
				? "Floating notifications enabled."
				: "Floating notifications hidden.",
		);
	} catch {
		setStatus("Could not save notification setting.");
	}
});

const monitoringToggle =
	document.querySelector<HTMLInputElement>("#monitoring-toggle");
const refreshButton =
	document.querySelector<HTMLButtonElement>("#refresh-button");
const historyButton =
	document.querySelector<HTMLButtonElement>("#history-button");
const statusElement = document.querySelector<HTMLElement>("#status");
const latestElement = document.querySelector<HTMLElement>("#latest");

monitoringToggle?.addEventListener("change", async () => {
	try {
		const response = await chrome.runtime.sendMessage({
			type: "setMonitoring",
			enabled: monitoringToggle.checked,
		});
		setStatus(
			response?.monitoringEnabled
				? "Monitoring is active."
				: "Monitoring is paused.",
		);
	} catch (error) {
		console.error("Could not save monitoring state", error);
		setStatus("Could not save monitoring state. Try again.");
	}
});

historyButton?.addEventListener("click", async () => {
	setStatus("Opening CyberGuard dashboard...");
	try {
		const tabs = await chrome.tabs.query({
			active: false,
			currentWindow: false,
		});
		const dashboardOrigin =
			tabs
				.map((tab) => tab.url)
				.find(
					(url) =>
						url?.startsWith("http://127.0.0.1:5173") ||
						url?.startsWith("http://localhost:5173"),
				)
				?.split("/")
				.slice(0, 3)
				.join("/") ?? "http://localhost:5173";
		await chrome.tabs.create({
			url: `${dashboardOrigin}/website-tracker?extension=connect`,
		});
		setStatus("Dashboard opened. Sign in to enable history saving.");
	} catch (error) {
		console.error("Could not open CyberGuard dashboard", error);
		setStatus("Could not open the dashboard.");
	}
});

refreshButton?.addEventListener("click", () => {
	void refreshActivity();
});

void loadState();

async function loadState() {
	try {
		const state = await chrome.runtime.sendMessage({ type: "getState" });
		monitoringToggle!.checked = state.monitoringEnabled;
		bannerToggle!.checked = state.bannerEnabled;
		if (state.historyEnabled && state.authenticated) {
			historyButton!.textContent = "History saving is active";
			historyButton!.disabled = true;
		} else {
			historyButton!.textContent = "Connect dashboard to save history";
			historyButton!.disabled = false;
		}
		if (state.activity.length) {
			await renderActivity(state.activity);
			return;
		}

		await refreshActivity();
	} catch (error) {
		console.error("Could not load extension state", error);
		setStatus(
			"Could not connect to the monitor. Reload the extension and try again.",
		);
		latestElement!.textContent =
			"The extension background worker did not respond.";
	}
}

async function refreshActivity() {
	setStatus("Checking the current page...");
	latestElement!.textContent = "Running live URL check...";
	refreshButton?.setAttribute("disabled", "true");

	try {
		const refreshedState = await chrome.runtime.sendMessage({
			type: "refresh",
		});
		if (refreshedState.activity.length) {
			await renderActivity(refreshedState.activity);
			return;
		}
		setStatus("No websites have been recorded yet.");
		latestElement!.textContent =
			"Open an http or https website to start monitoring.";
	} catch (error) {
		console.error("Popup live check failed", error);
		setStatus("Could not reach the CyberGuard backend.");
		latestElement!.textContent =
			"Check that the backend is running on localhost:8000.";
	} finally {
		refreshButton?.removeAttribute("disabled");
	}
}

async function renderActivity(activity: WebsiteActivity[]) {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	activity = activity.filter((item) => item.url === tabs[0]?.url);
	if (!activity.length) {
		setStatus("No websites have been recorded yet.");
		latestElement!.textContent = "Browse to a website to create live activity.";
		return;
	}

	const [latest] = activity;
	setStatus("Current website checked.");
	latestElement!.innerHTML = `
		<span class="risk risk-${latest.riskLevel.toLowerCase().replaceAll("_", "-")}">${latest.riskLevel === "SUSPICIOUS" && latest.pageWarning ? "Suspicious page" : formatRisk(latest.riskLevel)}</span>
		<strong>${escapeHtml(latest.domain)}</strong>
		<p>${escapeHtml(latest.explanation?.[0] ?? "No explanation available.")}</p>
	`;
}

function formatRisk(riskLevel: string) {
	return riskLevel.replaceAll("_", " ");
}

function setStatus(message: string) {
	statusElement!.textContent = message;
}

function escapeHtml(value: string) {
	const element = document.createElement("span");
	element.textContent = value;
	return element.innerHTML;
}

const blockButton = document.querySelector<HTMLButtonElement>("#block-site")!;
async function renderBlockedSites() {
	try {
		const state = await chrome.runtime.sendMessage({
			type: "getBlockedSites",
		});
		if (state.error) throw new Error(state.error);
		const tabs = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		let domain = "";
		try {
			const url = new URL(tabs[0]?.url ?? "");
			if (["http:", "https:"].includes(url.protocol)) domain = url.hostname;
		} catch {
			/* Restricted page. */
		}
		const covering = state.domains.find(
			(host) => domain === host || domain.endsWith(`.${host}`),
		);
		document.querySelector("#blocking-domain")!.textContent =
			domain || "Open a website to block it";
		document.querySelector("#blocked-count")!.textContent = String(
			state.domains.length,
		);
		blockButton.classList.toggle("is-blocked", Boolean(covering));
		blockButton.disabled = !domain;
		blockButton.textContent = covering ? "Unblock" : "Block website";
		blockButton.setAttribute(
			"aria-label",
			covering ? `Unblock ${covering}` : `Block ${domain || "website"}`,
		);
		blockButton.title = covering
			? `Unblock ${covering} and its subdomains`
			: `Block ${domain || "this website"} and its subdomains`;
		blockButton.onclick = () => {
			void changeBlock(covering ?? domain, !covering);
		};
		const list = document.querySelector<HTMLUListElement>("#blocked-sites")!;
		list.replaceChildren();
		for (const host of state.domains) {
			const row = document.createElement("li");
			const name = document.createElement("span");
			name.textContent = host;
			const button = document.createElement("button");
			button.textContent = "Unblock";
			button.type = "button";
			button.setAttribute("aria-label", `Unblock ${host}`);
			button.onclick = () => {
				void changeBlock(host, false);
			};
			row.append(name, button);
			list.append(row);
		}
		if (!state.domains.length) list.textContent = "No websites blocked.";
	} catch {
		blockButton.disabled = true;
		setStatus("Could not load blocked websites. Reload the extension.");
	}
}
async function changeBlock(domain: string, blocked: boolean) {
	blockButton.disabled = true;
	try {
		const response = await chrome.runtime.sendMessage({
			type: "setSiteBlocked",
			domain,
			blocked,
		});
		if (!response.ok) throw new Error(response.error);
		await renderBlockedSites();
		setStatus(
			blocked
				? `${domain} blocked for future visits.`
				: `${domain} unblocked. Reload its tab to visit it.`,
		);
	} catch {
		setStatus("Could not change blocking. Try again.");
		await renderBlockedSites();
	}
}
void renderBlockedSites();
