export {};

type RuntimeMessage =
	| { type: "getState" }
	| { type: "setMonitoring"; enabled: boolean }
	| { type: "setAuthToken"; accessToken: string | null }
	| { type: "setHistoryEnabled"; enabled: boolean }
	| { type: "suppressUrl"; url: string }
	| { type: "openDashboard" }
	| { type: "refresh" };

type TabUpdate = { url?: string };
type TabChange = { status?: string };
type StorageValues = Record<string, unknown>;

declare const chrome: {
	runtime: {
		onInstalled: { addListener(listener: () => void): void };
		onMessage: {
			addListener(
				listener: (
					message: RuntimeMessage,
					sender: unknown,
					sendResponse: (response: unknown) => void,
				) => boolean,
			): void;
		};
	};
	tabs: {
		onUpdated: { addListener(listener: (tabId: number, changeInfo: TabChange, tab: TabUpdate) => void): void };
		onActivated: { addListener(listener: () => void): void };
		query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<({ url?: string })[]>;
		create: (createProperties: { url: string }) => Promise<unknown>;
	};
	windows: {
		onFocusChanged: { addListener(listener: (windowId: number) => void): void };
	};
	storage: {
		local: {
			get(keys: string[]): Promise<StorageValues>;
			set(values: StorageValues): Promise<void>;
			remove(keys: string[]): Promise<void>;
		};
	};
	action: {
		setBadgeText(details: { text: string }): Promise<void>;
		setBadgeBackgroundColor(details: { color: string }): Promise<void>;
	};
};

const API_BASE_URL = "http://localhost:8000";
const MONITORING_KEY = "monitoringEnabled";
const ACTIVITY_KEY = "websiteActivity";
const ANALYSIS_CACHE_KEY = "websiteAnalysisCache";
const AUTH_TOKEN_KEY = "supabaseAccessToken";
const HISTORY_ENABLED_KEY = "historyEnabled";
const SUPPRESSED_URL_KEY = "suppressedUrl";
const SUPPRESSED_AT_KEY = "suppressedAt";
const MAX_ACTIVITY_ITEMS = 100;
const DUPLICATE_WINDOW_MS = 10_000;
const ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_TIMEOUT_MS = 12_000;

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

type CachedAnalysis = WebsiteActivity & { cachedAt: string };

chrome.runtime.onInstalled.addListener(async () => {
	const stored = await chrome.storage.local.get([MONITORING_KEY, ACTIVITY_KEY, HISTORY_ENABLED_KEY]);
	if (typeof stored[MONITORING_KEY] !== "boolean") {
		await chrome.storage.local.set({ [MONITORING_KEY]: true });
	}
	if (!Array.isArray(stored[ACTIVITY_KEY])) {
		await chrome.storage.local.set({ [ACTIVITY_KEY]: [] });
	}
	if (typeof stored[HISTORY_ENABLED_KEY] !== "boolean") {
		await chrome.storage.local.set({ [HISTORY_ENABLED_KEY]: false });
	}
	await refreshActiveTab();
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
	if (changeInfo.status !== "complete" || typeof tab.url !== "string") return;
	await recordWebsite(tab.url);
});

chrome.tabs.onActivated.addListener(async () => {
	await refreshActiveTab();
});

chrome.windows.onFocusChanged.addListener(async () => {
	await refreshActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	(async () => {
		if (message.type === "getState") {
			const stored = await chrome.storage.local.get([MONITORING_KEY, ACTIVITY_KEY, HISTORY_ENABLED_KEY, AUTH_TOKEN_KEY]);
			sendResponse({
				monitoringEnabled: stored[MONITORING_KEY] !== false,
				historyEnabled: stored[HISTORY_ENABLED_KEY] === true,
				authenticated: typeof stored[AUTH_TOKEN_KEY] === "string",
				activity: Array.isArray(stored[ACTIVITY_KEY]) ? stored[ACTIVITY_KEY] : [],
			});
			return;
		}

		if (message.type === "refresh") {
			await refreshActiveTab();
			const stored = await chrome.storage.local.get([MONITORING_KEY, ACTIVITY_KEY]);
			sendResponse({
				monitoringEnabled: stored[MONITORING_KEY] !== false,
				activity: Array.isArray(stored[ACTIVITY_KEY]) ? stored[ACTIVITY_KEY] : [],
			});
			return;
		}

		if (message.type === "setMonitoring") {
			await chrome.storage.local.set({ [MONITORING_KEY]: Boolean(message.enabled) });
			sendResponse({ monitoringEnabled: Boolean(message.enabled) });
			return;
		}

		if (message.type === "setHistoryEnabled") {
			await chrome.storage.local.set({ [HISTORY_ENABLED_KEY]: Boolean(message.enabled) });
			if (message.enabled) await refreshActiveTab(true);
			sendResponse({ historyEnabled: Boolean(message.enabled) });
			return;
		}

		if (message.type === "openDashboard") {
			const tabs = await chrome.tabs.query({ active: false, currentWindow: false });
			const dashboardOrigin = tabs
				.map((tab) => tab.url)
				.find((url) => url?.startsWith("http://127.0.0.1:5173"))
				?.split("/").slice(0, 3).join("/")
				?? "http://localhost:5173";
			await chrome.tabs.create({ url: `${dashboardOrigin}/website-tracker?extension=connect` });
			sendResponse({ ok: true });
			return;
		}

		if (message.type === "setAuthToken") {
			if (message.accessToken) {
				await chrome.storage.local.set({ [AUTH_TOKEN_KEY]: message.accessToken });
			} else {
				await chrome.storage.local.remove([AUTH_TOKEN_KEY]);
			}
			sendResponse({ ok: true });
		}

		if (message.type === "suppressUrl") {
			const stored = await chrome.storage.local.get([ACTIVITY_KEY, ANALYSIS_CACHE_KEY]);
			const activity = Array.isArray(stored[ACTIVITY_KEY])
				? (stored[ACTIVITY_KEY] as WebsiteActivity[]).filter((entry) => entry.url !== message.url)
				: [];
			const cache = isAnalysisCache(stored[ANALYSIS_CACHE_KEY])
				? stored[ANALYSIS_CACHE_KEY]
				: {};
			delete cache[message.url];
			await chrome.storage.local.set({
				[SUPPRESSED_URL_KEY]: message.url,
				[SUPPRESSED_AT_KEY]: Date.now(),
				[ACTIVITY_KEY]: activity,
				[ANALYSIS_CACHE_KEY]: cache,
			});
			sendResponse({ ok: true });
		}
	})().catch((error) => {
		console.error("CyberGuard extension message failed", error);
		sendResponse({ error: "Could not update extension state." });
	});
	return true;
});

