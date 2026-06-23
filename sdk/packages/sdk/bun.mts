export {};

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	minify: true,
	packages: "bundle",
	sourcemap,
	external: ["@cline/core"],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
