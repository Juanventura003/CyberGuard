import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(extensionRoot, "src");
const outputRoot = path.join(extensionRoot, "dist");

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "popup"), { recursive: true });

for (const [source, output] of [
  ["background.ts", "background.js"],
  ["content.ts", "content.js"],
  [path.join("popup", "popup.ts"), path.join("popup", "popup.js")]
]) {
  const sourcePath = path.join(sourceRoot, source);
  const sourceText = await fs.readFile(sourcePath, "utf8");
  const result = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  await fs.writeFile(path.join(outputRoot, output), result.outputText);
}

await fs.copyFile(path.join(extensionRoot, "manifest.json"), path.join(outputRoot, "manifest.json"));
await fs.copyFile(path.join(extensionRoot, "..", "src", "assets", "logo.png"), path.join(outputRoot, "icon.png"));
await fs.copyFile(path.join(sourceRoot, "popup", "popup.html"), path.join(outputRoot, "popup", "popup.html"));
await fs.copyFile(path.join(sourceRoot, "popup", "popup.css"), path.join(outputRoot, "popup", "popup.css"));