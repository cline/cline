import { SwitchWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

/**
 * Switches to a different worktree by opening it in VS Code
 * @param controller The controller instance
 * @param request The request containing the worktree path
 * @returns WorktreeResult with success status
 */
export async function switchWorktree(_controller: Controller, request: SwitchWorktreeRequest): Promise<WorktreeResult> {
	try {
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
