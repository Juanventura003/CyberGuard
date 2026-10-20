import {
	ORGANIZATION_RULE_START,
	getOrganizationBlockInfo,
	handleProtection,
	startProtection,
	withRuleLock,
	type ProtectionMessage,
} from "./organization-protection.js";
import { RedirectTracker, type NavigationRequest } from "./redirect-tracker.js";

const redirects = new RedirectTracker();
const REDIRECT_SESSION_KEY = "redirectContext";
let redirectQueue = chrome.storage.session
	.get([REDIRECT_SESSION_KEY])
	.then((stored) => redirects.restore(stored[REDIRECT_SESSION_KEY]))
	.catch(() =>
		console.error("CyberGuard redirect context could not be restored"),
	);

function trackRedirect(change: () => void) {
	const next = redirectQueue.then(async () => {
		change();
		await chrome.storage.session.set({
			[REDIRECT_SESSION_KEY]: redirects.snapshot(),
		});
	});
	redirectQueue = next.catch(() =>
		console.error("CyberGuard redirect context could not be saved"),
	);
}

type RuntimeMessage =
	| ProtectionMessage
	| { type: "organizationBlockInfo"; domain: string }
	| { type: "getState" }
	| { type: "getBlockedSites" }
	| { type: "setSiteBlocked"; domain: string; blocked: boolean }
	| { type: "getPageAnalysis"; page?: PageSignals }
	| { type: "setBanner"; enabled: boolean }
	| { type: "setMonitoring"; enabled: boolean }
	| { type: "setAuthToken"; accessToken: string | null }
	| { type: "setHistoryEnabled"; enabled: boolean }
	| { type: "suppressUrl"; url: string }
	| { type: "clearHistory" }
	| { type: "openDashboard" }
	| { type: "refresh" };

type PageSignals = {
	brands: string[];
	password_forms: {
		action_origin: string;
		method: "get" | "post" | "other";
	}[];
	password_without_form: boolean;
	recovery_secret_fields: number;
	misleading_links: {
		displayed_host: string;
		destination_host: string;
		in_password_form: boolean;
	}[];
};

type TabUpdate = { url?: string };
type TabChange = { status?: string; url?: string };
type StorageValues = Record<string, unknown>;

type BlockRule = {
	id: number;
	priority: number;
	action: { type: "block" };
	condition: { requestDomains: string[]; resourceTypes: ["main_frame"] };
};

