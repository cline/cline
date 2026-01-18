import { SwitchWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

/**
 * Switches to a different worktree by opening it in VS Code
 * @param controller The controller instance
 * @param request The request containing the worktree path
 * @returns WorktreeResult with success status
 */
export async function switchWorktree(controller: Controller, request: SwitchWorktreeRequest): Promise<WorktreeResult> {
	try {
		// Set state so Cline auto-opens when the worktree folder loads
		controller.stateManager.setGlobalState("worktreeAutoOpenPath", request.path)

		// When opening in current window, the window reloads immediately and StateManager's
		// 500ms debounce won't complete. Flush to ensure state is persisted before reload.
		if (!request.newWindow) {
			await controller.stateManager.flushPendingState()
		}

		const result = await HostProvider.workspace.openFolder({
			path: request.path,
			newWindow: request.newWindow,
		})

		if (!result.success) {
			return WorktreeResult.create({
				success: false,
				message: `Failed to open worktree at ${request.path}`,
			})
		}

		return WorktreeResult.create({
			success: true,
			message: `Switched to worktree at ${request.path}`,
		})
	} catch (error) {
		console.error(`Error switching worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
