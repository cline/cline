import { createHash } from "node:crypto";
import type { ITelemetryService, WorkspaceInfo } from "@clinebot/shared";
import {
	captureWorkspaceInitError,
	captureWorkspaceInitialized,
} from "../telemetry/core-events";

export interface WorkspaceLifecycleTelemetryInput {
	telemetry?: ITelemetryService;
	rootPath: string;
	workspaceInfo?: WorkspaceInfo;
	rootCount?: number;
	vcsType?: "git" | "none";
	vcsTypes?: ReadonlyArray<string>;
	durationMs?: number;
	initError?: { errorType: string; message: string };
	featureFlagEnabled?: boolean;
	isRemoteWorkspace?: boolean;
}

const initializedWorkspaceHashes = new Set<string>();
const initErrorWorkspaceHashes = new Set<string>();

function hashWorkspacePath(rootPath: string): string {
	return createHash("sha256").update(rootPath).digest("hex");
}

function normalizeVcsTypes(
	input: WorkspaceLifecycleTelemetryInput,
): ReadonlyArray<string> {
	if (input.vcsTypes && input.vcsTypes.length > 0) {
		return input.vcsTypes;
	}
	return [input.vcsType === "git" ? "git" : "none"];
}

export function emitWorkspaceLifecycleTelemetry(
	input: WorkspaceLifecycleTelemetryInput,
): void {
	if (!input.telemetry) {
		return;
	}
	const workspaceHash = hashWorkspacePath(input.rootPath);
	const rootCount = input.rootCount ?? 1;
	if (!initializedWorkspaceHashes.has(workspaceHash)) {
		initializedWorkspaceHashes.add(workspaceHash);
		captureWorkspaceInitialized(input.telemetry, {
			root_count: rootCount,
			vcs_types: normalizeVcsTypes(input),
			init_duration_ms: input.durationMs,
			feature_flag_enabled: input.featureFlagEnabled ?? true,
			is_remote_workspace: input.isRemoteWorkspace,
		});
	}

	if (input.initError && !initErrorWorkspaceHashes.has(workspaceHash)) {
		initErrorWorkspaceHashes.add(workspaceHash);
		const error = new Error(input.initError.message);
		error.name = input.initError.errorType || "Error";
		captureWorkspaceInitError(input.telemetry, error, {
			fallback_to_single_root: true,
			workspace_count: rootCount,
		});
	}
}

export function resetWorkspaceTelemetryForTests(): void {
	initializedWorkspaceHashes.clear();
	initErrorWorkspaceHashes.clear();
}
