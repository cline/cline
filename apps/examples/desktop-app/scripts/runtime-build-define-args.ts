export interface RuntimeBuildIdentity {
	buildId: string;
	buildEpochMs: number;
}

/**
 * `--define` argument pairs that make Core's managed-Hub identity part of the
 * compiled desktop sidecar. The desktop tsconfig resolves `@cline/core` to
 * source, so the defines produced by Core's own package build do not reach the
 * final executable unless the sidecar build supplies them too.
 */
export function runtimeBuildDefineArgs(
	identity: RuntimeBuildIdentity,
): string[] {
	const buildId = identity.buildId.trim();
	if (!buildId) {
		throw new Error("runtime build ID must not be empty");
	}
	if (!Number.isFinite(identity.buildEpochMs) || identity.buildEpochMs <= 0) {
		throw new Error("runtime build epoch must be a positive finite number");
	}

	return [
		"--define",
		`__CLINE_CORE_RUNTIME_BUILD_ID__=${JSON.stringify(buildId)}`,
		"--define",
		`__CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__=${JSON.stringify(identity.buildEpochMs)}`,
	];
}
