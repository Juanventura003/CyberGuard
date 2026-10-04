type WebsiteActivity = {
	url: string;
	domain: string;
	visitedAt: string;
	riskScore: number | null;
	riskLevel: string;
	threatTypes: string[];
	explanation: string[];
	source: string;
};

type ExtensionState = {
	monitoringEnabled: boolean;
	historyEnabled: boolean;
	authenticated: boolean;
	activity: WebsiteActivity[];
};

declare const chrome: {
	runtime: {
		sendMessage(message: { type: "getState" | "refresh" }): Promise<ExtensionState>;
		sendMessage(message: { type: "setMonitoring"; enabled: boolean }): Promise<{ monitoringEnabled: boolean }>;
		sendMessage(message: { type: "openDashboard" }): Promise<{ ok: boolean }>;
	};
	tabs: {
		query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<({ url?: string })[]>;
		create: (createProperties: { url: string }) => Promise<unknown>;
	};
};

const monitoringToggle = document.querySelector<HTMLInputElement>("#monitoring-toggle");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button");
const historyButton = document.querySelector<HTMLButtonElement>("#history-button");
const statusElement = document.querySelector<HTMLElement>("#status");
const latestElement = document.querySelector<HTMLElement>("#latest");

monitoringToggle?.addEventListener("change", async () => {
	const response = await chrome.runtime.sendMessage({
		type: "setMonitoring",
		enabled: monitoringToggle.checked,
	});
	setStatus(response?.monitoringEnabled ? "Monitoring is active." : "Monitoring is paused.");
});

historyButton?.addEventListener("click", async () => {
	setStatus("Opening CyberGuard dashboard...");
	try {
		const tabs = await chrome.tabs.query({ active: false, currentWindow: false });
		const dashboardOrigin = tabs
			.map((tab) => tab.url)
			.find((url) => url?.startsWith("http://127.0.0.1:5173") || url?.startsWith("http://localhost:5173"))
			?.split("/").slice(0, 3).join("/")
			?? "http://localhost:5173";
		await chrome.tabs.create({ url: `${dashboardOrigin}/website-tracker?extension=connect` });
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
	const state = await chrome.runtime.sendMessage({ type: "getState" });
	monitoringToggle!.checked = state.monitoringEnabled;
	if (state.historyEnabled) {
		historyButton!.textContent = "History saving is active";
		historyButton!.disabled = true;
	}
	if (state.activity.length) {
		renderActivity(state.activity);
		return;
	}

	await refreshActivity();
}

async function refreshActivity() {
	setStatus("Checking the current page...");
	latestElement!.textContent = "Running live URL check...";
	refreshButton?.setAttribute("disabled", "true");

	try {
		const refreshedState = await chrome.runtime.sendMessage({ type: "refresh" });
		if (refreshedState.activity.length) {
			renderActivity(refreshedState.activity);
			return;
		}
		setStatus("No websites have been recorded yet.");
		latestElement!.textContent = "Open an http or https website to start monitoring.";
	} catch (error) {
		console.error("Popup live check failed", error);
		setStatus("Could not reach the CyberGuard backend.");
		latestElement!.textContent = "Check that the backend is running on localhost:8000.";
	} finally {
		refreshButton?.removeAttribute("disabled");
	}
}

function renderActivity(activity: WebsiteActivity[]) {
	if (!activity.length) {
		setStatus("No websites have been recorded yet.");
		latestElement!.textContent = "Browse to a website to create live activity.";
		return;
	}

	const [latest] = activity;
	setStatus("Current website checked.");
	latestElement!.innerHTML = `
		<span class="risk risk-${latest.riskLevel.toLowerCase()}">${formatRisk(latest.riskLevel)}</span>
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
