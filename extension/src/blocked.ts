declare const chrome: {
	tabs: {
		query(options: { url: string[] }): Promise<{ url?: string }[]>;
		create(options: { url: string }): Promise<unknown>;
	};
	runtime: {
		sendMessage(
			message: unknown,
		): Promise<{
			organization?: string;
			organizationId?: string;
			error?: string;
		}>;
	};
};
// Standalone page: keep runtime declarations scoped without ESM export syntax.
(() => {
	const domain = new URL(location.href).searchParams.get("domain") ?? "";
	document.querySelector("#domain")!.textContent = domain;
	const dashboard = document.querySelector<HTMLAnchorElement>("#dashboard")!;
	const review = document.querySelector<HTMLAnchorElement>("#request-review")!;
	function connectLink(anchor: HTMLAnchorElement) {
		anchor.addEventListener("click", async (event) => {
			event.preventDefault();
			try {
				const tabs = await chrome.tabs.query({
					url: ["http://localhost:5173/*", "http://127.0.0.1:5173/*"],
				});
				const existing = tabs.find(
					(tab) =>
						tab.url &&
						["http://localhost:5173", "http://127.0.0.1:5173"].includes(
							new URL(tab.url).origin,
						),
				);
				const target = new URL(anchor.href);
				const origin = existing?.url
					? new URL(existing.url).origin
					: target.origin;
				await chrome.tabs.create({
					url: `${origin}${target.pathname}${target.search}`,
				});
			} catch {
				location.href = anchor.href;
			}
		});
	}
	connectLink(dashboard);
	connectLink(review);
	// Local context only. Opening the form sends no request; the member must sign in and submit.
	void chrome.runtime
		.sendMessage({ type: "organizationBlockInfo", domain })
		.then((result) => {
			document.querySelector("#organization")!.textContent = result.organization
				? `Managed by ${result.organization}`
				: "Managed by your organization";
			if (result.organizationId) {
				const target = new URL(dashboard.href);
				target.search = new URLSearchParams({
					view: "review",
					org: result.organizationId,
					domain,
				}).toString();
				review.href = target.href;
				review.hidden = false;
			}
		})
		.catch(() => {
			document.querySelector("#organization")!.textContent =
				"Managed by your organization";
		});
})();
