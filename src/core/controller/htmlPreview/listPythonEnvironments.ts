import type { PythonEnvironmentSource as LocalSource } from "@services/artifact-preview/KernelProfile"
import { EmptyRequest } from "@shared/proto/cline/common"
import { PythonEnvironment, PythonEnvironmentListResponse, PythonEnvironmentSource } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

function toProtoSource(source: LocalSource): PythonEnvironmentSource {
	switch (source) {
		case "vscode":
			return PythonEnvironmentSource.PYTHON_ENV_SOURCE_VSCODE
		case "workspace_venv":
			return PythonEnvironmentSource.PYTHON_ENV_SOURCE_WORKSPACE_VENV
		case "aihydro_venv":
			return PythonEnvironmentSource.PYTHON_ENV_SOURCE_AIHYDRO_VENV
		case "custom":
			return PythonEnvironmentSource.PYTHON_ENV_SOURCE_CUSTOM
		default:
			return PythonEnvironmentSource.PYTHON_ENV_SOURCE_PATH
	}
}

export async function listPythonEnvironments(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<PythonEnvironmentListResponse> {
	const svc = _controller.getArtifactKernelService()
	const { environments, activeProfileId } = await svc.listEnvironments()
	return PythonEnvironmentListResponse.create({
		environments: environments.map((e) =>
			PythonEnvironment.create({
				profileId: e.id,
				interpreterPath: e.interpreterPath,
				label: e.label,
				source: toProtoSource(e.source),
				cwd: e.cwd,
			}),
		),
		activeProfileId,
	})
}
