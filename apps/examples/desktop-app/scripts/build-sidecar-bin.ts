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
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
