// Kept separate from the localhost-only dashboard authentication bridge.
(() => {
	const api = (
		globalThis as unknown as {
			chrome: {
				runtime: {
					id?: string;
					sendMessage(message: {
						type: "getPageAnalysis";
						page: PageSignals;
					}): Promise<{
						result?: Result | null;
					}>;
				};
				storage: {
					local: {
						get(keys: string[]): Promise<Record<string, unknown>>;
						set(values: Record<string, unknown>): Promise<void>;
					};
					onChanged: {
						addListener(cb: () => void): void;
					};
				};
			};
		}
	).chrome;
	if (location.hostname === "localhost" || location.hostname === "127.0.0.1")
		return;
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
	// Send only brand identifiers and form origins, never text, values, or HTML.
	function collectPageSignals(): PageSignals {
		const heading = `${document.title} ${Array.from(
			document.querySelectorAll("h1"),
		)
			.slice(0, 3)
			.map((el) => el.textContent?.slice(0, 200) ?? "")
			.join(" ")}`
			.slice(0, 1000)
			.toLowerCase();
		const brands = /* CYBERGUARD_BRAND_IDS */ ([] as string[])
			.filter((brand) => new RegExp(`\\b${brand}\\b`).test(heading))
			.slice(0, 20);
		const forms: PageSignals["password_forms"] = [];
		let passwordWithoutForm = false;
		const seen = new Set<HTMLFormElement>();
		for (const input of Array.from(
			document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
		).slice(0, 50)) {
			if (
				!input.getClientRects().length ||
				getComputedStyle(input).visibility === "hidden"
			)
				continue;
			if (!input.form) {
				passwordWithoutForm = true;
				continue;
			}
			if (seen.has(input.form) || forms.length >= 20) continue;
			seen.add(input.form);
			try {
				const action = new URL(
					input.form.action || location.href,
					document.baseURI,
				);
				if (!["http:", "https:"].includes(action.protocol)) continue;
				const method = input.form.method.toLowerCase();
				forms.push({
					action_origin: action.origin,
					method: method === "get" || method === "post" ? method : "other",
				});
				for (const element of Array.from(input.form.elements).slice(0, 100)) {
					if (forms.length >= 20) break;
					if (!(
						element instanceof HTMLButtonElement ||
						element instanceof HTMLInputElement
					))
						continue;
					if (
						!["submit", "image"].includes(element.type) ||
						element.disabled ||
						!element.getClientRects().length
					)
						continue;
					if (
						!element.hasAttribute("formaction") &&
						!element.hasAttribute("formmethod")
					)
						continue;
					const override = new URL(
						element.hasAttribute("formaction")
							? element.formAction
							: action.href,
						document.baseURI,
					);
					if (!["http:", "https:"].includes(override.protocol)) continue;
					const overrideMethod = element.hasAttribute("formmethod")
						? element.formMethod.toLowerCase()
						: method;
					forms.push({
						action_origin: override.origin,
						method:
							overrideMethod === "get" || overrideMethod === "post"
								? overrideMethod
								: "other",
					});
				}
			} catch {
				/* Malformed destinations cannot be assessed. */
			}
		}
		let recoverySecretFields = 0;
		for (const field of Array.from(
			document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
				"input, textarea",
			),
		).slice(0, 200)) {
			if (
				field.disabled ||
				field.readOnly ||
				!field.getClientRects().length ||
				getComputedStyle(field).visibility === "hidden"
			)
				continue;
			if (
				field instanceof HTMLInputElement &&
				[
					"hidden",
					"submit",
					"button",
					"checkbox",
					"radio",
					"file",
					"image",
				].includes(field.type)
			)
				continue;
			// Read static labels only. Never read value or textarea textContent.
			const descriptor =
				["name", "id", "placeholder", "aria-label"]
					.map((attribute) => field.getAttribute(attribute) ?? "")
					.join(" ") +
				" " +
				Array.from(field.labels ?? [])
					.map((label) => label.textContent?.slice(0, 200) ?? "")
					.join(" ");
			const normalized = descriptor
				.slice(0, 1500)
				.replace(/[_-]/g, " ")
				.toLowerCase();
			if (
				/\b(?:seed phrase|recovery phrase|mnemonic(?: phrase)?|private key)\b/.test(
					normalized,
				)
			)
				recoverySecretFields++;
		}
		const misleadingLinks: PageSignals["misleading_links"] = [];
		for (const link of Array.from(
			document.querySelectorAll<HTMLAnchorElement>("a[href]"),
		).slice(0, 300)) {
			if (misleadingLinks.length >= 10) break;
			if (
				!link.getClientRects().length ||
				getComputedStyle(link).visibility === "hidden"
			)
				continue;
			const text = link.textContent?.trim() ?? "";
			// Require an explicit URL cue. Bare dotted labels can be filenames or product names.
			if (
				!/^(?:https?:\/\/|www\.)/i.test(text) &&
				!/^[^\s]+\.[a-z]{2,}\//i.test(text)
			)
				continue;
			// Only labels that are entirely a URL/domain, not ordinary prose or brand names.
			if (
				!/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(
					text,
				)
			)
				continue;
			try {
				const displayed = new URL(
					/^https?:\/\//i.test(text) ? text : `https://${text}`,
				);
				const destination = new URL(link.href, document.baseURI);
				if (!["http:", "https:"].includes(destination.protocol)) continue;
				const a = displayed.hostname.replace(/^www\./, "");
				const b = destination.hostname.replace(/^www\./, "");
				if (a !== b && !a.endsWith(`.${b}`) && !b.endsWith(`.${a}`))
					misleadingLinks.push({
						displayed_host: a,
						destination_host: b,
						in_password_form: seen.has(link.closest("form") as HTMLFormElement),
					});
			} catch {
				/* Not a usable displayed domain. */
			}
		}
		return {
			brands,
			password_forms: forms,
			password_without_form: passwordWithoutForm,
			recovery_secret_fields: recoverySecretFields,
			misleading_links: misleadingLinks,
		};
	}
	type Result = {
		url: string;
		riskLevel: string;
		pageWarning?: boolean;
		domain: string;
		explanation: string[];
	};
	const host = document.createElement("div");
	host.style.cssText =
		"all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;";
	const shadow = host.attachShadow({ mode: "closed" });
	shadow.innerHTML = `<style>
 :host { color-scheme: light; } * { box-sizing:border-box; }
 .card { width:250px;max-width:calc(100vw - 16px);font:12px/1.4 system-ui,sans-serif;background:#fff;color:#263246;border:1px solid #d0d5dd;border-left:4px solid var(--accent,#64748b);border-radius:12px;box-shadow:0 4px 24px #0002;padding:10px; }
 .handle { display:flex;align-items:center;gap:8px;cursor:grab;touch-action:none;user-select:none; }
 strong { font-size:11px;letter-spacing:.04em;flex:1; } button { font:inherit;color:#475467;background:none;border:0;cursor:pointer;padding:3px 6px;border-radius:4px; } button:focus-visible { outline:2px solid #4169e1; }
 .status { color:var(--accent);font-weight:700;margin-top:6px; } .domain { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#667085;margin:3px 0; }
 details { margin-top:5px; } summary { cursor:pointer; } p { margin:6px 0 0; } .handle:active { cursor:grabbing; }
 </style><section class="card" aria-label="CyberGuard website notification"><div class="handle"><strong>◈ CYBERGUARD</strong><button aria-label="Turn off floating notifications" title="Turn off floating notifications">×</button></div><div class="status" role="status" aria-live="polite"></div><div class="domain"></div><details><summary>Why?</summary><div class="reasons"></div></details></section>`;
	const card = shadow.querySelector<HTMLElement>(".card")!;
	let position = { x: Math.max(8, innerWidth - 270), y: 24 };
	let stopped = false;
	function stopBanner() {
		stopped = true;
		if (pollTimer !== undefined) clearInterval(pollTimer);
		observer?.disconnect();
		host.remove();
	}
	function hasContext() {
		try {
			if (!stopped && api.runtime.id) return true;
		} catch {
			/* Chrome can throw when accessing an expired context. */
		}
		stopBanner();
		return false;
	}
	let revision = 0;
	let pageUrl = location.href;
	let directResult: Result | null = null;
	let checkFinished = false;
	let checkVersion = 0;
	let pageFingerprint = "";
	let nextPageScan = 0;
	function pageKey(url: string) {
		try {
			const parsed = new URL(url);
			parsed.username = "";
			parsed.password = "";
			parsed.hash = "";
			return parsed.href;
		} catch {
			return url;
		}
	}
	async function checkPage() {
		if (!hasContext() || document.hidden) return;
		const page = collectPageSignals();
		pageFingerprint = JSON.stringify(page);
		nextPageScan = Date.now() + 5000;
		const version = ++checkVersion;
		checkFinished = false;
		directResult = null;
		void render();
		try {
			const response = await Promise.race([
				api.runtime.sendMessage({ type: "getPageAnalysis", page }),
				new Promise<{
					result: null;
				}>((resolve) => setTimeout(() => resolve({ result: null }), 15000)),
			]);
			if (!hasContext() || version !== checkVersion) return;
			directResult = response.result ?? null;
		} catch {
			/* Render an unavailable result instead of waiting forever. */
		}
		if (!hasContext() || version !== checkVersion) return;
		checkFinished = true;
		void render();
	}
	function place() {
		position.x = Math.max(
			8,
			Math.min(
				position.x,
				Math.max(8, innerWidth - host.getBoundingClientRect().width - 8),
			),
		);
		position.y = Math.max(
			8,
			Math.min(
				position.y,
				Math.max(8, innerHeight - host.getBoundingClientRect().height - 8),
			),
		);
		host.style.setProperty("left", `${position.x}px`, "important");
		host.style.setProperty("top", `${position.y}px`, "important");
	}
	async function render() {
		if (!hasContext()) return;
		const current = ++revision;
		try {
			const stored = await api.storage.local.get([
				"bannerEnabled",
				"monitoringEnabled",
				"websiteAnalysisCache",
				"websiteActivity",
				"bannerPosition",
			]);
			if (!hasContext() || current !== revision) return;
			if (stored.bannerEnabled !== true || stored.monitoringEnabled === false) {
				host.remove();
				return;
			}
			const saved = stored.bannerPosition as
				| {
						x?: number;
						y?: number;
				  }
				| undefined;
			if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y))
				position = { x: saved.x!, y: saved.y! };
			const activity = Array.isArray(stored.websiteActivity)
				? (stored.websiteActivity as Result[])
				: [];
			const result =
				directResult ??
				activity.find((item) => pageKey(item.url) === pageKey(location.href));
			const labels: Record<string, [string, string]> = {
				HIGH_RISK: ["Known threat detected", "#b42318"],
				SUSPICIOUS: ["Suspicious URL", "#986800"],
				NO_KNOWN_THREAT: ["No known threat found", "#157347"],
				UNABLE_TO_VERIFY: ["Unable to verify", "#64748b"],
			};
			const [label, color] = result
				? (labels[result.riskLevel] ?? labels.UNABLE_TO_VERIFY)
				: [
						checkFinished ? "Unable to verify" : "Checking this website…",
						"#64748b",
					];
			card.style.setProperty("--accent", color);
			shadow.querySelector(".status")!.textContent =
				result?.riskLevel === "SUSPICIOUS" && result.pageWarning
					? "Suspicious page"
					: label;
			shadow.querySelector(".domain")!.textContent = location.hostname;
			const reasons = shadow.querySelector(".reasons")!;
			reasons.replaceChildren(
				...(
					result?.explanation ?? [
						checkFinished
							? "No completed check is available. Open CyberGuard and press Refresh to retry."
							: "Waiting for the URL check. No result is available yet.",
					]
				)
					.filter((text) => !text.startsWith("OpenPhish feed last downloaded:"))
					.map((text) => {
						const p = document.createElement("p");
						p.textContent = text;
						return p;
					}),
			);
			if (!host.isConnected) document.documentElement.append(host);
			place();
		} catch {
			if (!hasContext()) return;
			host.remove();
		}
	}
	shadow.querySelector("button")!.addEventListener("click", async () => {
		if (!hasContext()) return;
		try {
			await api.storage.local.set({ bannerEnabled: false });
			host.remove();
		} catch {
			if (!hasContext()) return;
			shadow.querySelector(".status")!.textContent =
				"Could not turn off notifications. Try again.";
		}
	});
	const handle = shadow.querySelector<HTMLElement>(".handle")!;
	let drag: {
		x: number;
		y: number;
		left: number;
		top: number;
	} | null = null;
	handle.addEventListener("pointerdown", (event) => {
		if (!hasContext()) return;
		if ((event.target as HTMLElement).closest("button") || event.button !== 0)
			return;
		drag = {
			x: event.clientX,
			y: event.clientY,
			left: position.x,
			top: position.y,
		};
		handle.setPointerCapture(event.pointerId);
	});
	handle.addEventListener("pointermove", (event) => {
		if (!drag) return;
		position = {
			x: drag.left + event.clientX - drag.x,
			y: drag.top + event.clientY - drag.y,
		};
		place();
	});
	const finish = async () => {
		if (!drag) return;
		drag = null;
		if (!hasContext()) return;
		try {
			await api.storage.local.set({ bannerPosition: position });
		} catch {
			// Covers both synchronous throws and rejected promises after a reload.
			hasContext();
		}
	};
	handle.addEventListener("pointerup", finish);
	handle.addEventListener("pointercancel", finish);
	window.addEventListener("resize", place);
	api.storage.onChanged.addListener(() => {
		void render();
	});
	window.addEventListener("popstate", () => {
		void render();
	});
	window.addEventListener("hashchange", () => {
		void render();
	});
	const observer = new ResizeObserver(place);
	observer.observe(host);
	// Apps can replace DOM nodes or change routes without a full page load.
	const pollTimer = setInterval(() => {
		if (!hasContext()) return;
		if (pageUrl !== location.href) {
			pageUrl = location.href;
			void checkPage();
		} else if (Date.now() >= nextPageScan) {
			nextPageScan = Date.now() + 5000;
			if (JSON.stringify(collectPageSignals()) !== pageFingerprint)
				void checkPage();
			else if (!host.isConnected) void render();
		} else if (!host.isConnected) {
			void render();
		}
	}, 1000);
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) void checkPage();
	});
	window.addEventListener("focus", () => {
		void checkPage();
	});
	void checkPage();
})();
