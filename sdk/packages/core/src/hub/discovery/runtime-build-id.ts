import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_PACKAGE_NAMES = ["shared", "llms", "agents", "core"] as const;
const TEST_DIRECTORY_NAMES = new Set(["__tests__", "fixtures", "tests"]);

export interface SdkRuntimeSourceIdentity {
	buildId: string;
	buildEpochMs: number;
}

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
export function resolveSdkRuntimeSourceIdentity(
	repoRoot: string,
): SdkRuntimeSourceIdentity {
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
	let buildEpochMs = 0;
	for (const path of inputs.sort()) {
		const inputName = relative(repoRoot, path).replaceAll("\\", "/");
		hash.update(inputName);
		hash.update("\0");
		hash.update(readFileSync(path));
		hash.update("\0");
		buildEpochMs = Math.max(buildEpochMs, Math.floor(statSync(path).mtimeMs));
	}
	return {
		// Keep timestamped source-graph builds ordered after both the legacy
		// `source-<package-version>` identity and the short-lived hash-only v2
		// identity, allowing the first v3 client to replace either daemon.
		buildId: `source-v3-${hash.digest("hex")}`,
		buildEpochMs,
	};
}

export function resolveSdkRuntimeBuildId(repoRoot: string): string {
	return resolveSdkRuntimeSourceIdentity(repoRoot).buildId;
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

/** Resolve the SDK fingerprint while executing Core directly from source. */
export function resolveSdkRuntimeBuildIdFromCoreSource(): string {
	return resolveSdkRuntimeSourceIdentityFromCoreSource().buildId;
}

export function resolveSdkRuntimeSourceIdentityFromCoreSource(): SdkRuntimeSourceIdentity {
	const corePackageRoot = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
	);
	return resolveSdkRuntimeSourceIdentity(
		resolveRepoRootFromCorePackage(corePackageRoot),
	);
}
