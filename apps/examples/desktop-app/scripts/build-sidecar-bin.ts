import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { $ } from "bun";

const resolveTargetTriple = async (): Promise<string> => {
	const fromEnv = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.TARGET;
	if (fromEnv?.trim()) {
		return fromEnv.trim();
	}

	const rustcVersion = await $`rustc -vV`.text();
	const hostLine = rustcVersion
		.split("\n")
		.find((line) => line.startsWith("host: "));
	const host = hostLine?.slice("host: ".length).trim();
	if (!host) {
		throw new Error("failed to resolve Rust host target triple");
	}
	return host;
};

// Bun cross-compiles --compile binaries, so a CI runner can produce the
// sidecar for a different architecture than its own (e.g. the x86_64 macOS
// bundle from an arm64 runner). Without an explicit --target, bun always
// emits a host-arch binary even when Tauri is building for another triple.
const resolveBunCompileTarget = (targetTriple: string): string | undefined => {
	if (targetTriple.startsWith("aarch64-apple-darwin"))
		return "bun-darwin-arm64";
	if (targetTriple.startsWith("x86_64-apple-darwin")) return "bun-darwin-x64";
	if (targetTriple.startsWith("x86_64-pc-windows")) return "bun-windows-x64";
	if (targetTriple.startsWith("x86_64-unknown-linux")) return "bun-linux-x64";
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return "bun-linux-arm64";
	return undefined;
};

const main = async () => {
	const targetTriple = await resolveTargetTriple();
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	const outfile = `./src-tauri/bin/code-sidecar-${targetTriple}${extension}`;
	const bunTarget = resolveBunCompileTarget(targetTriple);

	await $`mkdir -p src-tauri/bin`;
	if (bunTarget) {
		await $`bun build ./sidecar/index.ts --compile --target=${bunTarget} --outfile ${outfile}`;
	} else {
		await $`bun build ./sidecar/index.ts --compile --outfile ${outfile}`;
	}

	// The plugin sandbox runs as a subprocess from a bootstrap file on disk.
	// The compiled sidecar can't hand its embedded copy to a child process,
	// and the bundle ships no node_modules, so emit a self-contained bundle
	// (inlines @cline/shared + jiti) that Tauri ships as a resource. main.rs
	// points the sidecar at it via CLINE_PLUGIN_SANDBOX_BOOTSTRAP_PATH.
	// --target=node keeps the bundle runtime-agnostic: the subprocess runtime
	// may be a host node, a host bun, or the compiled sidecar re-executing
	// itself via BUN_BE_BUN=1 (bun-targeted output uses import.meta.require,
	// which breaks under node).
	const bootstrapEntry =
		"../../../sdk/packages/core/src/extensions/plugin/plugin-sandbox-bootstrap.ts";
	await $`mkdir -p src-tauri/resources`;
	await $`bun build ${bootstrapEntry} --target=node --outfile ./src-tauri/resources/plugin-sandbox-bootstrap.js`;

	// jiti's babel transform is a lazily-required asset that does not survive
	// bundling (the bundled fallback requires '../dist/babel.cjs' relative to
	// the bundle). The bootstrap prefers an explicitly resolved transform from
	// a `node_modules/jiti` found next to itself, so ship the minimal jiti
	// package alongside the bootstrap resource.
	// jiti is a dependency of @cline/core, not of this app, so resolve it
	// through core's module tree (it is not hoisted to the workspace root).
	const requireFromHere = createRequire(import.meta.url);
	const requireFromCore = createRequire(requireFromHere.resolve("@cline/core"));
	const jitiPackageDir = dirname(requireFromCore.resolve("jiti/package.json"));
	const jitiResourceDir = "./src-tauri/resources/node_modules/jiti";
	await $`mkdir -p ${join(jitiResourceDir, "dist")}`;
	await $`cp ${join(jitiPackageDir, "package.json")} ${join(jitiResourceDir, "package.json")}`;
	await $`cp ${join(jitiPackageDir, "dist", "babel.cjs")} ${join(jitiResourceDir, "dist", "babel.cjs")}`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