declare const chrome: {
	webNavigation: {
		onCommitted: {
			addListener(
				callback: (event: {
					tabId: number;
					frameId: number;
					url: string;
					transitionQualifiers: string[];
				}) => void,
			): void;
		};
	};

	webRequest: {
		onBeforeRequest: {
			addListener(
				callback: (event: NavigationRequest) => void,
				filter: { urls: string[]; types: string[] },
			): void;
		};
		onBeforeRedirect: {
			addListener(
				callback: (event: NavigationRequest) => void,
				filter: { urls: string[]; types: string[] },
			): void;
		};
		onCompleted: {
			addListener(
				callback: (event: NavigationRequest) => void,
				filter: { urls: string[]; types: string[] },
			): void;
		};
	};

	declarativeNetRequest: {
		getDynamicRules(): Promise<BlockRule[]>;
		updateDynamicRules(options: {
			removeRuleIds: number[];
			addRules: BlockRule[];
		}): Promise<void>;
	};
	runtime: {
		getURL(path: string): string;
		onInstalled: { addListener(listener: () => void): void };
		onMessage: {
			addListener(
				listener: (
					message: RuntimeMessage,
					sender: {
						url?: string;
						tab?: { id?: number; url?: string };
					},
					sendResponse: (response: unknown) => void,
				) => boolean,
			): void;
		};
	};
	tabs: {
		onRemoved: { addListener(callback: (tabId: number) => void): void };
		onUpdated: {
			addListener(
				listener: (
					tabId: number,
					changeInfo: TabChange,
					tab: TabUpdate,
				) => void,
			): void;
		};
		onActivated: { addListener(listener: () => void): void };
		query: (queryInfo: {
			active: boolean;
			lastFocusedWindow?: boolean;
			currentWindow?: boolean;
		}) => Promise<{ id?: number; url?: string }[]>;
		create: (createProperties: { url: string }) => Promise<unknown>;
	};
	windows: {
		getLastFocused(): Promise<{ focused: boolean }>;
		onFocusChanged: {
			addListener(listener: (windowId: number) => void): void;
		};
	};
	storage: {
		session: {
			get(keys: string[]): Promise<StorageValues>;
			set(values: StorageValues): Promise<void>;
		};
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

const API_BASE_URL = "http://127.0.0.1:8000";
const BANNER_KEY = "bannerEnabled";
const MONITORING_KEY = "monitoringEnabled";
const ACTIVITY_KEY = "websiteActivity";
const ANALYSIS_CACHE_KEY = "websiteAnalysisCache";
const AUTH_TOKEN_KEY = "supabaseAccessToken";
const HISTORY_ENABLED_KEY = "historyEnabled";
const SUPPRESSED_URL_KEY = "suppressedUrl";
const SUPPRESSED_AT_KEY = "suppressedAt";
const MAX_ACTIVITY_ITEMS = 100;
const DUPLICATE_WINDOW_MS = 10_000;
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ANALYSIS_CACHE_ITEMS = 100;
const ANALYSIS_TIMEOUT_MS = 12_000;
const inFlightRecords = new Map<string, Promise<void>>();
let storageQueue: Promise<unknown> = Promise.resolve();
let historyGeneration = 0;
let historyWrites: Promise<unknown> = Promise.resolve();

function updateStorage<T>(task: () => Promise<T>): Promise<T> {
	const next = storageQueue.then(task, task);
	storageQueue = next.catch(() => undefined);
	return next;
}

async function storeActivity(result: WebsiteActivity) {
	await updateStorage(async () => {
		const stored = await chrome.storage.local.get([ACTIVITY_KEY]);
		const activity = Array.isArray(stored[ACTIVITY_KEY])
			? (stored[ACTIVITY_KEY] as WebsiteActivity[])
			: [];
		await chrome.storage.local.set({
			[ACTIVITY_KEY]: [
				result,
				...activity.filter((item) => item.url !== result.url),
			].slice(0, MAX_ACTIVITY_ITEMS),
		});
	});
}

type WebsiteActivity = {
	url: string;
	domain: string;
	visitedAt: string;
	riskScore: number | null;
	riskLevel: string;
	pageWarning?: boolean;
	pageAnalysis?: { riskScore: number; explanation: string[] };
	historyId?: string;
	threatTypes: string[];
	explanation: string[];
	source: string;
};

type CachedAnalysis = WebsiteActivity & { cachedAt: string };

chrome.runtime.onInstalled.addListener(async () => {
	await ensureStorageDefaults();
	await refreshActiveTab(false, false);
});

void ensureStorageDefaults();

const navigationFilter = {
	urls: ["http://*/*", "https://*/*"],
	types: ["main_frame"],
};
chrome.webRequest.onBeforeRequest.addListener(
	(event) => trackRedirect(() => redirects.start(event)),
	navigationFilter,
);
chrome.webRequest.onBeforeRedirect.addListener(
	(event) => trackRedirect(() => redirects.redirect(event)),
	navigationFilter,
);
chrome.webNavigation.onCommitted.addListener((event) => {
	if (event.frameId !== 0 || !parseWebsiteUrl(event.url)) return;
	trackRedirect(() =>
		redirects.commit(
			event.tabId,
			event.url,
			event.transitionQualifiers.includes("client_redirect"),
		),
	);
});
chrome.tabs.onRemoved.addListener((tabId) =>
	trackRedirect(() => redirects.remove(tabId)),
);
chrome.webRequest.onCompleted.addListener((event) => {
	void annotateRedirect(event).catch((error) =>
		console.error("CyberGuard redirect analysis failed", error),
	);
}, navigationFilter);

function withRedirectNote(result: WebsiteActivity, tabId: number) {
	const note = redirects.note(tabId, result.url);
	return note
		? {
				...result,
				explanation: [
					...result.explanation.filter(
						(reason) => !reason.startsWith("Chrome observed "),
					),
					note,
				],
			}
		: result;
}

async function annotateRedirect(event: NavigationRequest) {
	const generation = historyGeneration;
	await redirectQueue;
	if (!redirects.note(event.tabId, event.url)) return;
	if (!(await isForegroundTab(event.tabId))) return;
	await recordWebsite(event.url);
	const stored = await chrome.storage.local.get([
		ACTIVITY_KEY,
		MONITORING_KEY,
		HISTORY_ENABLED_KEY,
		AUTH_TOKEN_KEY,
	]);
	if (stored[MONITORING_KEY] === false) return;
	const activity = Array.isArray(stored[ACTIVITY_KEY])
		? (stored[ACTIVITY_KEY] as WebsiteActivity[])
		: [];
	const result = activity.find((item) => item.url === event.url);
	if (!result) return;
	const updated = withRedirectNote(result, event.tabId);
	if (
		updated.historyId &&
		stored[HISTORY_ENABLED_KEY] === true &&
		typeof stored[AUTH_TOKEN_KEY] === "string"
	)
		await saveWebsiteHistory(updated, stored[AUTH_TOKEN_KEY], generation);
	if (generation !== historyGeneration) return;
	await updateStorage(async () => {
		const latest = await chrome.storage.local.get([ACTIVITY_KEY]);
		const items = Array.isArray(latest[ACTIVITY_KEY])
			? (latest[ACTIVITY_KEY] as WebsiteActivity[])
			: [];
		await chrome.storage.local.set({
			[ACTIVITY_KEY]: items.map((item) =>
				item.url === event.url ? withRedirectNote(item, event.tabId) : item,
			),
		});
	});
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	if (changeInfo.status !== "complete" && !changeInfo.url) return;
	if (typeof tab.url !== "string") return;
	if (!(await isForegroundTab(tabId))) return;
	await recordWebsite(tab.url);
});

chrome.tabs.onActivated.addListener(async () => {
	await refreshActiveTab();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
	if (windowId < 0) return;
	await refreshActiveTab();
});

startProtection();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	(async () => {
		if (message.type === "organizationBlockInfo") {
			const source = new URL(_sender.url ?? "https://invalid.example");
			const expected = new URL(chrome.runtime.getURL("blocked.html"));
			if (
				source.protocol !== expected.protocol ||
				source.host !== expected.host ||
				source.pathname !== "/blocked.html" ||
				source.searchParams.get("domain") !== message.domain
			)
				throw new Error("Untrusted blocked-page request.");
			sendResponse(await getOrganizationBlockInfo(message.domain));
			return;
		}
		if (message.type === "organizationProtection") {
			const origin = new URL(
				_sender.url ?? _sender.tab?.url ?? "https://invalid.example",
			).origin;
			if (!["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin))
				throw new Error("Untrusted organization request.");
			sendResponse(await handleProtection(message));
			return;
		}
		if (message.type === "getBlockedSites") {
			const rules = await chrome.declarativeNetRequest.getDynamicRules();
			const stored = await chrome.storage.local.get([MONITORING_KEY]);
			sendResponse({
				monitoringEnabled: stored[MONITORING_KEY] !== false,
				domains: rules
					.filter((rule) => rule.id < ORGANIZATION_RULE_START)
					.flatMap((rule) => rule.condition.requestDomains ?? []),
				organizationDomains: [
					...new Set(
						rules
							.filter((rule) => rule.id >= ORGANIZATION_RULE_START)
							.flatMap((rule) => rule.condition.requestDomains ?? []),
					),
				],
			});
			return;
		}
		if (message.type === "setSiteBlocked") {
			// Only the extension popup can change blocking rules, never website scripts.
			if (_sender.tab) {
				const origin = new URL(_sender.url ?? _sender.tab.url ?? "").origin;
				if (
					!["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin)
				)
					throw new Error("Untrusted blocking request.");
			}
			await setSiteBlocked(message.domain, message.blocked);
			sendResponse({ ok: true });
			return;
		}
		if (message.type === "getPageAnalysis") {
			if (
				_sender.tab?.id === undefined ||
				!(await isForegroundTab(_sender.tab.id))
			) {
				sendResponse({ result: null });
				return;
			}
			const generation = historyGeneration;
			await redirectQueue;
			const url = _sender.tab?.url;
			if (!url || !parseWebsiteUrl(url)) {
				sendResponse({ result: null });
				return;
			}
			// Background banner refreshes analyze pages but never create a saved visit.
			await recordWebsite(url, false, false);
			const stored = await chrome.storage.local.get([
				ACTIVITY_KEY,
				MONITORING_KEY,
				ANALYSIS_CACHE_KEY,
				HISTORY_ENABLED_KEY,
				AUTH_TOKEN_KEY,
			]);
			if (stored[MONITORING_KEY] === false) {
				sendResponse({ result: null });
				return;
			}
			const activity = Array.isArray(stored[ACTIVITY_KEY])
				? (stored[ACTIVITY_KEY] as WebsiteActivity[])
				: [];
			const cache = isAnalysisCache(stored[ANALYSIS_CACHE_KEY])
				? stored[ANALYSIS_CACHE_KEY]
				: {};
			let result: WebsiteActivity | null =
				cache[url] ?? activity.find((item) => item.url === url) ?? null;
			const visit = activity.find((item) => item.url === url);
			if (result && visit)
				result = {
					...result,
					visitedAt: visit.visitedAt,
					historyId: visit.historyId,
				};
			if (result && message.page && stored[MONITORING_KEY] !== false) {
				try {
					const response = await fetch(
						`${API_BASE_URL}/api/websites/page-signals`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ url, page: message.page }),
							signal: AbortSignal.timeout(5000),
						},
					);
					if (!response.ok) throw new Error("Page check unavailable");
					const signals = await response.json();
					const score = Math.max(result.riskScore ?? 0, signals.risk_score);
					result = {
						...result,
						pageAnalysis: {
							riskScore: signals.risk_score,
							explanation: signals.explanation,
						},
						riskScore: score,
						pageWarning: signals.risk_score >= 35,
						riskLevel:
							result.riskLevel === "HIGH_RISK"
								? "HIGH_RISK"
								: score >= 35
									? "SUSPICIOUS"
									: result.riskLevel,
						explanation: [
							...signals.explanation,
							...result.explanation.filter(
								(reason) =>
									signals.risk_score < 35 ||
									reason !==
										"No known threat or strong URL warning was detected.",
							),
						],
					};
				} catch {
					result = {
						...result,
						riskLevel: ["HIGH_RISK", "SUSPICIOUS"].includes(result.riskLevel)
							? result.riskLevel
							: "UNABLE_TO_VERIFY",
						explanation: [
							"Page analysis could not be completed.",
							...result.explanation,
						],
					};
				}
				result = withRedirectNote(result, _sender.tab?.id ?? -1);
				if (
					visit?.historyId &&
					generation === historyGeneration &&
					stored[HISTORY_ENABLED_KEY] === true &&
					typeof stored[AUTH_TOKEN_KEY] === "string" &&
					result.riskScore !== null
				) {
					const historyId = await saveWebsiteHistory(
						result,
						stored[AUTH_TOKEN_KEY],
						generation,
					);
					if (historyId) result = { ...result, historyId };
				}
				await updateBadge(result.riskLevel);
				if (visit && generation === historyGeneration)
					await storeActivity(result);
			}
			if (result) result = withRedirectNote(result, _sender.tab?.id ?? -1);
			sendResponse({ result });
			return;
		}
		if (message.type === "getState") {
			await ensureStorageDefaults();
			const stored = await chrome.storage.local.get([
				MONITORING_KEY,
				ACTIVITY_KEY,
				HISTORY_ENABLED_KEY,
				AUTH_TOKEN_KEY,
				BANNER_KEY,
			]);
			sendResponse({
				monitoringEnabled: stored[MONITORING_KEY] !== false,
				historyEnabled: stored[HISTORY_ENABLED_KEY] === true,
				bannerEnabled: stored[BANNER_KEY] === true,
				authenticated: typeof stored[AUTH_TOKEN_KEY] === "string",
				activity: Array.isArray(stored[ACTIVITY_KEY])
					? stored[ACTIVITY_KEY]
					: [],
			});
			return;
		}

		if (message.type === "refresh") {
			await refreshActiveTab(true);
			const stored = await chrome.storage.local.get([
				MONITORING_KEY,
				ACTIVITY_KEY,
			]);
			sendResponse({
				monitoringEnabled: stored[MONITORING_KEY] !== false,
				activity: Array.isArray(stored[ACTIVITY_KEY])
					? stored[ACTIVITY_KEY]
					: [],
			});
			return;
		}

		if (message.type === "setBanner") {
			await chrome.storage.local.set({
				[BANNER_KEY]: Boolean(message.enabled),
			});
			sendResponse({ bannerEnabled: Boolean(message.enabled) });
			return;
		}

		if (message.type === "setMonitoring") {
			await chrome.storage.local.set({
				[MONITORING_KEY]: Boolean(message.enabled),
			});
			sendResponse({ monitoringEnabled: Boolean(message.enabled) });
			return;
		}

		if (message.type === "setHistoryEnabled") {
			await chrome.storage.local.set({
				[HISTORY_ENABLED_KEY]: Boolean(message.enabled),
			});
			if (message.enabled) await refreshActiveTab(true);
			sendResponse({ historyEnabled: Boolean(message.enabled) });
			return;
		}

		if (message.type === "openDashboard") {
			const tabs = await chrome.tabs.query({
				active: false,
				currentWindow: false,
			});
			const dashboardOrigin =
				tabs
					.map((tab) => tab.url)
					.find((url) => url?.startsWith("http://127.0.0.1:5173"))
					?.split("/")
					.slice(0, 3)
					.join("/") ?? "http://localhost:5173";
			await chrome.tabs.create({
				url: `${dashboardOrigin}/website-tracker?extension=connect`,
			});
			sendResponse({ ok: true });
			return;
		}

		if (message.type === "setAuthToken") {
			if (message.accessToken) {
				await chrome.storage.local.set({
					[AUTH_TOKEN_KEY]: message.accessToken,
				});
			} else {
				await chrome.storage.local.remove([AUTH_TOKEN_KEY]);
			}
			sendResponse({ ok: true });
		}

		if (message.type === "suppressUrl") {
			historyGeneration++;
			await historyWrites;
			await updateStorage(async () => {
				const stored = await chrome.storage.local.get([
					ACTIVITY_KEY,
					ANALYSIS_CACHE_KEY,
				]);
				const activity = Array.isArray(stored[ACTIVITY_KEY])
					? (stored[ACTIVITY_KEY] as WebsiteActivity[]).filter(
							(entry) => entry.url !== message.url,
						)
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
			});
			sendResponse({ ok: true });
			return;
		}

		if (message.type === "clearHistory") {
			historyGeneration++;
			await historyWrites;
			await updateStorage(async () => {
				await chrome.storage.local.set({
					[ACTIVITY_KEY]: [],
					[ANALYSIS_CACHE_KEY]: {},
				});
				await chrome.storage.local.remove([
					SUPPRESSED_URL_KEY,
					SUPPRESSED_AT_KEY,
				]);
			});
			sendResponse({ ok: true });
		}
	})().catch((error) => {
		console.error("CyberGuard extension message failed", error);
		sendResponse({
			error:
				message.type === "organizationProtection" && error instanceof Error
					? error.message
					: "Could not update extension state.",
		});
	});
	return true;
});

