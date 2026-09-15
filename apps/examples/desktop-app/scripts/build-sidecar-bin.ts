import { spawnSync } from "node:child_process";
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
	return `./src-tauri/bin/code-sidecar-${targetTriple}${extension}`;
};

// linuxdeploy — which Tauri runs to assemble the AppImage — carries its own
// patchelf 0.8 and rewrites the rpath of every ELF in the bundle. On a
// Bun-compiled sidecar that rewrite corrupts the file: the result segfaults on
// launch, and linuxdeploy then cannot even `ldd` it, so the AppImage either
// fails to build or ships a backend that dies on startup. Writing the rpath
// linuxdeploy wants ourselves, with a current patchelf, makes its rewrite a
// no-op and leaves the sidecar byte-identical and runnable.
const setLinuxRpath = (outfile: string): void => {
	// Spawned directly instead of through the bun shell so `$ORIGIN` reaches
	// patchelf as a literal rather than being read as a shell variable.
	const result = spawnSync(
		"patchelf",
		["--set-rpath", "$ORIGIN/../lib", outfile],
		{ encoding: "utf8" },
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			[
				`failed to set the AppImage rpath on ${outfile}`,
				result.error?.message ??
					result.stderr?.trim() ??
					`patchelf exited with code ${result.status}`,
				"patchelf is required to build the Linux desktop app (Debian/Ubuntu: apt-get install patchelf).",
			].join("\n"),
		);
	}
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
	if (targetTriple.includes("linux")) {
		setLinuxRpath(outfile);
	}
	return outfile;
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
		return;
	}
	await buildSidecar(targetTriple);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
