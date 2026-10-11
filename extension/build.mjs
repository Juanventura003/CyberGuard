import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { injectBrandIds } from "./brand-catalog.mjs";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const sourceRoot = path.join(extensionRoot, "src");
const outputRoot = path.join(extensionRoot, "dist");

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "popup"), { recursive: true });

// Ship attribution with the identifiers derived from the licensed dataset.
const catalog = JSON.parse(
	await fs.readFile(
		path.join(
			extensionRoot,
			"..",
			"src",
			"backend",
			"app",
			"data",
			"brands.json",
		),
		"utf8",
	),
);
await fs.writeFile(
	path.join(outputRoot, "brand-data.NOTICE.txt"),
	`${catalog.source.title}, version ${catalog.source.dataset_version}\n` +
		`By ${catalog.source.author}\n${catalog.source.url}\n` +
		`${catalog.source.license}: ${catalog.source.license_url}\n` +
		`Changes: ${catalog.source.changes}\nOnly active identifiers are bundled.\n`,
);

for (const [source, output] of [
	["background.ts", "background.js"],
	["redirect-tracker.ts", "redirect-tracker.js"],
	["content.ts", "content.js"],
	["banner.ts", "banner.js"],
	[path.join("popup", "popup.ts"), path.join("popup.js")],
]) {
	const sourcePath = path.join(sourceRoot, source);
	const rawSource = await fs.readFile(sourcePath, "utf8");
	const sourceText =
		source === "banner.ts" ? injectBrandIds(rawSource) : rawSource;
	const result = ts.transpileModule(sourceText, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
		},
	});
	await fs.writeFile(path.join(outputRoot, output), result.outputText);
}

await fs.copyFile(
	path.join(extensionRoot, "manifest.json"),
	path.join(outputRoot, "manifest.json"),
);
await fs.copyFile(
	path.join(extensionRoot, "..", "src", "assets", "logo.png"),
	path.join(outputRoot, "icon.png"),
);
await fs.copyFile(
	path.join(sourceRoot, "popup", "popup.html"),
	path.join(outputRoot, "popup", "popup.html"),
);
await fs.copyFile(
	path.join(sourceRoot, "popup", "popup.css"),
	path.join(outputRoot, "popup", "popup.css"),
);
