/// <reference types="@types/bun" />
export {};

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	sourcemap,
});

if (!result.success) {
	console.error("Build failed for enterprise package");
	process.exit(1);
}

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
