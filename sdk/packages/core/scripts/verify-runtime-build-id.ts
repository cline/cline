import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveRepoRootFromCorePackage,
	resolveSdkRuntimeBuildId,
} from "./runtime-build-id";

const corePackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildId = resolveSdkRuntimeBuildId(
	resolveRepoRootFromCorePackage(corePackageRoot),
);
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

// Every public subpath must ship both its runtime file and its declarations.
const manifest = JSON.parse(
	readFileSync(join(corePackageRoot, "package.json"), "utf8"),
) as { exports: Record<string, { types: string; import: string }> };
for (const entry of Object.values(manifest.exports)) {
	for (const path of [entry.types, entry.import])
		readFileSync(join(corePackageRoot, path));
}
