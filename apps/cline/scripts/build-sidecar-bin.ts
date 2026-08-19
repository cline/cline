import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { telemetryDefineArgs } from "./telemetry-define-args";

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

const sidecarOutfile = (targetTriple: string): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `./src-tauri/bin/cline-sidecar-${targetTriple}${extension}`;
};

const buildSidecar = async (targetTriple: string): Promise<string> => {
	const outfile = sidecarOutfile(targetTriple);
	const bunTarget = resolveBunCompileTarget(targetTriple);
	// Telemetry config must be inlined into the compiled binary: a packaged
	// app launched from Finder/the Dock has no OTEL_* env at runtime, so
	// without this the sidecar silently ships with telemetry disabled.
	// Verify with `<binary> --telemetry-selfcheck` after building.
	const defines = telemetryDefineArgs();
	if (bunTarget) {
		await $`bun build ./sidecar/index.ts --compile --target=${bunTarget} ${defines} --outfile ${outfile}`;
	} else {
		await $`bun build ./sidecar/index.ts --compile ${defines} --outfile ${outfile}`;
	}
	return outfile;
};

const SDK_CORE_DIR = "../../sdk/packages/core";
const SDK_SHARED_DIR = "../../sdk/packages/shared";
const EXTENSIONS_DIR = "src-tauri/extensions";

/**
 * Vendors the SDK's plugin-sandbox bootstrap - plus its own runtime
 * dependencies (jiti, @cline/shared) - as a sibling of the compiled sidecar
 * binary.
 *
 * A `bun build --compile`d sidecar has no real on-disk `import.meta.url`
 * (it resolves to a synthetic in-binary path), so the SDK's own plugin
 * loader (sdk/packages/core/src/extensions/plugin/plugin-sandbox.ts,
 * resolveBootstrap) can't find its bootstrap script relative to itself the
 * way it does when running from source. Its one remaining fallback,
 * resolveBootstrapFromExecutable, looks for a real file at exactly
 * `<execPath>/../../extensions/plugin-sandbox-bootstrap.js` - so that's
 * where this places a real copy, dereferencing workspace symlinks (cpSync's
 * default `dereference: true`) so the copies are self-contained rather than
 * pointing back at paths the sandboxed process (launcher.ts's allowRead)
 * has no access to.
 *
 * Without this, EVERY plugin - not just an app-bundled one - silently fails
 * to load in a compiled sidecar build: `resolveBootstrap()` falls back to
 * building an inline jiti script around a bootstrap path that doesn't
 * exist on disk, so plugin loading throws "Cannot find module" errors that
 * only surface deep in the Hub daemon's own log, not the caller's.
 */
const vendorPluginSandboxRuntime = (): void => {
	const bootstrapSrc = join(
		SDK_CORE_DIR,
		"dist",
		"extensions",
		"plugin-sandbox-bootstrap.js",
	);
	if (!existsSync(bootstrapSrc)) {
		throw new Error(
			`plugin-sandbox-bootstrap.js not found at ${bootstrapSrc} - run "bun run build:sdk" first`,
		);
	}
	cpSync(bootstrapSrc, join(EXTENSIONS_DIR, "plugin-sandbox-bootstrap.js"));

	const requireFromCore = createRequire(
		join(process.cwd(), SDK_CORE_DIR, "package.json"),
	);
	const jitiDir = dirname(requireFromCore.resolve("jiti/package.json"));
	cpSync(jitiDir, join(EXTENSIONS_DIR, "node_modules", "jiti"), {
		recursive: true,
		dereference: true,
	});

	cpSync(
		SDK_SHARED_DIR,
		join(EXTENSIONS_DIR, "node_modules", "@cline", "shared"),
		{ recursive: true, dereference: true },
	);
};

// Tauri's universal-apple-darwin pseudo-target lipos the Rust binary itself
// but expects sidecars (externalBin) to already be fat binaries named
// `<name>-universal-apple-darwin`, so build both slices and merge them here.
const buildUniversalMacSidecar = async (): Promise<void> => {
	const arm64 = await buildSidecar("aarch64-apple-darwin");
	const x64 = await buildSidecar("x86_64-apple-darwin");
	const outfile = sidecarOutfile("universal-apple-darwin");
	await $`lipo -create -output ${outfile} ${arm64} ${x64}`;
	await $`chmod +x ${outfile}`;
	await $`lipo -info ${outfile}`;
};

const main = async () => {
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p src-tauri/bin`;
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacSidecar();
	} else {
		await buildSidecar(targetTriple);
	}
	vendorPluginSandboxRuntime();
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
