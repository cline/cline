/// <reference types="@types/bun" />
export {};

// Externalize workspace deps so dist does not duplicate @cline/shared.
// Architecture gate: source must import @cline/shared type-only (see import-boundary.test.ts).
const external = ["@cline/shared"];
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		format: "esm",
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

	if (!result.success) {
		throw new Error("@cline/drive build failed");
	}
}