async function isForegroundTab(tabId: number): Promise<boolean> {
	if (!(await chrome.windows.getLastFocused()).focused) return false;
	const tabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});
	return tabs[0]?.id === tabId;
}

async function refreshActiveTab(force = false, saveVisit = true) {
	if (!(await chrome.windows.getLastFocused()).focused) return;
	const tabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});
	const activeTab = tabs[0];
	if (activeTab?.url) {
		await recordWebsite(activeTab.url, force, saveVisit);
	}
}

async function ensureStorageDefaults() {
	await updateStorage(async () => {
		const stored = await chrome.storage.local.get([
			MONITORING_KEY,
			ACTIVITY_KEY,
			HISTORY_ENABLED_KEY,
			ANALYSIS_CACHE_KEY,
		]);
		const defaults: StorageValues = {};
		const cache = pruneAnalysisCache(stored[ANALYSIS_CACHE_KEY]);
		if (
			!isAnalysisCache(stored[ANALYSIS_CACHE_KEY]) ||
			Object.keys(cache).length !==
				Object.keys(stored[ANALYSIS_CACHE_KEY]).length
		)
			defaults[ANALYSIS_CACHE_KEY] = cache;
		if (typeof stored[MONITORING_KEY] !== "boolean")
			defaults[MONITORING_KEY] = true;
		if (!Array.isArray(stored[ACTIVITY_KEY])) defaults[ACTIVITY_KEY] = [];
		if (typeof stored[HISTORY_ENABLED_KEY] !== "boolean")
			defaults[HISTORY_ENABLED_KEY] = false;
		if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
	});
}