async function refreshActiveTab(force = false) {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const activeTab = tabs[0];
	if (activeTab?.url) {
		await recordWebsite(activeTab.url, force);
	}
}

async function recordWebsite(url: string, force = false) {
	const parsedUrl = parseWebsiteUrl(url);
	if (!parsedUrl) return;

	const stored = await chrome.storage.local.get([
		MONITORING_KEY,
		ACTIVITY_KEY,
		ANALYSIS_CACHE_KEY,
		AUTH_TOKEN_KEY,
		HISTORY_ENABLED_KEY,
		SUPPRESSED_URL_KEY,
		SUPPRESSED_AT_KEY,
	]);
	if (stored[MONITORING_KEY] === false) return;
	const suppressionAge = typeof stored[SUPPRESSED_AT_KEY] === "number"
		? Date.now() - stored[SUPPRESSED_AT_KEY]
		: Number.POSITIVE_INFINITY;
	if (stored[SUPPRESSED_URL_KEY] === url && suppressionAge < DUPLICATE_WINDOW_MS) return;
	if (typeof stored[SUPPRESSED_URL_KEY] === "string") {
		await chrome.storage.local.remove([SUPPRESSED_URL_KEY, SUPPRESSED_AT_KEY]);
	}

	const activity: WebsiteActivity[] = Array.isArray(stored[ACTIVITY_KEY])
		? stored[ACTIVITY_KEY] as WebsiteActivity[]
		: [];
	const previous = activity[0];
	if (!force && previous?.url === url && Date.now() - Date.parse(previous.visitedAt) < DUPLICATE_WINDOW_MS) {
		return;
	}

	let result: WebsiteActivity = {
		url,
		domain: parsedUrl.hostname,
		visitedAt: new Date().toISOString(),
		riskScore: null,
		riskLevel: "UNABLE_TO_VERIFY",
		threatTypes: [],
		explanation: ["CyberGuard could not reach the analysis backend."],
		source: "UNABLE_TO_VERIFY",
	};
	const analysisCache = isAnalysisCache(stored[ANALYSIS_CACHE_KEY])
		? stored[ANALYSIS_CACHE_KEY]
		: {};
	const cachedResult = analysisCache[url];
	const cachedAt = cachedResult ? Date.parse(cachedResult.cachedAt) : NaN;
	const hasFreshCache = Number.isFinite(cachedAt) && Date.now() - cachedAt < ANALYSIS_CACHE_TTL_MS;

	if (hasFreshCache) {
		result = {
			...cachedResult,
			visitedAt: new Date().toISOString(),
		};
	} else try {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (typeof stored[AUTH_TOKEN_KEY] === "string") {
			headers.Authorization = `Bearer ${stored[AUTH_TOKEN_KEY]}`;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
		const response = await fetch(`${API_BASE_URL}/api/websites/analyze`, {
			method: "POST",
			headers,
			body: JSON.stringify({ url }),
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!response.ok) {
			const detail = await response.text();
			if (response.status === 401) {
				await chrome.storage.local.remove([AUTH_TOKEN_KEY]);
			}
			throw new Error(`Backend returned ${response.status}: ${detail.slice(0, 240)}`);
		}
		const analysis = await response.json();
		result = {
			url: analysis.url,
			domain: analysis.domain,
			visitedAt: result.visitedAt,
			riskScore: analysis.risk_score,
			riskLevel: analysis.risk_level,
			threatTypes: analysis.threat_types,
			explanation: analysis.explanation,
			source: analysis.source,
		};
		analysisCache[url] = { ...result, cachedAt: new Date().toISOString() };
		await chrome.storage.local.set({ [ANALYSIS_CACHE_KEY]: analysisCache });

	} catch (error) {
		console.error("CyberGuard website analysis failed", error);
	}

	await chrome.storage.local.set({
		[ACTIVITY_KEY]: [result, ...activity].slice(0, MAX_ACTIVITY_ITEMS),
	});
	await updateBadge(result.riskLevel);
}

function isAnalysisCache(value: unknown): value is Record<string, CachedAnalysis> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWebsiteUrl(url: string): URL | null {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") {
			return null;
		}
		return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
			? parsedUrl
			: null;
	} catch {
		return null;
	}
}

async function updateBadge(riskLevel: string) {
	const badge = riskLevel === "HIGH_RISK"
		? "!"
		: riskLevel === "SUSPICIOUS"
			? "?"
			: "";
	await chrome.action.setBadgeText({ text: badge });
	if (badge) {
		await chrome.action.setBadgeBackgroundColor({
			color: riskLevel === "HIGH_RISK" ? "#b42318" : "#b54708",
		});
	}
}
