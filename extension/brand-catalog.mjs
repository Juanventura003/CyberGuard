import fs from "node:fs";

// Inline IDs into the classic content script; no additional page/network access.
export function injectBrandIds(source) {
	const catalog = JSON.parse(
		fs.readFileSync(
			new URL("../src/backend/app/data/brands.json", import.meta.url),
			"utf8",
		),
	);
	if (catalog.version !== 1)
		throw new Error("Unsupported brand catalog version");
	const ids = catalog.brands
		.filter((brand) => brand.enabled)
		.map((brand) => brand.identifier);
	if (
		!ids.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !/^[a-z][a-z0-9]{3,39}$/.test(id))
	) {
		throw new Error("Invalid active brand identifiers");
	}
	const marker = /\/\* CYBERGUARD_BRAND_IDS \*\/\s*(\(?)\[\]/;
	if (!marker.test(source)) throw new Error("Missing brand catalog marker");
	return source.replace(
		marker,
		(_, parenthesis) => parenthesis + JSON.stringify(ids),
	);
}
