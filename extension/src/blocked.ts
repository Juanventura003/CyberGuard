declare const chrome: {
	tabs: {
		query(options: { url: string[] }): Promise<{ url?: string }[]>;
		create(options: { url: string }): Promise<unknown>;
	};
	runtime: {
		sendMessage(message: unknown): Promise<{
			organization?: string;
			organizationId?: string;
			url?: string;
			allowed?: boolean;
			personalBlocked?: boolean;
			expiresAt?: string;
			policies?: { action: "warn" | "block"; reason: string }[];
			reviewDomain?: string;
			error?: string;
		}>;
	};
};
// Standalone page: keep runtime declarations scoped without ESM export syntax.
(() => {
	const domain = new URL(location.href).searchParams.get("domain") ?? "";
	document.querySelector("#domain")!.textContent = domain;
	const target = location.hash?.slice(1) ?? "";
	const proceed = document.querySelector<HTMLButtonElement>("#continue");
	proceed?.addEventListener("click", async () => {
		proceed.disabled = true;
		try {
			const result = await chrome.runtime.sendMessage({
				type: "organizationContinue",
				domain,
				target,
			});
			if (result.error || !result.url)
				throw new Error(result.error ?? "Access could not be confirmed.");
			// Navigation originates in this extension page. Only the matching checked
			// rule excludes this initiator; personal and unrelated blocks still apply.
			location.replace(result.url);
		} catch (cause) {
			document.querySelector("#error")!.textContent =
				cause instanceof Error
					? cause.message
					: "Access could not be confirmed.";
			proceed.disabled = false;
		}
	});
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
		.sendMessage({
			type: "organizationBlockInfo",
			domain,
			...(target ? { target } : {}),
		})
		.then((result) => {
			if (result.error) throw new Error(result.error);
			if (result.policies) {
				const blocked = result.policies.some((rule) => rule.action === "block");
				document.querySelector("#heading")!.textContent = blocked
					? result.allowed
						? "Temporary access approved"
						: "This website is blocked."
					: "Your team recommends caution.";
				document.querySelector("#explanation")!.textContent = blocked
					? "Your organization restricts this website. An active approval lets you open it temporarily."
					: "Your organization has a warning for this website. You can choose to continue, but this does not mean it is safe.";
				document.querySelector("#reason")!.textContent = result.policies
					.map((rule) => rule.reason)
					.join(" · ");
				if (result.expiresAt)
					document.querySelector("#approval")!.textContent =
						`Full access is approved until ${new Date(result.expiresAt).toLocaleString()}, including logins and form submissions. The team restriction returns locally when the extension processes expiry; affected open tabs return to this notice. Personal blocks and other matching rules still apply.`;
				if (result.personalBlocked)
					document.querySelector("#error")!.textContent =
						"A separate personal block still prevents access. Manage personal blocks in the extension popup.";
				if (proceed) proceed.hidden = !result.allowed;
			}
			document.querySelector("#organization")!.textContent = result.organization
				? `Managed by ${result.organization}`
				: "Managed by your organization";
			if (result.organizationId) {
				const target = new URL(dashboard.href);
				target.search = new URLSearchParams({
					view: "review",
					org: result.organizationId,
					domain: result.reviewDomain ?? domain,
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
