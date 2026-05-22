import { ArtifactCodeLanguage, type RunArtifactCodeRequest, RunArtifactCodeResponse } from "@shared/proto/cline/html_preview"
import { mapRunResultToOutputs } from "@/services/artifact-preview/mapRunResultToOutputs"
import { executeWorkspacePython } from "@/services/artifact-preview/workspacePythonExecution"
import type { Controller } from ".."
import { ensurePythonExecutionAllowed } from "./ensurePythonExecutionAllowed"

/**
 * Execute Python code in a persistent kernel for an HTML artifact preview.
 */
export async function runArtifactCode(controller: Controller, request: RunArtifactCodeRequest): Promise<RunArtifactCodeResponse> {
	const artifactId = request.artifactId?.trim() || ""
	const code = request.code ?? ""
	const profileId = request.profileId?.trim() || ""
	const cellId = request.cellId?.trim() || ""

	if (request.language !== ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON) {
		return RunArtifactCodeResponse.create({
			status: "error",
			error: "Only Python execution is supported in v1",
		})
	}

	if (!artifactId) {
		return RunArtifactCodeResponse.create({
			status: "error",
			error: "artifact_id is required. Refresh the HTML Preview panel.",
		})
	}

	if (!code.trim()) {
		return RunArtifactCodeResponse.create({
			status: "error",
			error: "code is empty",
		})
	}

	const allowed = await ensurePythonExecutionAllowed()
	if (!allowed) {
		return RunArtifactCodeResponse.create({
			status: "denied",
			error: "Python execution was denied. Trust the workspace, set aihydro.htmlPreview.pythonExecution to always, or click Allow when prompted.",
		})
	}

	const ref = controller.getArtifactPreviewService().get(artifactId)
	if (!ref) {
		return RunArtifactCodeResponse.create({
			status: "error",
			error: `Unknown artifact: ${artifactId}. Refresh the HTML Preview panel.`,
		})
	}

	try {
		const svc = controller.getArtifactKernelService()
		const result = await executeWorkspacePython(svc, code, {
			artifactId,
			profileId: profileId || undefined,
			cellId: cellId || undefined,
		})
		const info = await svc.getInfoOrDefault(artifactId, profileId || undefined)
		const protoStatus = result.status === "ok" ? "success" : result.status === "interrupted" ? "interrupted" : result.status
		return RunArtifactCodeResponse.create({
			stdout: result.stdout,
			stderr: result.stderr,
			status: protoStatus,
			error: result.error,
			resultRepr: result.resultRepr,
			imagesPngBase64: result.imagesPngBase64,
			cellId,
			executionCount: info.executionCount,
			outputs: mapRunResultToOutputs(result),
			truncated: result.truncated,
			provenanceId: result.provenanceId ?? "",
		})
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		return RunArtifactCodeResponse.create({
			status: "error",
			error: msg,
		})
	}
}
