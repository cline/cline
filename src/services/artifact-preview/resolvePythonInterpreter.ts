import { resolveDefaultProfile } from "./discoverPythonEnvironments"

/**
 * Resolve the active Python interpreter for artifact kernels.
 * @deprecated Prefer discoverPythonEnvironments() / ArtifactKernelService.resolveProfile()
 */
export async function resolvePythonInterpreter(): Promise<string> {
	const profile = await resolveDefaultProfile()
	if (!profile) {
		throw new Error(
			"No Python interpreter found. Set aihydro.htmlPreview.pythonInterpreter, select a VS Code interpreter, or create .aihydro/venv in the workspace.",
		)
	}
	return profile.interpreterPath
}
