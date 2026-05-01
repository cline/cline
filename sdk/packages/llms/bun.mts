/// <reference types="@types/bun" />
export {};

type PackageManifest = {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";

// Keep published third-party runtime packages external, but bundle internal workspace code.
const external = Object.keys({
	...(packageJson.dependencies ?? {}),
	...(packageJson.peerDependencies ?? {}),
}).filter((name) => !name.startsWith("@clinebot/"));

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts", "./src/models.ts", "./src/providers.ts"],
		outdir: "./dist",
		target: "node",
		external,
		packages: "bundle",
		minify: true,
		sourcemap,
	},
	{
		entrypoints: ["./src/index.browser.ts", "./src/providers.browser.ts"],
		outdir: "./dist",
		target: "browser",
		external,
		packages: "bundle",
		minify: true,
		sourcemap,
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
