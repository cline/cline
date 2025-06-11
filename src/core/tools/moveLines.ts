import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import * as fs from "fs/promises"
import * as path from "path"

/**
 * Moves or copies lines between files
 * @param operation "move" or "copy"
 * @param sourcePath Path to source file
 * @param startLine First line to extract (1-based)
 * @param endLine Last line to extract (1-based)
 * @param targetPath Path to target file
 * @param targetLine Line after which to insert (0 for beginning)
 */
export async function moveLines(
	operation: "move" | "copy",
	sourcePath: string,
	startLine: number,
	endLine: number,
	targetPath: string,
	targetLine: number,
	cwd: string,
): Promise<void> {
	// Validate line numbers
	if (startLine < 1) throw new Error("Start line must be >= 1")
	if (endLine < startLine) throw new Error("End line must be >= start line")
	if (targetLine < 0) throw new Error("Target line must be >= 0")

	// Read and validate source file
	const sourceContent = await fs.readFile(sourcePath, "utf8")
	const sourceLines = sourceContent.split("\n")

	// Validate line ranges
	if (startLine > sourceLines.length) {
		throw new Error(`Start line ${startLine} is beyond end of source file (${sourceLines.length} lines)`)
	}
	if (endLine > sourceLines.length) {
		throw new Error(`End line ${endLine} is beyond end of source file (${sourceLines.length} lines)`)
	}

	// Extract lines to move/copy (convert to 0-based)
	const linesToMove = sourceLines.slice(startLine - 1, endLine)

	// Check if target file exists
	let targetLines: string[]
	let targetFileExists = false
	try {
		const targetContent = await fs.readFile(targetPath, "utf8")
		targetLines = targetContent.split("\n")
		targetFileExists = true
	} catch (error) {
		if (error.code === "ENOENT") {
			// File doesn't exist, which is fine. We'll create it.
			targetLines = []
			// Ensure directory exists
			await fs.mkdir(path.dirname(targetPath), { recursive: true })
		} else {
			// Other error
			throw error
		}
	}

	// Validate target line for existing files
	if (targetFileExists && targetLine > targetLines.length) {
		throw new Error(`Target line ${targetLine} is beyond end of target file (${targetLines.length} lines)`)
	}

	// Insert lines at target position
	const beforeLines = targetLines.slice(0, targetLine)
	const afterLines = targetLines.slice(targetLine)
	const newTargetLines = [...beforeLines, ...linesToMove, ...afterLines]
	const newTargetContent = newTargetLines.join("\n")

	// Use DiffViewProvider to safely update target file
	const targetDiffProvider = new DiffViewProvider(cwd)
	targetDiffProvider.editType = targetFileExists ? "modify" : "create"
	await targetDiffProvider.open(targetPath)
	await targetDiffProvider.update(newTargetContent, true)
	await targetDiffProvider.saveChanges()

	// For move operations, update source file
	if (operation === "move") {
		const newSourceLines = [...sourceLines.slice(0, startLine - 1), ...sourceLines.slice(endLine)]
		const newSourceContent = newSourceLines.join("\n")

		// Use DiffViewProvider to safely update source file
		const sourceDiffProvider = new DiffViewProvider(cwd)
		sourceDiffProvider.editType = "modify"
		await sourceDiffProvider.open(sourcePath)
		await sourceDiffProvider.update(newSourceContent, true)
		await sourceDiffProvider.saveChanges()
	}
}
