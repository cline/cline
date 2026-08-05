/**
 * Regenerates src/bundled-plugins/generated.ts from the vendored plugin
 * sources in assets/bundled-plugins/. The generated module embeds the plugin
 * files as strings so the single-file CLI bundle (and compiled binaries) can
 * seed them onto disk at startup.
 *
 * Run with: bun script/generate-bundled-plugins.ts
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsRoot = join(cliRoot, "assets", "bundled-plugins");
const outputPath = join(cliRoot, "src", "bundled-plugins", "generated.ts");

function collectFiles(root: string): string[] {
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) {
				continue;
			}
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (entry.isFile()) {
				files.push(entryPath);
			}
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

const slugs = readdirSync(assetsRoot)
	.filter((entry) => statSync(join(assetsRoot, entry)).isDirectory())
	.sort((left, right) => left.localeCompare(right));

const pluginLiterals = slugs.map((slug) => {
	const pluginRoot = join(assetsRoot, slug);
	const fileLiterals = collectFiles(pluginRoot).map((filePath) => {
		const relativePath = relative(pluginRoot, filePath).split(sep).join("/");
		const content = readFileSync(filePath, "utf8");
		return `\t\t\t${JSON.stringify(relativePath)}: ${JSON.stringify(content)},`;
	});
	return [
		"\t{",
		`\t\tslug: ${JSON.stringify(slug)},`,
		"\t\tfiles: {",
		...fileLiterals,
		"\t\t},",
		"\t},",
	].join("\n");
});

const output = `// AUTO-GENERATED FILE - DO NOT EDIT.
// Source of truth: apps/cli/assets/bundled-plugins/
// Regenerate with: bun script/generate-bundled-plugins.ts

/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: embedded plugin source code */

import type { BundledPluginSpec } from "@cline/core";

export const BUNDLED_PLUGINS: BundledPluginSpec[] = [
${pluginLiterals.join("\n")}
];
`;

writeFileSync(outputPath, output, "utf8");
spawnSync("bunx", ["biome", "check", "--write", outputPath], {
	stdio: "ignore",
});
console.log(
	`Wrote ${outputPath} (${slugs.length} plugin${slugs.length === 1 ? "" : "s"}: ${slugs.join(", ")})`,
);
