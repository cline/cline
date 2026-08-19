import * as fs from "fs/promises"
import * as path from "path"
/**
 * Write `contents` to `filePath`, creating any necessary directories in `filePath`.
 */
export async function writeFileWithMkdirs(filePath, content) {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content)
}

export async function rmrf(path) {
	await fs.rm(path, { force: true, recursive: true })
}

/**
 * Remove an empty dir, do nothing if the directory doesn't exist or is not empty.
 */
export async function rmdir(path) {
	try {
		await fs.rmdir(path)
	} catch (error) {
		if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") {
			// Only re-throw if it's not "not empty" or "doesn't exist"
			throw error
		}
	}
}
