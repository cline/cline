import { fileURLToPath } from "node:url";
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
	// SSH hosts may predate AVX2 (e.g. Ivy Bridge Xeons). The default Bun
	// x64 runtime can SIGILL before our entrypoint runs on those CPUs.
	if (targetTriple.startsWith("x86_64-unknown-linux"))
		return "bun-linux-x64-baseline";
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return "bun-linux-arm64";
	return undefined;
};

const sidecarOutfile = (targetTriple: string): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `./src-tauri/bin/code-sidecar-${targetTriple}${extension}`;
};

const buildSidecar = async (
	targetTriple: string,
	outfile = sidecarOutfile(targetTriple),
	entrypoint = "./sidecar/index.ts",
	minify = false,
): Promise<string> => {
	const bunTarget = resolveBunCompileTarget(targetTriple);
	// Telemetry config must be inlined into the compiled binary: a packaged
	// app launched from Finder/the Dock has no OTEL_* env at runtime, so
	// without this the sidecar silently ships with telemetry disabled.
	// Verify with `<binary> --telemetry-selfcheck` after building.
	const defines = telemetryDefineArgs();
	const optimizationArgs = minify ? ["--minify"] : [];
	// A compiled Bun executable otherwise reads .env and bunfig.toml from its
	// launch directory before our entrypoint runs. Remote helpers are launched
	// from an SSH user's home directory, so that behavior can both make the
	// helper fail on an unrelated dotenv file and leak workspace credentials
	// into the Hub process. Packaged binaries must depend only on their explicit
	// process environment and compiled configuration.
	const runtimeIsolationArgs = [
		"--no-compile-autoload-dotenv",
		"--no-compile-autoload-bunfig",
		// Bun only trusts its bundled Mozilla roots on macOS/Windows, so TLS to
		// intranet endpoints signed by a corporate CA (LiteLLM proxies, MITM
		// firewalls) fails with "unable to get local issuer certificate". Bake
		// --use-system-ca into the runtime so the sidecar and the Hub daemon it
		// re-executes from this binary also trust the OS Keychain/cert store,
		// matching the CLI wrapper's OS trust-anchor harvesting.
		"--compile-exec-argv=--use-system-ca",
	];
	if (bunTarget) {
		await $`bun build ${entrypoint} --compile --target=${bunTarget} ${runtimeIsolationArgs} ${optimizationArgs} ${defines} --outfile ${outfile}`;
	} else {
		await $`bun build ${entrypoint} --compile ${runtimeIsolationArgs} ${optimizationArgs} ${defines} --outfile ${outfile}`;
	}
	return outfile;
};

// Each compiled helper embeds a full Bun runtime (~100 MB) around ~14 MB of
// our code, and both helpers ship inside every desktop bundle. UPX packs the
// ELF in place to about a quarter of its size and it self-extracts in memory on
// launch (measured: ~1.6 s extra startup, ~55 MB extra RSS on the Hub daemon),
// so nothing downstream changes: the installer, the SSH upload, and the remote
// run all see one ordinary executable. `strip` is not an option here; it
// discards Bun's appended module payload. Requires upx on PATH; the publish
// workflow installs it on every runner.
const compressRemoteHelper = async (outfile: string): Promise<void> => {
	if (!Bun.which("upx")) {
		if (process.env.CI) {
			throw new Error(
				`upx is required to compress ${outfile} but was not found on PATH`,
			);
		}
		console.warn(
			`upx not found on PATH; leaving ${outfile} uncompressed (only the packaged size is affected)`,
		);
		return;
	}
	await $`upx --best --lzma -q ${outfile}`;
};

// SSH environments run the same Hub build as the desktop in a dedicated
// bootstrap/daemon binary. It intentionally excludes the desktop HTTP server,
// command router, and UI backend. Linux x64 and arm64 cover common SSH hosts.
// macOS helpers are deliberately not bundled: they are Mach-O files under
// Contents/Resources, which Tauri does not codesign, and any unsigned Mach-O
// in the bundle fails notarization. Mac remotes are served from a macOS
// desktop by its own signed sidecar instead (sidecar/remote-helper.ts).
//
// On a Windows host, Bun fails to extract the downloaded Linux runtime these
// cross-compiles need ("Failed to extract executable for 'bun-linux-x64-…'").
// Bun skips the download when `$BUN_INSTALL_CACHE_DIR/bun-<target>-v<version>`
// already exists, so seed those two files from the @oven/bun-<target> npm
// packages first; desktop-publish.yml does exactly that in its Windows job.
const buildRemoteHelpers = async (): Promise<void> => {
	for (const targetTriple of [
		"x86_64-unknown-linux-gnu",
		"aarch64-unknown-linux-gnu",
	]) {
		const outfile = await buildSidecar(
			targetTriple,
			`./src-tauri/bin/remote-helpers/cline-remote-helper-${targetTriple}`,
			"../../../sdk/packages/core/dist/remote/remote-helper-entry.js",
			true,
		);
		await compressRemoteHelper(outfile);
	}
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
	// All compiled helpers and the sidecar depend on fresh SDK package exports.
	await $`bun run build:sdk`.cwd(
		fileURLToPath(new URL("../../../../", import.meta.url)),
	);
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p src-tauri/bin src-tauri/bin/remote-helpers`;
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacSidecar();
	} else {
		await buildSidecar(targetTriple);
	}
	await buildRemoteHelpers();
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
