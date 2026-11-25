import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Excluded from the published packages; products that bundle the dist read it when generating notices.
export const BUNDLE_INPUTS = "bundle-inputs.json";

/** Records every file a package's Bun.build calls (with `metafile: true`) bundled into its dist. */
export function writeBundleInputs(
	distDir: string,
	results: Bun.BuildOutput[],
): void {
	const inputs = results.flatMap((result) =>
		Object.keys(result.metafile?.inputs ?? {}).map((input) => resolve(input)),
	);
	writeFileSync(
		join(distDir, BUNDLE_INPUTS),
		JSON.stringify([...new Set(inputs)]),
	);
}
