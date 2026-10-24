import {
	activeApproval,
	evaluateNavigation,
	matchesDomain,
	type TemporaryAccess,
	type WebsitePolicy,
} from "./organization-policy.js";

// Organization rules occupy a reserved range; personal rules are never removed here.
export const ORGANIZATION_RULE_START = 1_000_000;
const KEY = "organizationProtection";
const EXPIRY_ALARM = "organization-access-expiry";
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const API = "http://127.0.0.1:8000/api/protection";
type Rule = {
	id: number;
	priority: number;
	action: {
		type: "block" | "redirect";
		redirect?: { url?: string; regexSubstitution?: string };
	};
	condition: {
		requestDomains: string[];
		resourceTypes: ["main_frame"];
		requestMethods?: string[];
		excludedRequestMethods?: string[];
		regexFilter?: string;
		excludedInitiatorDomains?: string[];
	};
};
type Enrollment = {
	id: string;
	token: string;
	organizationId: string;
	organizationName: string;
	userId: string;
	name: string;
	revision: number;
	domains: string[];
	policies?: WebsitePolicy[];
	approvals?: TemporaryAccess[];
	lastSync?: string;
	error?: string;
};
export type ProtectionMessage = {
	type: "organizationProtection";
	action: "status" | "enroll" | "sync" | "disconnect";
	organizationId?: string;
	organizationName?: string;
	name?: string;
	userId?: string;
	accessToken?: string;
};
declare const chrome: {
	storage: {
		local: {
			get(keys: string[]): Promise<Record<string, unknown>>;
			set(values: Record<string, unknown>): Promise<void>;
			remove(keys: string[]): Promise<void>;
		};
	};
	declarativeNetRequest: {
		getDynamicRules(): Promise<Rule[]>;
		updateDynamicRules(options: {
			removeRuleIds: number[];
			addRules: Rule[];
		}): Promise<void>;
	};
	runtime: {
		getURL(path: string): string;
		getManifest(): { version: string };
		onStartup: { addListener(callback: () => void): void };
	};
	tabs: {
		query(
			options: Record<string, unknown>,
		): Promise<{ id?: number; url?: string }[]>;
		update(id: number, options: { url: string }): Promise<unknown>;
	};
	webNavigation: {
		onBeforeNavigate: {
			addListener(callback: (event: { frameId: number }) => void): void;
		};
	};
	alarms: {
		create(
			name: string,
			options: { periodInMinutes?: number; when?: number },
		): Promise<void>;
		clear?(name: string): Promise<boolean>;
		onAlarm: { addListener(callback: (alarm: { name: string }) => void): void };
	};
};
let rulesQueue: Promise<unknown> = Promise.resolve();
export function withRuleLock<T>(task: () => Promise<T>): Promise<T> {
	const next = rulesQueue.then(task, task);
	rulesQueue = next.catch(() => undefined);
	return next;
}
let protectionQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
	const next = protectionQueue.then(task, task);
	protectionQueue = next.catch(() => undefined);
	return next;
}
async function read(): Promise<Enrollment | undefined> {
	const stored = await chrome.storage.local.get([KEY]);
	return stored[KEY] as Enrollment | undefined;
}
async function post(path: string, body: unknown, token?: string) {
	const response = await fetch(`${API}/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		const detail =
			typeof body.detail === "string"
				? body.detail
				: `Protection request failed (HTTP ${response.status}).`;
		throw new Error(
			`${detail} Previously applied rules, if any, remain active.`,
		);
	}
	return response.json();
}
function validateDomains(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length > 500 ||
		!value.every(
			(host) =>
				typeof host === "string" &&
				host.length <= 253 &&
				/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(
					host,
				),
		)
	)
		throw new Error("Invalid organization rules received.");
	return [...new Set(value as string[])].sort();
}
function validatePolicySnapshot(
	snapshot: Record<string, unknown>,
	domains: string[],
): { policies?: WebsitePolicy[]; approvals: TemporaryAccess[] } {
	if (snapshot.rules === undefined) {
		if (snapshot.approvals !== undefined)
			throw new Error("Approvals require a website policy snapshot.");
		return { approvals: [] }; // Older backend: retain block-only behavior.
	}
	if (
		!Array.isArray(snapshot.rules) ||
		snapshot.rules.length !== domains.length
	)
		throw new Error("Invalid organization policies received.");
	const policies: WebsitePolicy[] = snapshot.rules.map((rule) => {
		if (
			!rule ||
			!domains.includes(rule.domain) ||
			!["warn", "block"].includes(rule.action) ||
			typeof rule.reason !== "string" ||
			!rule.reason.trim() ||
			rule.reason.length > 1000
		)
			throw new Error("Invalid organization policies received.");
		return { domain: rule.domain, action: rule.action, reason: rule.reason };
	});
	if (new Set(policies.map((rule) => rule.domain)).size !== domains.length)
		throw new Error("Duplicate organization policies received.");
	if (!Array.isArray(snapshot.approvals) || snapshot.approvals.length > 500)
		throw new Error("Invalid temporary approvals received.");
	const approvals: TemporaryAccess[] = snapshot.approvals.map((approval) => {
		if (
			!approval ||
			!policies.some(
				(rule) => rule.domain === approval.domain && rule.action === "block",
			) ||
			typeof approval.expires_at !== "string" ||
			!Number.isFinite(Date.parse(approval.expires_at))
		)
			throw new Error("Invalid temporary approvals received.");
		return { domain: approval.domain, expires_at: approval.expires_at };
	});
	if (
		new Set(approvals.map((approval) => approval.domain)).size !==
		approvals.length
	)
		throw new Error("Duplicate temporary approvals received.");
	return { policies, approvals };
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}
async function replaceRulesUnlocked(
	domains: string[],
	policies?: WebsitePolicy[],
	approvals: TemporaryAccess[] = [],
	continuationHost?: string,
) {
	const installed = (await chrome.declarativeNetRequest.getDynamicRules())
		.filter((rule) => rule.id >= ORGANIZATION_RULE_START)
		.sort((a, b) => a.id - b.id);
	const extensionHost = new URL(chrome.runtime.getURL("blocked.html")).host;
	const desired: Rule[] = domains
		.flatMap((domain, index): Rule[] => {
			const policy = policies?.find((rule) => rule.domain === domain);
			// Lift only this organization's rule. Never install an allow rule that
			// could override a personal block or another matching organization rule.
			if (policy?.action === "block" && activeApproval(domain, approvals))
				return [];
			const notice =
				chrome.runtime.getURL("blocked.html") +
				"?domain=" +
				encodeURIComponent(domain);
			const mayContinue =
				continuationHost &&
				matchesDomain(continuationHost, domain) &&
				policy?.action === "warn";
			const redirect: Rule = {
				id: ORGANIZATION_RULE_START + index,
				priority: 3,
				action: {
					type: "redirect",
					redirect: policies
						? { regexSubstitution: notice + "#\\0" }
						: { url: notice },
				},
				condition: {
					requestDomains: [domain],
					resourceTypes: ["main_frame"],
					requestMethods: ["get"],
					...(policies ? { regexFilter: "^https?://.*" } : {}),
					// The checked interstitial initiates a continuation. No allow rule
					// is installed: personal blocks and other team blocks still apply.
					...(policies && mayContinue
						? { excludedInitiatorDomains: [extensionHost] }
						: {}),
				},
			};
			if (policy?.action === "warn") return [redirect];
			return [
				redirect,
				{
					id: ORGANIZATION_RULE_START + 500 + index,
					priority: 2,
					action: { type: "block" },
					condition: {
						requestDomains: [domain],
						resourceTypes: ["main_frame"],
						...(policies ? { excludedRequestMethods: ["get"] } : {}),
					},
				},
			];
		})
		.sort((a, b) => a.id - b.id);
	// Repair missing/modified Chrome rules even when the saved revision is current.
	if (
		JSON.stringify(canonical(installed)) === JSON.stringify(canonical(desired))
	)
		return;
	await chrome.declarativeNetRequest.updateDynamicRules({
		removeRuleIds: installed.map((rule) => rule.id),
		addRules: desired,
	});
}

async function scheduleExpiry(approvals: TemporaryAccess[]) {
	clearTimeout(expiryTimer);
	expiryTimer = undefined;
	const deadlines = approvals
		.map((approval) => Date.parse(approval.expires_at))
		.filter((time) => time > Date.now());
	if (!deadlines.length) {
		await chrome.alarms?.clear?.(EXPIRY_ALARM);
		return;
	}
	const when = Math.min(...deadlines);
	// Create the durable alarm before lifting restrictions. The timer handles the
	// normal awake case; the alarm and local event checks survive worker suspension.
	await chrome.alarms.create(EXPIRY_ALARM, { when });
	expiryTimer = setTimeout(
		() => {
			void expireTemporaryAccess().catch(recordExpiryError);
		},
		Math.max(0, when - Date.now()),
	);
}

async function recordExpiryError(cause: unknown) {
	console.error(
		"CyberGuard could not restore expired organization protection",
		cause,
	);
	await withRuleLock(async () => {
		const enrollment = await read();
		if (enrollment)
			await chrome.storage.local.set({
				[KEY]: {
					...enrollment,
					error: "Could not restore expired protection. Reload the extension.",
				},
			});
	});
	await chrome.alarms.create(EXPIRY_ALARM, { when: Date.now() + 30000 });
}

async function restrictAffectedTabs(previous: Enrollment, current: Enrollment) {
	const lostDomains = (previous.approvals ?? []).filter(
		(approval) => !activeApproval(approval.domain, current.approvals ?? []),
	);
	if (!lostDomains.length || !current.policies) return;
	const tabs = await chrome.tabs.query({});
	await Promise.allSettled(
		tabs.map(async (tab) => {
			if (tab.id === undefined || !tab.url) return;
			let url: URL;
			try {
				url = new URL(tab.url);
			} catch {
				return;
			}
			if (
				!["http:", "https:"].includes(url.protocol) ||
				!lostDomains.some((approval) =>
					matchesDomain(url.hostname, approval.domain),
				)
			)
				return;
			const decision = evaluateNavigation(
				tab.url,
				current.policies!,
				current.approvals ?? [],
			);
			if (decision.allowed) return;
			const restriction = decision.policies.find(
				(policy) =>
					policy.action === "block" &&
					!activeApproval(policy.domain, current.approvals ?? []),
			);
			if (restriction)
				await chrome.tabs.update(tab.id, {
					url:
						chrome.runtime.getURL("blocked.html") +
						"?domain=" +
						encodeURIComponent(restriction.domain) +
						"#" +
						tab.url,
				});
		}),
	);
}

export async function expireTemporaryAccess(force = false) {
	// This lock never waits for network synchronization. An offline request cannot
	// hold up expiration, and sync commits cannot overwrite local expiry repairs.
	await withRuleLock(async () => {
		const previous = await read();
		if (!previous) return;
		const approvals = (previous.approvals ?? []).filter(
			(approval) => Date.parse(approval.expires_at) > Date.now(),
		);
		if (!force && approvals.length === (previous.approvals ?? []).length)
			return;
		const current = { ...previous, approvals };
		await scheduleExpiry(approvals);
		await replaceRulesUnlocked(current.domains, current.policies, approvals);
		await chrome.storage.local.set({ [KEY]: current });
		await restrictAffectedTabs(previous, current);
	});
}

async function clearEnrollment() {
	await withRuleLock(async () => {
		await replaceRulesUnlocked([]);
		await chrome.storage.local.remove([KEY]);
		await scheduleExpiry([]);
	});
}
async function syncInternal() {
	const enrollment = await read();
	if (!enrollment) return;
	try {
		const version = chrome.runtime.getManifest().version;
		const snapshot = await post("sync", { token: enrollment.token, version });
		if (snapshot.revoked === true) {
			await clearEnrollment();
			return;
		}
		if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
			throw new Error("Invalid rule version received.");
		const domains = validateDomains(snapshot.domains);
		const { policies, approvals } = validatePolicySnapshot(snapshot, domains);
		const applied = {
			...enrollment,
			revision: snapshot.revision,
			domains,
			policies,
			approvals: approvals.filter(
				(approval) => Date.parse(approval.expires_at) > Date.now(),
			),
			error: undefined,
		};
		// Commit cached policy and actual Chrome rules under the same local lock.
		await withRuleLock(async () => {
			const previous = (await read())!;
			await scheduleExpiry(applied.approvals);
			await replaceRulesUnlocked(domains, policies, applied.approvals);
			await chrome.storage.local.set({ [KEY]: applied });
			await restrictAffectedTabs(previous, applied);
		});
		const ack = await post("sync", {
			token: enrollment.token,
			version,
			applied: snapshot.revision,
		});
		if (ack.revoked === true) {
			await clearEnrollment();
			return;
		}
		await withRuleLock(async () => {
			const latest = await read();
			if (latest)
				await chrome.storage.local.set({
					[KEY]: { ...latest, lastSync: new Date().toISOString() },
				});
		});
	} catch (error) {
		await withRuleLock(async () => {
			const latest = await read();
			if (!latest) return;
			await scheduleExpiry(latest.approvals ?? []);
			await chrome.storage.local.set({
				[KEY]: {
					...latest,
					error:
						error instanceof Error
							? error.message
							: "Organization sync failed.",
				},
			});
		});
		throw error;
	}
}
function publicState(enrollment: Enrollment | undefined) {
	if (!enrollment) return { enrolled: false };
	const { token: _token, ...state } = enrollment;
	void _token;
	return { enrolled: true, ...state };
}
export function handleProtection(message: ProtectionMessage) {
	// Local status must not wait behind an offline network sync.
	if (message.action === "status")
		return expireTemporaryAccess().then(read).then(publicState);
	return serialize(async () => {
		if (message.action === "enroll") {
			if (await read())
				throw new Error(
					"Disconnect the currently enrolled organization before enrolling again.",
				);
			if (!message.organizationId || !message.name?.trim() || !message.userId)
				throw new Error("Choose an organization and browser name.");
			if (typeof message.accessToken !== "string" || !message.accessToken)
				throw new Error("Sign in to CyberGuard and refresh this page first.");
			const result = await post(
				"enroll",
				{
					organization_id: message.organizationId,
					name: message.name.trim(),
					version: chrome.runtime.getManifest().version,
					...deviceDescription(),
				},
				message.accessToken,
			);
			if (!result.id || !/^[a-f0-9]{64}$/.test(result.token) || !result.user_id)
				throw new Error("Invalid enrollment response.");
			if (result.user_id !== message.userId) {
				await post("disconnect", {
					token: result.token,
					version: chrome.runtime.getManifest().version,
				}).catch(() => undefined);
				throw new Error(
					"Your account changed during connection. Refresh CyberGuard and try again.",
				);
			}
			await chrome.storage.local.set({
				[KEY]: {
					id: result.id,
					token: result.token,
					userId: result.user_id,
					organizationId: message.organizationId,
					organizationName: message.organizationName ?? "Organization",
					name: message.name.trim(),
					revision: -1,
					domains: [],
				} satisfies Enrollment,
			});
			// Enrollment survives a first-sync failure; return its identity and recorded error.
			await syncInternal().catch(() => undefined);
		} else if (message.action === "sync") {
			await expireTemporaryAccess();
			await syncInternal().catch(() => undefined);
		} else if (message.action === "disconnect") {
			const enrollment = await read();
			if (enrollment)
				await post("disconnect", {
					token: enrollment.token,
					version: chrome.runtime.getManifest().version,
				});
			await clearEnrollment();
		}
		return publicState(await read());
	});
}
export function startProtection() {
	const local = () => {
		void expireTemporaryAccess().catch(recordExpiryError);
	};
	const run = () => {
		void expireTemporaryAccess(true)
			.then(() => serialize(syncInternal).catch(() => undefined))
			.catch(recordExpiryError);
	};
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === EXPIRY_ALARM) local();
		if (alarm.name === "organization-protection") run();
	});
	chrome.runtime.onStartup.addListener(run);
	chrome.webNavigation.onBeforeNavigate?.addListener((event) => {
		if (event.frameId === 0) local();
	});
	void chrome.alarms.create("organization-protection", { periodInMinutes: 1 });
	run();
}

function deviceDescription() {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /Chrome\//.test(ua)
			? "Chrome"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Safari\//.test(ua)
					? "Safari"
					: "Unknown";
	const os = /Android/.test(ua)
		? "Android"
		: /iPhone|iPad/.test(ua)
			? "iOS"
			: /Windows/.test(ua)
				? "Windows"
				: /Macintosh|Mac OS X/.test(ua)
					? "macOS"
					: /Linux/.test(ua)
						? "Linux"
						: "Unknown";
	return { browser, os };
}
export async function getOrganizationWebsiteRules(domains: string[]) {
	await expireTemporaryAccess();
	const enrollment = await read();
	return [...new Set([...(enrollment?.domains ?? []), ...domains])].map(
		(domain) => ({
			domain,
			action:
				enrollment?.policies?.find((policy) => policy.domain === domain)
					?.action ?? ("block" as const),
			accessExpiresAt: activeApproval(domain, enrollment?.approvals ?? [])
				?.expires_at,
		}),
	);
}

export async function getOrganizationBlockInfo(
	domain: string,
	target?: string,
) {
	const enrollment = await read();
	if (!enrollment || !enrollment.domains.includes(domain))
		throw new Error("No matching organization rule.");
	const context = {
		organization: enrollment.organizationName,
		organizationId: enrollment.organizationId,
	};
	if (!target) return context;
	const policies =
		enrollment.policies ??
		enrollment.domains.map((domain) => ({
			domain,
			action: "block" as const,
			reason: "Organization website restriction",
		}));
	const navigation = evaluateNavigation(
		target,
		policies,
		enrollment.approvals ?? [],
	);
	if (!matchesDomain(new URL(navigation.url).hostname, domain))
		throw new Error("Website does not match this rule.");
	const personal = (await chrome.declarativeNetRequest.getDynamicRules()).some(
		(rule) =>
			rule.id < ORGANIZATION_RULE_START &&
			rule.action.type === "block" &&
			rule.condition.requestDomains.some((host) =>
				matchesDomain(new URL(navigation.url).hostname, host),
			),
	);
	const reviewDomain =
		navigation.policies.find(
			(rule) =>
				rule.action === "block" &&
				!activeApproval(rule.domain, enrollment.approvals ?? []),
		)?.domain ?? domain;
	return {
		...context,
		...navigation,
		reviewDomain,
		personalBlocked: personal,
		allowed: navigation.allowed && !personal,
	};
}

export async function continueOrganizationNavigation(
	domain: string,
	target: string,
) {
	// Re-read the cached decision and local clock on every click, including after sleep
	// or during an outage, before allowing continuation.
	return serialize(async () => {
		const result = await getOrganizationBlockInfo(domain, target);
		if (!("allowed" in result) || !result.allowed)
			throw new Error(
				"Access is restricted or your temporary approval has expired. Request a review or sync your extension.",
			);
		const enrollment = (await read())!;
		// Scope the extension initiator exclusion to this destination only. A redirect
		// to a different restricted domain must go through its own policy check.
		await withRuleLock(() =>
			replaceRulesUnlocked(
				enrollment.domains,
				enrollment.policies,
				enrollment.approvals,
				new URL(result.url).hostname,
			),
		);
		const checked = await getOrganizationBlockInfo(domain, target);
		if (!("allowed" in checked) || !checked.allowed)
			throw new Error(
				"Access is restricted or your temporary approval has expired.",
			);
		return { url: result.url };
	});
}
