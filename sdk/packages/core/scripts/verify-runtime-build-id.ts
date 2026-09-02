import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSdkRuntimeBuildIdFromCoreSource } from "../src/hub/discovery/runtime-build-id";

const corePackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildId = resolveSdkRuntimeBuildIdFromCoreSource();
const entrypoints = [
	join(corePackageRoot, "dist", "index.js"),
	join(corePackageRoot, "dist", "hub", "index.js"),
	join(corePackageRoot, "dist", "hub", "daemon", "entry.js"),
];

for (const entrypoint of entrypoints) {
	if (!readFileSync(entrypoint, "utf8").includes(buildId)) {
		throw new Error(`runtime build identity was not embedded in ${entrypoint}`);
	}
}
