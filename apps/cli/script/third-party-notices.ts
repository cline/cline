import { resolve } from "node:path";
import { bunRuntimeEntries } from "../../../scripts/third-party-notices/bun-runtime";
import {
	generateNotices,
	PLUGIN_RUNTIME_INPUTS,
} from "../../../scripts/third-party-notices/index";

const rootDir = resolve(import.meta.dir, "../../..");

/** Writes the notices for one compiled CLI executable: its bundle, embedded assets, and the Bun runtime. */
export function writeCliThirdPartyNotices(options: {
	product: string;
	bundleInputs: string[];
	outFile: string;
}): void {
	generateNotices({
		product: options.product,
		inputs: options.bundleInputs,
		baseDir: rootDir,
		// Directories compile.assets embeds unchanged.
		inputLists: {
			dashboard: resolve(rootDir, "apps/cline-hub/dist/webview-inputs.json"),
			"plugin runtime": PLUGIN_RUNTIME_INPUTS,
		},
		extraEntries: bunRuntimeEntries(options.product),
		outFile: options.outFile,
	});
}
