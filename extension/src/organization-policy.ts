/** Policy decisions are local: no visited URLs or page contents leave the browser. */
export type WebsitePolicy = {
	domain: string;
	action: "warn" | "block";
	reason: string;
};
export type TemporaryAccess = { domain: string; expires_at: string };

export function matchesDomain(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}

export function activeApproval(
	domain: string,
	approvals: TemporaryAccess[],
	now = Date.now(),
): TemporaryAccess | undefined {
	return approvals.find(
		(approval) =>
			approval.domain === domain && Date.parse(approval.expires_at) > now,
	);
}

export function evaluateNavigation(
	input: string,
	policies: WebsitePolicy[],
	approvals: TemporaryAccess[],
	now = Date.now(),
): {
	url: string;
	policies: WebsitePolicy[];
	allowed: boolean;
	expiresAt?: string;
} {
	const url = new URL(input);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error(
			"Only HTTP/HTTPS websites without embedded credentials can be opened.",
		);
	const matching = policies.filter((policy) =>
		matchesDomain(url.hostname, policy.domain),
	);
	if (!matching.length)
		throw new Error("No matching organization rule. Open the website again.");
	const blocks = matching.filter((policy) => policy.action === "block");
	const grants = blocks.map((policy) =>
		activeApproval(policy.domain, approvals, now),
	);
	return {
		url: url.href,
		policies: matching,
		allowed: grants.every(Boolean),
		expiresAt:
			grants.length && grants.every(Boolean)
				? new Date(
						Math.min(...grants.map((grant) => Date.parse(grant!.expires_at))),
					).toISOString()
				: undefined,
	};
}
