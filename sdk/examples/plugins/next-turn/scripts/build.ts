/**
 * Bundle Next Turn's sandbox entry into `dist/index.js`, leaving only the bare
 * specifiers the plugin loader aliases to the host runtime (`HOST_PROVIDED_SDK_SPECIFIERS`
 * in `sdk/packages/core/src/extensions/plugin/plugin-module-import.ts:13-28`)
 * and Node builtins.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HOST_PROVIDED_SDK_SPECIFIERS,
	PLUGIN_DIST_DIR,
	PLUGIN_DIST_ENTRY,
	PLUGIN_SRC_DIR,
	PLUGIN_SRC_ENTRY,
} from "../src/config";

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BUILTIN_SPECIFIERS: ReadonlySet<string> = new Set(
	builtinModules.flatMap((id) => [
		id,
		id.replace(/^node:/, ""),
		`node:${id.replace(/^node:/, "")}`,
	]),
);

export const ALLOWED_BARE_SPECIFIERS: ReadonlySet<string> = new Set([
	...HOST_PROVIDED_SDK_SPECIFIERS,
	...BUILTIN_SPECIFIERS,
]);

/**
 * Upstream's static module specifier scanner
 * (`collectStaticModuleSpecifiers` in `plugin-module-import.ts:409-426`).
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

export function isBareSpecifier(specifier: string): boolean {
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

export type BuildPluginOptions = {
	root?: string;
	outDir?: string;
};

export async function buildPlugin(
	options: BuildPluginOptions = {},
): Promise<{ entryPath: string; bytes: number }> {
	const root = options.root ?? PLUGIN_ROOT;
	const outDir = options.outDir ?? join(root, PLUGIN_DIST_DIR);
	const result = await Bun.build({
		entrypoints: [join(root, PLUGIN_SRC_DIR, PLUGIN_SRC_ENTRY)],
		target: "node",
		format: "esm",
		minify: false,
		sourcemap: "none",
		external: [...HOST_PROVIDED_SDK_SPECIFIERS, ...BUILTIN_SPECIFIERS],
	});
	if (!result.success || result.outputs.length !== 1) {
		const logs = result.logs.map((log) => String(log)).join("\n");
		throw new Error(`next-turn bundle failed${logs ? `:\n${logs}` : ""}`);
	}
	const output = result.outputs[0];
	if (!output) throw new Error("next-turn bundle produced no output");
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
