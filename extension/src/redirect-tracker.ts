export type NavigationRequest = {
	tabId: number;
	requestId: string;
	url: string;
	redirectUrl?: string;
};

type Navigation = {
	requestId: string;
	url: string;
	hosts: string[];
	redirects: number;
	startedAt: number;
};

export class RedirectTracker {
	private visits = new Map<number, Navigation>();
	private committedUrls = new Map<number, string>();

	snapshot() {
		const now = Date.now();
		const visits = [...this.visits]
			.filter(
				([, visit]) =>
					now - visit.startedAt >= 0 && now - visit.startedAt < 5 * 60 * 1000,
			)
			.slice(-100);
		const tabs = new Set(visits.map(([tabId]) => tabId));
		return {
			visits: visits.map(([tabId, visit]) => [
				tabId,
				{ ...visit, hosts: [...visit.hosts] },
			]),
			committedUrls: [...this.committedUrls].filter(([tabId]) =>
				tabs.has(tabId),
			),
		};
	}

	restore(value: unknown) {
		if (!value || typeof value !== "object") return;
		const saved = value as { visits?: unknown; committedUrls?: unknown };
		if (!Array.isArray(saved.visits)) return;
		for (const entry of saved.visits.slice(-100)) {
			if (!Array.isArray(entry) || entry.length !== 2) continue;
			const [tabId, visit] = entry;
			if (
				!Number.isInteger(tabId) ||
				tabId < 0 ||
				!visit ||
				typeof visit.requestId !== "string" ||
				typeof visit.url !== "string" ||
				!Number.isInteger(visit.redirects) ||
				visit.redirects < 0 ||
				!Number.isFinite(visit.startedAt) ||
				Date.now() < visit.startedAt ||
				Date.now() - visit.startedAt >= 5 * 60 * 1000 ||
				!Array.isArray(visit.hosts) ||
				visit.hosts.length > 10 ||
				!visit.hosts.every((host: unknown) => typeof host === "string")
			)
				continue;
			try {
				if (!["http:", "https:"].includes(new URL(visit.url).protocol))
					continue;
				this.visits.set(tabId, { ...visit, hosts: [...visit.hosts] });
			} catch {
				/* Ignore invalid session entries. */
			}
		}
		if (!Array.isArray(saved.committedUrls)) return;
		for (const entry of saved.committedUrls.slice(-100)) {
			if (!Array.isArray(entry) || entry.length !== 2) continue;
			const [tabId, url] = entry;
			if (!this.visits.has(tabId) || typeof url !== "string") continue;
			try {
				if (["http:", "https:"].includes(new URL(url).protocol))
					this.committedUrls.set(tabId, url);
			} catch {
				/* Ignore invalid session entries. */
			}
		}
	}

	start(event: NavigationRequest) {
		if (event.tabId < 0) return;
		const existing = this.visits.get(event.tabId);
		if (existing?.requestId === event.requestId) return;
		this.visits.set(event.tabId, {
			requestId: event.requestId,
			url: event.url,
			hosts: [new URL(event.url).hostname],
			redirects: 0,
			startedAt: Date.now(),
		});
	}

	redirect(event: NavigationRequest) {
		this.start(event);
		const visit = this.visits.get(event.tabId);
		if (!visit || !event.redirectUrl) return;
		const destination = new URL(event.redirectUrl);
		if (!["http:", "https:"].includes(destination.protocol)) return;
		visit.url = destination.href;
		visit.redirects++;
		if (
			visit.hosts.length < 10 &&
			visit.hosts.at(-1) !== destination.hostname
		) {
			visit.hosts.push(destination.hostname);
		}
	}

	note(tabId: number, url: string): string | null {
		const visit = this.visits.get(tabId);
		if (
			!visit ||
			!visit.redirects ||
			visit.url !== url ||
			Date.now() - visit.startedAt > 5 * 60 * 1000
		)
			return null;
		return `Chrome observed ${visit.redirects} redirect${visit.redirects === 1 ? "" : "s"} (${visit.hosts.join(" → ")}). The checks apply to the destination; redirects alone do not indicate a threat.`;
	}

	commit(tabId: number, url: string, clientRedirect: boolean) {
		const previous = this.committedUrls.get(tabId);
		this.committedUrls.set(tabId, url);
		if (!clientRedirect || !previous || previous === url) return;
		const visit = this.visits.get(tabId);
		if (!visit || visit.url !== url) return;
		visit.redirects++;
		const host = new URL(previous).hostname;
		if (visit.hosts[0] !== host)
			visit.hosts = [host, ...visit.hosts].slice(0, 10);
	}

	remove(tabId: number) {
		this.committedUrls.delete(tabId);
		this.visits.delete(tabId);
	}
}
