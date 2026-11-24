import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Records every module a Vite production build bundled, for a later notices step. Write it
// outside the build's output directory so the list itself never ships.
export function recordBundleInputs(outFile: string) {
	return {
		name: "record-bundle-inputs",
		apply: "build" as const,
		generateBundle(this: { getModuleIds(): IterableIterator<string> }) {
			mkdirSync(dirname(outFile), { recursive: true });
			writeFileSync(outFile, JSON.stringify([...this.getModuleIds()]));
		},
	};
}