async function recordWebsite(url: string, force = false, saveVisit = true) {
	const key = `${saveVisit ? "visit" : "analysis"}:${url}`;
	const existingRequest = inFlightRecords.get(key);
	if (existingRequest) {
		await existingRequest;
		return;
	}

	const request = recordWebsiteInternal(url, force, saveVisit);
	inFlightRecords.set(key, request);
	try {
		await request;
	} finally {
		if (inFlightRecords.get(key) === request) {
			inFlightRecords.delete(key);
		}
	}
}

async function recordWebsiteInternal(
	url: string,
	force = false,
	saveVisit = true,
) {
	const generation = historyGeneration;
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
	const suppressionAge =
		typeof stored[SUPPRESSED_AT_KEY] === "number"
			? Date.now() - stored[SUPPRESSED_AT_KEY]
			: Number.POSITIVE_INFINITY;
	if (
		stored[SUPPRESSED_URL_KEY] === url &&
		suppressionAge < DUPLICATE_WINDOW_MS
	)
		return;
	if (typeof stored[SUPPRESSED_URL_KEY] === "string") {
		await chrome.storage.local.remove([SUPPRESSED_URL_KEY, SUPPRESSED_AT_KEY]);
	}

	const activity: WebsiteActivity[] = Array.isArray(stored[ACTIVITY_KEY])
		? (stored[ACTIVITY_KEY] as WebsiteActivity[])
		: [];
	const previous = activity[0];
	if (
		!force &&
		previous?.url === url &&
		Date.now() - Date.parse(previous.visitedAt) < DUPLICATE_WINDOW_MS
	) {
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
	const analysisCache = pruneAnalysisCache(stored[ANALYSIS_CACHE_KEY]);
	const cachedResult = analysisCache[url];
	const cachedAt = cachedResult ? Date.parse(cachedResult.cachedAt) : NaN;
	const hasFreshCache =
		!force &&
		Number.isFinite(cachedAt) &&
		Date.now() - cachedAt < ANALYSIS_CACHE_TTL_MS;

	if (hasFreshCache) {
		result = {
			...cachedResult,
			visitedAt: new Date().toISOString(),
		};
	} else
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

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
				throw new Error(
					`Backend returned ${response.status}: ${detail.slice(0, 240)}`,
				);
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
			const freshAnalysis = {
				...result,
				cachedAt: new Date().toISOString(),
			};
			await updateStorage(async () => {
				if (generation !== historyGeneration) return;
				const latest = await chrome.storage.local.get([ANALYSIS_CACHE_KEY]);
				const cache = pruneAnalysisCache(latest[ANALYSIS_CACHE_KEY]);
				cache[url] = freshAnalysis;
				await chrome.storage.local.set({
					[ANALYSIS_CACHE_KEY]: pruneAnalysisCache(cache),
				});
			});
		} catch (error) {
			console.error("CyberGuard website analysis failed", error);
		}

	const currentVisit = activity.find((item) => item.url === url);
	if (currentVisit && (force || hasFreshCache)) {
		result.historyId = currentVisit.historyId;
		if (force) {
			result.visitedAt = currentVisit.visitedAt;
			const page =
				currentVisit.pageAnalysis ??
				(currentVisit.pageWarning
					? {
							riskScore: currentVisit.riskScore ?? 35,
							explanation: currentVisit.explanation,
						}
					: undefined);
			if (page) {
				result.pageAnalysis = page;
				result.pageWarning = page.riskScore >= 35;
				result.riskScore = Math.max(result.riskScore ?? 0, page.riskScore);
				if (result.riskLevel !== "HIGH_RISK" && result.riskScore >= 35)
					result.riskLevel = "SUSPICIOUS";
				result.explanation = [
					...new Set([
						...page.explanation,
						...result.explanation.filter(
							(reason) =>
								!result.pageWarning ||
								reason !==
									"No known threat or strong URL warning was detected.",
						),
					]),
				];
			}
		}
	}
	if (generation !== historyGeneration) return;
	if (saveVisit) await storeActivity(result);
	if (
		saveVisit &&
		(!hasFreshCache || !currentVisit?.historyId) &&
		stored[HISTORY_ENABLED_KEY] === true &&
		typeof stored[AUTH_TOKEN_KEY] === "string" &&
		result.riskScore !== null
	) {
		const historyId = await saveWebsiteHistory(
			result,
			stored[AUTH_TOKEN_KEY],
			generation,
		);
		if (historyId && generation === historyGeneration) {
			result = { ...result, historyId };
			await storeActivity(result);
		}
	}
	await updateBadge(result.riskLevel);
}

