/// <reference types="@types/bun" />
import { writeBundleInputs } from "../../../scripts/third-party-notices/bundle-inputs";

type BuildMode = "package" | "bundle" | "dev";
const rawMode = Bun.env.BUILD_MODE ?? "bundle";
const buildMode: BuildMode =
	rawMode === "bundle" || rawMode === "dev" ? rawMode : "package";

const shouldEmitTypes = buildMode === "package";
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const runBuild = async (
	name: string,
	options: Parameters<typeof Bun.build>[0],
) => {
	const result = await Bun.build({
		...options,
		metafile: true,
		throw: false,
	});

	if (!result.success) {
		throw new Error(`Failed ${name} build`);
	}

	if (result.logs.length > 0) {
		console.warn(`${name} build emitted logs:`);
		for (const log of result.logs) {
			console.warn(log);
		}
	}
	return result;
};

const nodeBuild = await runBuild("node", {
	entrypoints: [
		"./src/index.ts",
		"./src/types/index.ts",
		"./src/automation/index.ts",
		"./src/db/index.ts",
		"./src/node.ts",
		"./src/remote-config/index.ts",
		"./src/storage/index.ts",
	],
	outdir: "./dist",
	target: "node",
	minify,
	sourcemap,
});

const browserBuild = await runBuild("browser", {
	entrypoints: ["./src/index.browser.ts"],
	outdir: "./dist",
	target: "browser",
	minify,
	sourcemap,
	packages: "bundle",
	external: ["zod"],
});

writeBundleInputs("./dist", [nodeBuild, browserBuild]);

if (shouldEmitTypes) {
	const tsc = Bun.spawn(
		["bun", "tsc", "--emitDeclarationOnly", "--project", "tsconfig.build.json"],
		{
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	const exitCode = await tsc.exited;
	if (exitCode !== 0) {
		throw new Error(`Declaration build failed with exit code ${exitCode}`);
	}
}
