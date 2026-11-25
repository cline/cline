/// <reference types="@types/bun" />
import { writeBundleInputs } from "../../../scripts/third-party-notices/bundle-inputs";

// Externalize third-party runtime deps plus the provider/runtime layer that
// the Agent facade loads dynamically. `@cline/shared` stays bundled.
const external = ["@cline/llms", "nanoid"];
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify,
		sourcemap,
		packages: "bundle",
		external,
	},
];

const results: Bun.BuildOutput[] = [];
for (const config of builds) {
	const result = await Bun.build({ ...config, metafile: true });
	results.push(result);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}

writeBundleInputs("./dist", results);
