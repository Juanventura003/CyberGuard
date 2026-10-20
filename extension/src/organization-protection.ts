// Organization rules occupy a reserved range; personal rules are never removed here.
export const ORGANIZATION_RULE_START = 1_000_000;
const KEY = "organizationProtection";
const API = "http://127.0.0.1:8000/api/protection";
type Rule = {
	id: number;
	priority: number;
	action: { type: "block" | "redirect"; redirect?: { url: string } };
	condition: {
		requestDomains: string[];
		resourceTypes: ["main_frame"];
		requestMethods?: string[];
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
	alarms: {
		create(name: string, options: { periodInMinutes: number }): Promise<void>;
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
async function replaceRules(domains: string[]) {
	await withRuleLock(async () => {
		const installed = (await chrome.declarativeNetRequest.getDynamicRules())
			.filter((rule) => rule.id >= ORGANIZATION_RULE_START)
			.sort((a, b) => a.id - b.id);
		const desired: Rule[] = domains
			.flatMap((domain, index) => [
				{
					id: ORGANIZATION_RULE_START + index,
					priority: 3,
					action: {
						type: "redirect" as const,
						redirect: {
							url:
								chrome.runtime.getURL("blocked.html") +
								"?domain=" +
								encodeURIComponent(domain),
						},
					},
					condition: {
						requestDomains: [domain],
						resourceTypes: ["main_frame"] as ["main_frame"],
						requestMethods: ["get"],
					},
				},
				{
					id: ORGANIZATION_RULE_START + 500 + index,
					priority: 2,
					action: { type: "block" as const },
					condition: {
						requestDomains: [domain],
						resourceTypes: ["main_frame"] as ["main_frame"],
					},
				},
			])
			.sort((a, b) => a.id - b.id);
		// Compare actual Chrome rules, not just saved metadata: repair missing/outdated rules.
		if (
			JSON.stringify(canonical(installed)) ===
			JSON.stringify(canonical(desired))
		)
			return;
		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: installed.map((rule) => rule.id),
			addRules: desired,
		});
	});
}
async function clearEnrollment() {
	await replaceRules([]);
	await chrome.storage.local.remove([KEY]);
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
		// Chrome applies the full replacement atomically. Acknowledgement happens only after success.
		await replaceRules(domains);
		const applied = {
			...enrollment,
			revision: snapshot.revision,
			domains,
			error: undefined,
		};
		await chrome.storage.local.set({ [KEY]: applied });
		const ack = await post("sync", {
			token: enrollment.token,
			version,
			applied: snapshot.revision,
		});
		if (ack.revoked === true) {
			await clearEnrollment();
			return;
		}
		await chrome.storage.local.set({
			[KEY]: { ...applied, lastSync: new Date().toISOString() },
		});
	} catch (error) {
		await chrome.storage.local.set({
			[KEY]: {
				...(await read()),
				error:
					error instanceof Error ? error.message : "Organization sync failed.",
			},
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
	if (message.action === "status") return read().then(publicState);
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
		} else if (message.action === "sync")
			await syncInternal().catch(() => undefined);
		else if (message.action === "disconnect") {
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
	const run = () => {
		void serialize(syncInternal).catch(() => undefined);
	};
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === "organization-protection") run();
	});
	chrome.runtime.onStartup.addListener(run);
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
export function getOrganizationBlockInfo(domain: string) {
	return read().then((enrollment) => {
		if (!enrollment || !enrollment.domains.includes(domain))
			throw new Error("No matching organization rule.");
		return {
			organization: enrollment.organizationName,
			organizationId: enrollment.organizationId,
		};
	});
}
