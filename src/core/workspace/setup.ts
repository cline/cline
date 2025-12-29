import type { WorkspaceRoot } from "@shared/multi-root/types"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import type { HistoryItem } from "@/shared/HistoryItem"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getCwd, getDesktopDir } from "@/utils/path"
import { StateManager } from "../storage/StateManager"
import { isMultiRootEnabled } from "./multi-root-utils"
import { WorkspaceRootManager } from "./WorkspaceRootManager"

type DetectRoots = () => Promise<WorkspaceRoot[]>

/**
 * Initializes and persists the WorkspaceRootManager (multi-root or single-root),
 * emits telemetry, and handles fallback on error.
 *
 * The caller injects detectRoots to avoid tight coupling to Controller.
 */
export async function setupWorkspaceManager({
	stateManager,
	detectRoots,
}: {
	stateManager: StateManager
	historyItem?: HistoryItem
	detectRoots: DetectRoots
}): Promise<WorkspaceRootManager> {
	const cwd = await getCwd(getDesktopDir())
	const startTime = performance.now()
	const multiRootEnabled = isMultiRootEnabled(stateManager)
	try {
		let manager: WorkspaceRootManager
		// Multi-root mode condition - requires both feature flag and user setting to be enabled
		if (multiRootEnabled) {
			// Multi-root: detect workspace folders
			const roots = await detectRoots()
			manager = new WorkspaceRootManager(roots, 0)
			console.log(`[WorkspaceManager] Multi-root mode: ${roots.length} roots detected`)

			// Telemetry
			telemetryService.captureWorkspaceInitialized(
				roots.length,
				roots.map((r) => r.vcs.toString()),
				performance.now() - startTime,
				true,
			)

			// Persist
			stateManager.setGlobalState("workspaceRoots", manager.getRoots())
			stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())
			return manager
		}

		// Single-root mode code for when we actually start using workspacerootmanager
		// if (historyItem) {
		// 	const savedRoots = stateManager.getWorkspaceRoots()
		// 	if (savedRoots && savedRoots.length > 0) {
		// 		const primaryIndex = stateManager.getPrimaryRootIndex()
		// 		manager = new WorkspaceRootManager(savedRoots, primaryIndex)
		// 		console.log(`[WorkspaceManager] Restored ${savedRoots.length} roots from state`)
		// 		telemetryService.captureWorkspaceInitialized(
		// 			savedRoots.length,
		// 			savedRoots.map((r) => r.vcs.toString()),
		// 			performance.now() - startTime,
		// 			false,
		// 		)
		// 	} else {
		// 		manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		// 		telemetryService.captureWorkspaceInitialized(
		// 			1,
		// 			[manager.getRoots()[0].vcs.toString()],
		// 			performance.now() - startTime,
		// 			false,
		// 		)
		// 	}
		// }

		manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		telemetryService.captureWorkspaceInitialized(
			1,
			[manager.getRoots()[0].vcs.toString()],
			performance.now() - startTime,
			false,
		)

		console.log(`[WorkspaceManager] Single-root mode: ${cwd}`)
		const roots = manager.getRoots()
		stateManager.setGlobalState("workspaceRoots", roots)
		stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())
		return manager
	} catch (error) {
		// Telemetry + graceful fallback to single-root from cwd
		const workspaceCount = (await HostProvider.workspace.getWorkspacePaths({})).paths?.length
		telemetryService.captureWorkspaceInitError(error as Error, true, workspaceCount)

		console.error("[WorkspaceManager] Initialization failed:", error)
		const manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		const roots = manager.getRoots()
		stateManager.setGlobalState("workspaceRoots", roots)
		stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())

		HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "Failed to initialize workspace. Using single folder mode.",
		})
		return manager
	}
}
