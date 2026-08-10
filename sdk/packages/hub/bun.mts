/// <reference types="@types/bun" />
import { rmSync } from "node:fs";

rmSync(new URL("./dist/", import.meta.url), { recursive: true, force: true });

type PackageManifest = {
	dependencies?: Record<string, string>;
};

const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	minify: Bun.env.CLINE_SOURCEMAPS !== "1",
	sourcemap: Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none",
	packages: "bundle",
	external: Object.keys(packageJson.dependencies ?? {}),
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}
