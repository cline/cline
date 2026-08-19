/// <reference types="@types/bun" />
export {};

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	minify: Bun.env.CLINE_SOURCEMAPS !== "1",
	sourcemap: Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none",
	packages: "bundle",
	external: ["@cline/shared"],
});
for (const log of result.logs) console.warn(log);