function saveWebsiteHistory(
	result: WebsiteActivity,
	accessToken: string,
	generation: number,
) {
	const pending = historyWrites.then(() =>
		generation === historyGeneration
			? writeWebsiteHistory(result, accessToken)
			: undefined,
	);
	historyWrites = pending.catch(() => undefined);
	return pending;
}

async function writeWebsiteHistory(
	result: WebsiteActivity,
	accessToken: string,
) {
	try {
		const response = await fetch(
			`${API_BASE_URL}/api/websites/history${result.historyId ? `/${encodeURIComponent(result.historyId)}` : ""}`,
			{
				method: result.historyId ? "PATCH" : "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${accessToken}`,
				},
				signal: AbortSignal.timeout(15000),
				body: JSON.stringify({
					url: result.url,
					domain: result.domain,
					risk_score: result.riskScore,
					risk_level: result.riskLevel,
					source: result.source,
					threat_types: result.threatTypes,
					explanation: result.explanation,
				}),
			},
		);
		if (response.status === 401) {
			await chrome.storage.local.remove([AUTH_TOKEN_KEY]);
		}
		if (!response.ok) {
			throw new Error(`History save returned ${response.status}`);
		}
		const entry = await response.json();
		return typeof entry.id === "string" ? entry.id : undefined;
	} catch (error) {
		console.error("CyberGuard website history save failed", error);
	}
}

