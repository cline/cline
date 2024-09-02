import * as vscode from "vscode"

export async function getPythonEnvPath(): Promise<string | undefined> {
	const pythonExtension = vscode.extensions.getExtension("ms-python.python")

	if (!pythonExtension) {
		return undefined
	}

	// Ensure the Python extension is activated
	if (!pythonExtension.isActive) {
		// if the python extension is not active, we can assume the project is not a python project
		return undefined
	}

	// Access the Python extension API
	const pythonApi = pythonExtension.exports
	// Get the active environment path for the current workspace
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	if (!workspaceFolder) {
		return undefined
	}
	// Get the active python environment path for the current workspace
	const pythonEnv = await pythonApi?.environments?.getActiveEnvironmentPath(workspaceFolder.uri)
	if (pythonEnv && pythonEnv.path) {
		return pythonEnv.path
	} else {
		return undefined
	}
}
