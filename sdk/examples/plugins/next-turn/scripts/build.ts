/**
 * Bundle Next Turn's sandbox entry into `dist/index.js`, leaving only the bare
 * specifiers the plugin loader aliases to the host runtime and Node builtins.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const PLUGIN_DIST_DIR = "dist";
export const PLUGIN_DIST_ENTRY = "index.js";

const PLUGIN_SRC_ENTRY = join("src", "index.ts");

/**
 * Specifiers the plugin sandbox loader aliases to the host runtime: a copy of
 * `HOST_PROVIDED_SDK_SPECIFIERS` in `@cline/core`'s `plugin-module-import.ts`,
 * which core does not export. Every other bare dependency is bundled.
 */
const HOST_PROVIDED_SDK_SPECIFIERS = [
	"@cline/sdk",
	"@cline/agents",
	"@cline/core",
	"@cline/core/hub",
	"@cline/core/hub/daemon-entry",
	"@cline/core/telemetry",
	"@cline/llms",
	"@cline/llms/browser",
	"@cline/shared",
	"@cline/shared/automation",
	"@cline/shared/browser",
	"@cline/shared/storage",
	"@cline/shared/db",
	"@cline/shared/types",
];

const BUILTIN_SPECIFIERS: ReadonlySet<string> = new Set(
	builtinModules.flatMap((id) => [
		id,
		id.replace(/^node:/, ""),
		`node:${id.replace(/^node:/, "")}`,
	]),
);

const ALLOWED_BARE_SPECIFIERS: ReadonlySet<string> = new Set([
	...HOST_PROVIDED_SDK_SPECIFIERS,
	...BUILTIN_SPECIFIERS,
]);

/**
 * A copy of upstream's static module specifier scanner,
 * `collectStaticModuleSpecifiers` in `@cline/core`'s `plugin-module-import.ts`.
 */
export function collectStaticModuleSpecifiers(source: string): string[] {
	const specifiers = new Set<string>();
	const patterns = [
		/\bimport\s+(?:type\s+)?[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
		/\bexport\s+[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
		/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
		/\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier) specifiers.add(specifier);
		}
	}
	return [...specifiers];
}

function isBareSpecifier(specifier: string): boolean {
	return (
		!specifier.startsWith(".") &&
		!specifier.startsWith("/") &&
		!specifier.startsWith("file:")
	);
}

/** Bare specifiers in `source` that the host runtime cannot resolve. */
export function forbiddenBareSpecifiers(source: string): string[] {
	return collectStaticModuleSpecifiers(source).filter(
		(specifier) =>
			isBareSpecifier(specifier) && !ALLOWED_BARE_SPECIFIERS.has(specifier),
	);
}

type BuildPluginOptions = {
	root?: string;
	outDir?: string;
};

export async function buildPlugin(
	options: BuildPluginOptions = {},
): Promise<{ entryPath: string; bytes: number }> {
	const root = options.root ?? PLUGIN_ROOT;
	const outDir = options.outDir ?? join(root, PLUGIN_DIST_DIR);
	const result = await Bun.build({
		entrypoints: [join(root, PLUGIN_SRC_ENTRY)],
		target: "node",
		format: "esm",
		external: HOST_PROVIDED_SDK_SPECIFIERS,
	});
	const [output] = result.outputs;
	if (!result.success || result.outputs.length !== 1 || !output) {
		const logs = result.logs.map((log) => String(log)).join("\n");
		throw new Error(`next-turn bundle failed${logs ? `:\n${logs}` : ""}`);
	}
	const code = await output.text();
	const forbidden = forbiddenBareSpecifiers(code);
	if (forbidden.length > 0) {
		throw new Error(
			`next-turn bundle contains unaliased bare specifiers: ${forbidden.join(", ")}`,
		);
	}
	mkdirSync(outDir, { recursive: true });
	const entryPath = join(outDir, PLUGIN_DIST_ENTRY);
	writeFileSync(entryPath, code);
	return { entryPath, bytes: Buffer.byteLength(code) };
}

if (import.meta.main) {
	const { bytes } = await buildPlugin();
	console.log(
		`next-turn: ${bytes} bytes → ${PLUGIN_DIST_DIR}/${PLUGIN_DIST_ENTRY}`,
	);
}
