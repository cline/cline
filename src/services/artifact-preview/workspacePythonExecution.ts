import type { ArtifactKernelService, RunArtifactCodeResult } from "./ArtifactKernelService"

export interface WorkspacePythonExecutionOptions {
	artifactId: string
	profileId?: string
	timeoutMs?: number
	cellId?: string
}

/**
 * Workspace-scoped Python execution via the persistent HTML Preview kernel.
 * HTML Preview gRPC and future MCP `run_python` (REFACTOR_ROADMAP T2.4) should call this
 * so cwd, interpreter discovery, and session lifetime stay aligned.
 */
export async function executeWorkspacePython(
	kernelService: ArtifactKernelService,
	code: string,
	options: WorkspacePythonExecutionOptions,
): Promise<RunArtifactCodeResult> {
	return kernelService.execute(code, options.artifactId, options.profileId, options.timeoutMs, options.cellId)
}
