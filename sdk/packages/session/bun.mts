/// <reference types="@types/bun" />
export {};

type PackageManifest = {
	dependencies?: Record<string, string>;
};

const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;

// Keep declared runtime packages external so they are not duplicated inside the
// bundle and installed again from package.json.
const external = Object.keys(packageJson.dependencies ?? {});

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	minify,
	packages: "bundle",
	sourcemap,
	external,
});

if (!result.success) {
	console.error("Build failed for entrypoints:", ["./src/index.ts"]);
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
