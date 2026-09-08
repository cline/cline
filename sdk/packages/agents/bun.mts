/// <reference types="@types/bun" />
export {};

// Externalize third-party runtime deps plus the provider/runtime layer that
// the Agent facade loads dynamically. `@cline/shared` stays bundled.
type PackageManifest = {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;

const sharedPackageJson = (await Bun.file(
	new URL("../shared/package.json", import.meta.url),
).json()) as PackageManifest;

const external = Object.keys({
	...(packageJson.dependencies ?? {}),
	...(packageJson.peerDependencies ?? {}),
	...(sharedPackageJson.dependencies ?? {}),
	...(sharedPackageJson.peerDependencies ?? {}),
}).filter((name) => !name.startsWith("@cline/"));
if (!external.includes("@cline/llms")) {
	external.push("@cline/llms");
}

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify,
		sourcemap,
		packages: "bundle",
		external,
	},
];

for (const config of builds) {
	const result = await Bun.build(config);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
