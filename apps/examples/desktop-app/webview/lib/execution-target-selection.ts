export const EXECUTION_TARGET_STORAGE_KEY = "cline.code.execution-target.v1";

export type ExecutionTarget = "local" | "cloud";

/**
 * Last Cloud/Local pick, plus the model, repository and branch last picked
 * while on Cloud. Cloud picks are kept apart from `lastModelByProvider` and
 * the workspace memory because the cloud catalog and repos differ from the
 * local ones.
 */
export type ExecutionTargetSelection = {
	target: ExecutionTarget;
	cloudModel: string;
	cloudRepoUrl: string;
	cloudBranch: string;
};

const EMPTY_SELECTION: ExecutionTargetSelection = {
	target: "local",
	cloudModel: "",
	cloudRepoUrl: "",
	cloudBranch: "",
};

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function parseExecutionTargetSelection(
	raw: string | null,
): ExecutionTargetSelection {
	if (!raw) {
		return { ...EMPTY_SELECTION };
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { ...EMPTY_SELECTION };
		}
		const shaped = parsed as Record<string, unknown>;
		const cloudRepoUrl = stringField(shaped.cloudRepoUrl);
		return {
			target: shaped.target === "cloud" ? "cloud" : "local",
			cloudModel: stringField(shaped.cloudModel),
			cloudRepoUrl,
			// A branch only means something for the repo it was picked in.
			cloudBranch: cloudRepoUrl ? stringField(shaped.cloudBranch) : "",
		};
	} catch {
		return { ...EMPTY_SELECTION };
	}
}

export function readExecutionTargetSelectionFromWindow(): ExecutionTargetSelection {
	if (typeof window === "undefined") {
		return { ...EMPTY_SELECTION };
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

/** Changing the repo drops the remembered branch until one is picked for it. */
export function writeCloudRepoUrlToWindow(cloudRepoUrl: string): void {
	const current = readExecutionTargetSelectionFromWindow();
	const next = cloudRepoUrl.trim();
	writeExecutionTargetSelectionToWindow({
		...current,
		cloudRepoUrl: next,
		cloudBranch: next === current.cloudRepoUrl ? current.cloudBranch : "",
	});
}

export function writeCloudBranchToWindow(cloudBranch: string): void {
	writeExecutionTargetSelectionToWindow({
		...readExecutionTargetSelectionFromWindow(),
		cloudBranch: cloudBranch.trim(),
	});
}
