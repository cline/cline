import { SwitchWorktreeRequest, WorktreeResult } from "@shared/proto/bedrock_coder/worktree"
import { listWorktrees } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Switches to a different worktree by opening it in VS Code
 * @param controller The controller instance
 * @param request The request containing the worktree path
 * @returns WorktreeResult with success status
 */
export async function switchWorktree(controller: Controller, request: SwitchWorktreeRequest): Promise<WorktreeResult> {
	try {
		const cwd = await getWorkspacePath()
		if (!cwd) {
			return WorktreeResult.create({ success: false, message: "No workspace folder open" })
		}
		const requestedPath = path.resolve(request.path)
		const normalize = (value: string) =>
			process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
		const { worktrees } = await listWorktrees(cwd)
		if (!worktrees.some((worktree) => normalize(worktree.path) === normalize(requestedPath))) {
			return WorktreeResult.create({
				success: false,
				message: "The selected folder is not a recognized worktree of the current repository",
			})
		}

		// Set state so BedrockCoder auto-opens when the worktree folder loads
		controller.stateManager.setGlobalState("worktreeAutoOpenPath", requestedPath)

		// When opening in current window, the window reloads immediately and StateManager's
		// 500ms debounce won't complete. Flush to ensure state is persisted before reload.
		if (!request.newWindow) {
			await controller.stateManager.flushPendingState()
		}

		const result = await HostProvider.workspace.openFolder({
			path: requestedPath,
			newWindow: request.newWindow,
		})

		if (!result.success) {
			return WorktreeResult.create({
				success: false,
				message: `Failed to open worktree at ${requestedPath}`,
			})
		}

		return WorktreeResult.create({
			success: true,
			message: `Switched to worktree at ${requestedPath}`,
		})
	} catch (error) {
		Logger.error(`Error switching worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
