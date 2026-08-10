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

const binaryOutfile = (
	name: "code-sidecar" | "code-hub",
	targetTriple: string,
): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `./src-tauri/bin/${name}-${targetTriple}${extension}`;
};

const buildCompiledBinary = async (
	name: "code-sidecar" | "code-hub",
	entrypoint: string,
	targetTriple: string,
): Promise<string> => {
	const outfile = binaryOutfile(name, targetTriple);
	const bunTarget = resolveBunCompileTarget(targetTriple);
	// Telemetry config must be inlined into the compiled binary: a packaged
	// app launched from Finder/the Dock has no OTEL_* env at runtime, so
	// without this the sidecar silently ships with telemetry disabled.
	// Verify with `<binary> --telemetry-selfcheck` after building.
	const defines = telemetryDefineArgs();
	if (bunTarget) {
		await $`bun build ${entrypoint} --compile --target=${bunTarget} ${defines} --outfile ${outfile}`;
	} else {
		await $`bun build ${entrypoint} --compile ${defines} --outfile ${outfile}`;
	}
	return outfile;
};

const buildTargetBinaries = async (
	targetTriple: string,
): Promise<{ sidecar: string; hub: string }> => ({
	sidecar: await buildCompiledBinary(
		"code-sidecar",
		"./sidecar/index.ts",
		targetTriple,
	),
	hub: await buildCompiledBinary(
		"code-hub",
		"../../../sdk/packages/hub-daemon/src/entry.ts",
		targetTriple,
	),
});

// Tauri's universal-apple-darwin pseudo-target lipos the Rust binary itself
// but expects sidecars (externalBin) to already be fat binaries named
// `<name>-universal-apple-darwin`, so build both slices and merge them here.
const buildUniversalMacBinaries = async (): Promise<void> => {
	const arm64 = await buildTargetBinaries("aarch64-apple-darwin");
	const x64 = await buildTargetBinaries("x86_64-apple-darwin");
	for (const name of ["code-sidecar", "code-hub"] as const) {
		const key = name === "code-sidecar" ? "sidecar" : "hub";
		const outfile = binaryOutfile(name, "universal-apple-darwin");
		await $`lipo -create -output ${outfile} ${arm64[key]} ${x64[key]}`;
		await $`chmod +x ${outfile}`;
		await $`lipo -info ${outfile}`;
	}
};

const main = async () => {
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p src-tauri/bin`;
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacBinaries();
		return;
	}
	await buildTargetBinaries(targetTriple);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
