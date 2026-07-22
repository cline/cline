import { mkdir } from "node:fs/promises";
import { resolveTemporaryWorkspacePath } from "@cline/shared/storage";
import type {
	RuntimeSessionConfig,
	StartSessionConfig,
} from "../../runtime/host/runtime-host";

export async function createTemporaryWorkspace(
	sessionId: string,
): Promise<string> {
	const workspacePath = resolveTemporaryWorkspacePath(sessionId);
	await mkdir(workspacePath, { recursive: true, mode: 0o700 });
	return workspacePath;
}

/** Resolve the optional workspace fields at the execution-host boundary. */
export async function resolveStartSessionWorkspace(
	config: StartSessionConfig,
	sessionId: string,
): Promise<RuntimeSessionConfig> {
	const requestedCwd = config.cwd?.trim() ?? "";
	const requestedRoot = config.workspaceRoot?.trim() ?? "";
	const workspacePath =
		requestedCwd ||
		requestedRoot ||
		(await createTemporaryWorkspace(sessionId));

	return {
		...config,
		cwd: requestedCwd || workspacePath,
		workspaceRoot: requestedRoot || workspacePath,
	};
}
