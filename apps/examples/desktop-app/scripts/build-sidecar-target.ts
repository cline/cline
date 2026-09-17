// Bun cross-compiles --compile binaries, so a CI runner can produce the
// sidecar for a different architecture than its own (e.g. the x86_64 macOS
// bundle from an arm64 runner). Without an explicit --target, bun always
// emits a host-arch binary even when Tauri is building for another triple.
export const resolveBunCompileTarget = (
	targetTriple: string,
): string | undefined => {
	if (targetTriple.startsWith("aarch64-apple-darwin"))
		return "bun-darwin-arm64";
	if (targetTriple.startsWith("x86_64-apple-darwin")) return "bun-darwin-x64";
	if (targetTriple.startsWith("x86_64-pc-windows"))
		return "bun-windows-x64-baseline";
	if (targetTriple.startsWith("x86_64-unknown-linux")) return "bun-linux-x64";
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return "bun-linux-arm64";
	return undefined;
};
