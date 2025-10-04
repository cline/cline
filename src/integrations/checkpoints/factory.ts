import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { MessageStateHandler } from "@core/task/message-state"
import type { TaskState } from "@core/task/TaskState"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { createTaskCheckpointManager } from "@integrations/checkpoints"
import { MultiRootCheckpointManager } from "@integrations/checkpoints/MultiRootCheckpointManager"
import type { ICheckpointManager } from "@integrations/checkpoints/types"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { StateManager } from "@/core/storage/StateManager"

/**
 * Simple predicate abstracting our multi-root decision.
 */
export function shouldUseMultiRoot({
	workspaceManager,
	enableCheckpoints,
	stateManager,
	multiRootEnabledOverride,
}: {
	workspaceManager?: WorkspaceRootManager
	enableCheckpoints: boolean
	stateManager: StateManager
	multiRootEnabledOverride?: boolean
}): boolean {
	const multiRootEnabled = multiRootEnabledOverride ?? isMultiRootEnabled(stateManager)
	return Boolean(multiRootEnabled && enableCheckpoints && workspaceManager && workspaceManager.getRoots().length > 1)
}

type BuildArgs = {
	// common
	taskId: string
	messageStateHandler: MessageStateHandler
	// single-root deps
	fileContextTracker: FileContextTracker
	diffViewProvider: DiffViewProvider
	taskState: TaskState
	// multi-root deps
	workspaceManager?: WorkspaceRootManager

	// callbacks for single-root TaskCheckpointManager
	updateTaskHistory: (historyItem: any) => Promise<any[]>
	say: (...args: any[]) => Promise<number | undefined>
	cancelTask: () => Promise<void>
	postStateToWebview: () => Promise<void>

	// initial state for single-root
	initialConversationHistoryDeletedRange?: [number, number]
	initialCheckpointManagerErrorMessage?: string

	stateManager: StateManager
}

/**
 * Central factory for creating the appropriate checkpoint manager.
 * - MultiRootCheckpointManager for multi-root tasks
 * - TaskCheckpointManager for single-root tasks
 */
export function buildCheckpointManager(args: BuildArgs): ICheckpointManager {
	const {
		taskId,
		messageStateHandler,
		fileContextTracker,
		diffViewProvider,
		taskState,
		workspaceManager,
		updateTaskHistory,
		say,
		cancelTask,
		postStateToWebview,
		initialConversationHistoryDeletedRange,
		initialCheckpointManagerErrorMessage,
		stateManager,
	} = args

	const enableCheckpoints = stateManager.getGlobalSettingsKey("enableCheckpointsSetting")

	if (shouldUseMultiRoot({ workspaceManager, enableCheckpoints, stateManager })) {
		// Multi-root manager (init should be kicked off externally, non-blocking)
		return new MultiRootCheckpointManager(workspaceManager!, taskId, enableCheckpoints, messageStateHandler)
	}

	// Single-root manager
	return createTaskCheckpointManager(
		{ taskId },
		{ enableCheckpoints },
		{
			diffViewProvider,
			messageStateHandler,
			fileContextTracker,
			taskState,
			workspaceManager,
		},
		{
			updateTaskHistory,
			say,
			cancelTask,
			postStateToWebview,
		},
		{
			conversationHistoryDeletedRange: initialConversationHistoryDeletedRange,
			checkpointManagerErrorMessage: initialCheckpointManagerErrorMessage,
		},
	)
}