function isAnalysisCache(
	value: unknown,
): value is Record<string, CachedAnalysis> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pruneAnalysisCache(value: unknown): Record<string, CachedAnalysis> {
	if (!isAnalysisCache(value)) return {};
	const now = Date.now();
	return Object.fromEntries(
		Object.entries(value)
			.filter(([url, result]) => {
				if (!result || result.url !== url) return false;
				const age = now - Date.parse(result.cachedAt);
				return Number.isFinite(age) && age >= 0 && age < ANALYSIS_CACHE_TTL_MS;
			})
			.sort(([, a], [, b]) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt))
			.slice(0, MAX_ANALYSIS_CACHE_ITEMS),
	);
}

function parseWebsiteUrl(url: string): URL | null {
	try {
		const parsedUrl = new URL(url);
		if (
			parsedUrl.hostname === "localhost" ||
			parsedUrl.hostname === "127.0.0.1"
		) {
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
	const badge =
		riskLevel === "HIGH_RISK" ? "!" : riskLevel === "SUSPICIOUS" ? "?" : "";
	await chrome.action.setBadgeText({ text: badge });
	if (badge) {
		await chrome.action.setBadgeBackgroundColor({
			color: riskLevel === "HIGH_RISK" ? "#b42318" : "#b54708",
		});
	}
}

function setSiteBlocked(domain: string, blocked: boolean) {
	return withRuleLock(async () => {
		const host = domain.toLowerCase().replace(/\.$/, "");
		if (
			host.length > 253 ||
			!/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
			host.includes("..")
		)
			throw new Error("Invalid hostname");
		const rules = await chrome.declarativeNetRequest.getDynamicRules();
		const existing = rules.filter(
			(rule) =>
				rule.id < ORGANIZATION_RULE_START &&
				rule.condition.requestDomains?.includes(host),
		);
		if (blocked && existing.length) return;
		const used = new Set(rules.map((rule) => rule.id));
		let id = 1;
		while (used.has(id)) id++;
		if (id >= ORGANIZATION_RULE_START)
			throw new Error("Personal rule limit reached.");
		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: blocked ? [] : existing.map((rule) => rule.id),
			addRules: blocked
				? [
						{
							id,
							priority: 1,
							action: { type: "block" },
							condition: {
								requestDomains: [host],
								resourceTypes: ["main_frame"],
							},
						},
					]
				: [],
		});
	});
}
