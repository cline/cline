export const EXECUTION_TARGET_STORAGE_KEY = "cline.code.execution-target.v1";

export type ExecutionTarget = "local" | "cloud";

/**
 * Last Cloud/Local pick, plus the model last picked while on Cloud. Cloud
 * picks are kept apart from `lastModelByProvider` because the cloud catalog
 * differs from the local Cline one.
 */
export type ExecutionTargetSelection = {
	target: ExecutionTarget;
	cloudModel: string;
};

export function parseExecutionTargetSelection(
	raw: string | null,
): ExecutionTargetSelection {
	const empty: ExecutionTargetSelection = { target: "local", cloudModel: "" };
	if (!raw) {
		return empty;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return empty;
		}
		const shaped = parsed as { target?: unknown; cloudModel?: unknown };
		return {
			target: shaped.target === "cloud" ? "cloud" : "local",
			cloudModel:
				typeof shaped.cloudModel === "string" ? shaped.cloudModel.trim() : "",
		};
	} catch {
		return empty;
	}
}

export function readExecutionTargetSelectionFromWindow(): ExecutionTargetSelection {
	if (typeof window === "undefined") {
		return { target: "local", cloudModel: "" };
	}
	return parseExecutionTargetSelection(
		window.localStorage.getItem(EXECUTION_TARGET_STORAGE_KEY),
	);
}

function writeExecutionTargetSelectionToWindow(
	value: ExecutionTargetSelection,
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			EXECUTION_TARGET_STORAGE_KEY,
			JSON.stringify(value),
		);
	} catch {
		// Ignore localStorage persistence failures.
	}
}

export function writeExecutionTargetToWindow(target: ExecutionTarget): void {
	writeExecutionTargetSelectionToWindow({
		...readExecutionTargetSelectionFromWindow(),
		target,
	});
}

export function writeCloudModelToWindow(cloudModel: string): void {
	writeExecutionTargetSelectionToWindow({
		...readExecutionTargetSelectionFromWindow(),
		cloudModel: cloudModel.trim(),
	});
}
