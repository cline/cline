import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const RUNTIME_PACKAGE_NAMES = ["shared", "llms", "agents", "core"] as const;
const TEST_DIRECTORY_NAMES = new Set(["__tests__", "fixtures", "tests"]);

function collectRuntimeSourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && TEST_DIRECTORY_NAMES.has(entry.name)) {
			continue;
		}
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectRuntimeSourceFiles(path));
			continue;
		}
		if (
			entry.isFile() &&
			!entry.name.match(/\.(?:test|spec)(?:\.[^.]+)?\.[cm]?[jt]sx?$/)
		) {
			files.push(path);
		}
	}
	return files;
}

/**
 * Fingerprints the code and dependency graph that can execute inside a Hub
 * daemon. Every Core entrypoint built from the same SDK checkout receives the
 * same identity, while runtime changes are detected even when package versions
 * have not been bumped yet.
 */
export function resolveSdkRuntimeBuildId(repoRoot: string): string {
	const packagesRoot = join(repoRoot, "sdk", "packages");
	const inputs = [join(repoRoot, "bun.lock")];

	for (const packageName of RUNTIME_PACKAGE_NAMES) {
		const packageRoot = join(packagesRoot, packageName);
		inputs.push(join(packageRoot, "package.json"));
		const buildScript = join(packageRoot, "bun.mts");
		if (existsSync(buildScript)) {
			inputs.push(buildScript);
		}
		inputs.push(...collectRuntimeSourceFiles(join(packageRoot, "src")));
	}

	const hash = createHash("sha256");
	for (const path of inputs.sort()) {
		const inputName = relative(repoRoot, path).replaceAll("\\", "/");
		hash.update(inputName);
		hash.update("\0");
		hash.update(readFileSync(path));
		hash.update("\0");
	}
	return `sdk-v1-${hash.digest("hex")}`;
}

export function resolveRepoRootFromCorePackage(
	corePackageRoot: string,
): string {
	const packagesRoot = join(corePackageRoot, "..");
	if (basename(packagesRoot) !== "packages") {
		throw new Error(
			`expected Core package under sdk/packages, received ${corePackageRoot}`,
		);
	}
	return join(packagesRoot, "..", "..");
}
