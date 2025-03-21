import fs from "fs/promises"
import path from "path"

export async function ensureTaskDirectoryExists(globalStoragePath: string | undefined, taskId: string): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}
