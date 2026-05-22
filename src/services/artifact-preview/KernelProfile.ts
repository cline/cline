import { createHash } from "node:crypto"
import * as path from "node:path"

export type PythonEnvironmentSource = "vscode" | "workspace_venv" | "aihydro_venv" | "custom" | "path"

export interface KernelProfile {
	id: string
	interpreterPath: string
	label: string
	source: PythonEnvironmentSource
	cwd: string
	env?: Record<string, string>
}

export function buildProfileId(workspaceKey: string, interpreterPath: string): string {
	const hash = createHash("sha256")
		.update(`${workspaceKey}\0${path.resolve(interpreterPath)}`)
		.digest("hex")
	return `profile_${hash.slice(0, 16)}`
}

export function buildKernelProfile(opts: {
	workspaceKey: string
	workspaceFolder: string
	interpreterPath: string
	label: string
	source: PythonEnvironmentSource
	env?: Record<string, string>
}): KernelProfile {
	const interpreterPath = path.resolve(opts.interpreterPath)
	return {
		id: buildProfileId(opts.workspaceKey, interpreterPath),
		interpreterPath,
		label: opts.label,
		source: opts.source,
		cwd: opts.workspaceFolder,
		env: opts.env,
	}
}
