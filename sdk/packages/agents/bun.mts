/// <reference types="@types/bun" />
export {};

// Externalize third-party runtime deps plus the provider/runtime layer that
// the Agent facade loads dynamically. `@cline/shared` stays bundled.
const external = ["@cline/llms", "nanoid"];
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
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
