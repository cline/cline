/// <reference types="@types/bun" />
export {};

type BuildMode = "package" | "bundle" | "dev";
const rawMode = Bun.env.BUILD_MODE ?? "bundle";
const buildMode: BuildMode =
	rawMode === "bundle" || rawMode === "dev" ? rawMode : "package";

const shouldEmitTypes = buildMode === "package";
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	// `browser` keeps the published graph free of node builtin shims; the pairing
	// layer only relies on globalThis.crypto.getRandomValues and TextEncoder,
	// which exist on Node 22, browsers and React Native (Hermes + polyfill).
	target: "browser",
	format: "esm",
	minify,
	sourcemap,
	external: ["@noble/ciphers", "@noble/curves", "@noble/hashes"],
	throw: false,
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	throw new Error("Failed @cline/hub-pairing build");
}

if (shouldEmitTypes) {
	const tsc = Bun.spawn(
		["bun", "tsc", "--emitDeclarationOnly", "--project", "tsconfig.build.json"],
		{ stdout: "inherit", stderr: "inherit" },
	);
	const exitCode = await tsc.exited;
	if (exitCode !== 0) {
		throw new Error(`Declaration build failed with exit code ${exitCode}`);
	}
}
