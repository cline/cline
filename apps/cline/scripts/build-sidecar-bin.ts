import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { telemetryDefineArgs } from "./telemetry-define-args";

const FORBIDDEN_RUNTIME_INPUT =
	/(?:^|\/)(?:sdk\/packages\/(?:core|sdk)|sdk\/packages\/shared\/src\/hub\.ts|apps\/(?:cline-hub|examples\/desktop-app)|node_modules\/@cline\/(?:core|sdk|cline-hub))(?:\/|$)/;

const verifyBundleBoundary = async (): Promise<void> => {
	const analysisDir = mkdtempSync(join(tmpdir(), "cline-bundle-boundary-"));
	try {
		for (const [name, entrypoint] of [
			["sidecar", "./sidecar/index.ts"],
			["clinegate", "../../sdk/packages/gateway/bin/clinegate.mjs"],
		] as const) {
			const outfile = join(analysisDir, `${name}.js`);
			const metafile = join(analysisDir, `${name}.meta.json`);
			await $`bun build ${entrypoint} --target=bun --outfile=${outfile} --metafile=${metafile}`.quiet();
			const metadata = JSON.parse(readFileSync(metafile, "utf8")) as {
				inputs?: Record<string, unknown>;
			};
			const forbidden = Object.keys(metadata.inputs ?? {}).filter((input) =>
				FORBIDDEN_RUNTIME_INPUT.test(input.replaceAll("\\", "/")),
			);
			if (forbidden.length > 0) {
				throw new Error(
					`${name} bundle crosses the Gateway-only dependency boundary:\n${forbidden.join("\n")}`,
				);
			}
		}
	} finally {
		rmSync(analysisDir, { force: true, recursive: true });
	}
};

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

const gatewayOutfile = (targetTriple: string): string => {
	const extension = targetTriple.includes("windows") ? ".exe" : "";
	return `./src-tauri/bin/clinegate-${targetTriple}${extension}`;
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

const buildGateway = async (targetTriple: string): Promise<string> => {
	const outfile = gatewayOutfile(targetTriple);
	const bunTarget = resolveBunCompileTarget(targetTriple);
	const entry = "../../sdk/packages/gateway/bin/clinegate.mjs";
	if (bunTarget) {
		await $`bun build ${entry} --compile --target=${bunTarget} --outfile ${outfile}`;
	} else {
		await $`bun build ${entry} --compile --outfile ${outfile}`;
	}
	return outfile;
};

// Tauri's universal-apple-darwin pseudo-target lipos the Rust binary itself
// but expects sidecars (externalBin) to already be fat binaries named
// `<name>-universal-apple-darwin`, so build both slices and merge them here.
const buildUniversalMacSidecar = async (): Promise<void> => {
	const arm64 = await buildSidecar("aarch64-apple-darwin");
	const x64 = await buildSidecar("x86_64-apple-darwin");
	const gatewayArm64 = await buildGateway("aarch64-apple-darwin");
	const gatewayX64 = await buildGateway("x86_64-apple-darwin");
	const outfile = sidecarOutfile("universal-apple-darwin");
	const gateway = gatewayOutfile("universal-apple-darwin");
	await $`lipo -create -output ${outfile} ${arm64} ${x64}`;
	await $`lipo -create -output ${gateway} ${gatewayArm64} ${gatewayX64}`;
	await $`chmod +x ${outfile}`;
	await $`chmod +x ${gateway}`;
	await $`lipo -info ${outfile}`;
	await $`lipo -info ${gateway}`;
};

const main = async () => {
	await verifyBundleBoundary();
	const targetTriple = await resolveTargetTriple();
	await $`mkdir -p src-tauri/bin`;
	if (targetTriple === "universal-apple-darwin") {
		await buildUniversalMacSidecar();
	} else {
		await buildSidecar(targetTriple);
		await buildGateway(targetTriple);
	}
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
