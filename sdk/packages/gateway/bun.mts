/// <reference types="@types/bun" />
export {};

const external = [
	"@cline/bot",
	"@cline/engine",
	"@cline/shared",
	"@cline/shared/gateway",
	"@cline/tools",
	"ws",
	"zod",
];
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const result = await Bun.build({
	entrypoints: ["./src/index.ts", "./src/client.ts", "./src/test-support.ts"],
	outdir: "./dist",
	target: "node",
	minify,
	sourcemap,
	packages: "bundle",
	external,
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
