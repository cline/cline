/// <reference types="@types/bun" />
import { rmSync } from "node:fs";

rmSync(new URL("./dist/", import.meta.url), { recursive: true, force: true });

type PackageManifest = { dependencies?: Record<string, string> };
const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;
const external = Object.keys(packageJson.dependencies ?? {});

for (const [entrypoint, outdir] of [
	["./src/index.ts", "./dist"],
	["./src/entry.ts", "./dist"],
] as const) {
	const result = await Bun.build({
		entrypoints: [entrypoint],
		outdir,
		target: "node",
		format: "esm",
		minify: Bun.env.CLINE_SOURCEMAPS !== "1",
		sourcemap: Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none",
		packages: "bundle",
		external,
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}
}
