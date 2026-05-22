import { type ProbePythonEnvironmentRequest, ProbePythonEnvironmentResponse } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."
import { ensurePythonExecutionAllowed } from "./ensurePythonExecutionAllowed"

export async function probePythonEnvironment(
	controller: Controller,
	request: ProbePythonEnvironmentRequest,
): Promise<ProbePythonEnvironmentResponse> {
	const allowed = await ensurePythonExecutionAllowed()
	if (!allowed) {
		return ProbePythonEnvironmentResponse.create({
			status: "denied",
			error: "Python execution was denied.",
		})
	}

	const artifactId = request.artifactId?.trim() || ""
	if (!artifactId) {
		return ProbePythonEnvironmentResponse.create({
			status: "error",
			error: "artifact_id is required for environment probe",
		})
	}

	try {
		const result = await controller
			.getArtifactKernelService()
			.probeEnvironment(artifactId, request.profileId?.trim() || undefined)
		return ProbePythonEnvironmentResponse.create({
			stdout: result.stdout,
			stderr: result.stderr,
			status: result.status,
			error: result.error,
		})
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		return ProbePythonEnvironmentResponse.create({
			status: "error",
			error: msg,
		})
	}
}
