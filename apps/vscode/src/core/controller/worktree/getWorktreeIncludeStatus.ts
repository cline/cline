import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeIncludeStatus } from "@shared/proto/cline/worktree"
import { getWorkspacePath } from "@utils/path"
import * as fs from "fs/promises"
import * as path from "path"
import { Controller } from ".."

/**
 * Gets the status of .worktreeinclude file and .gitignore contents
 * @param controller The controller instance
 * @param request Empty request
 * @returns WorktreeIncludeStatus with exists flag and gitignore content
 */
export async function getWorktreeIncludeStatus(_controller: Controller, _request: EmptyRequest): Promise<WorktreeIncludeStatus> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeIncludeStatus.create({
			exists: false,
			hasGitignore: false,
			gitignoreContent: "",
		})
	}

	// Check if .worktreeinclude exists
	let exists = false
	try {
		await fs.access(path.join(cwd, ".worktreeinclude"))
		exists = true
	} catch {
		exists = false
	}

	// Read .gitignore content if it exists
	let gitignoreContent = ""
	let hasGitignore = false
	try {
		gitignoreContent = await fs.readFile(path.join(cwd, ".gitignore"), "utf-8")
		hasGitignore = true
	} catch {
		hasGitignore = false
	}

	return WorktreeIncludeStatus.create({
		exists,
		hasGitignore,
		gitignoreContent,
	})
}
