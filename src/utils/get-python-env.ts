import * as vscode from "vscode"

export async function getPythonEnvPath(): Promise<string | undefined> {
	const pythonExtension = vscode.extensions.getExtension("ms-python.python")

	if (!pythonExtension) {
		console.log("Python extension is not installed.")
		return undefined
	}

	// Ensure the Python extension is activated
	if (!pythonExtension.isActive) {
		// if the python extension is not active, we can assume the project is not a python project
		console.log("Python extension is not active.")
		return undefined
	}

	// Access the Python extension API
	const pythonApi = pythonExtension.exports
	// Get the active environment path for the current workspace
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	if (!workspaceFolder) {
		console.log("No workspace folder is open.")
		return undefined
	}
	// Get the active python environment path for the current workspace
	const pythonEnv = await pythonApi?.environments?.getActiveEnvironmentPath(workspaceFolder.uri)
	console.log("Python environment path:", pythonEnv)
	if (pythonEnv && pythonEnv.path) {
		return pythonEnv.path
	} else {
		return undefined
	}
}
