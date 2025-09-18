import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { MessageStateHandler } from "@core/task/message-state"
import type { TaskState } from "@core/task/TaskState"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { createTaskCheckpointManager } from "@integrations/checkpoints"
import { MultiRootCheckpointManager } from "@integrations/checkpoints/MultiRootCheckpointManager"
import type { ICheckpointManager } from "@integrations/checkpoints/types"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type * as vscode from "vscode"
import { featureFlagsService } from "@/services/feature-flags"

/**
 * Simple predicate abstracting our multi-root decision.
 */
export function shouldUseMultiRoot({
	workspaceManager,
	enableCheckpoints,
	isMultiRootEnabled,
}: {
	workspaceManager?: WorkspaceRootManager
	enableCheckpoints: boolean
	isMultiRootEnabled?: boolean
}): boolean {
	const hasFeatureFlag = isMultiRootEnabled === undefined ? featureFlagsService.getMultiRootEnabled() : isMultiRootEnabled
	return Boolean(hasFeatureFlag && enableCheckpoints && workspaceManager && workspaceManager.getRoots().length > 1)
}

type BuildArgs = {
	// common
	taskId: string
	enableCheckpoints: boolean
	messageStateHandler: MessageStateHandler
	// single-root deps
	fileContextTracker: FileContextTracker
	diffViewProvider: DiffViewProvider
	taskState: TaskState
	context: vscode.ExtensionContext
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
}

/**
 * Central factory for creating the appropriate checkpoint manager.
 * - MultiRootCheckpointManager for multi-root tasks
 * - TaskCheckpointManager for single-root tasks
 */
export function buildCheckpointManager(args: BuildArgs): ICheckpointManager {
	const {
		taskId,
		enableCheckpoints,
		messageStateHandler,
		fileContextTracker,
		diffViewProvider,
		taskState,
		context,
		workspaceManager,
		updateTaskHistory,
		say,
		cancelTask,
		postStateToWebview,
		initialConversationHistoryDeletedRange,
		initialCheckpointManagerErrorMessage,
	} = args

	if (shouldUseMultiRoot({ workspaceManager, enableCheckpoints })) {
		// Multi-root manager (init should be kicked off externally, non-blocking)
		return new MultiRootCheckpointManager(workspaceManager!, taskId, enableCheckpoints, messageStateHandler)
	}

	// Single-root manager
	return createTaskCheckpointManager(
		{ taskId },
		{ enableCheckpoints },
		{
			context,
			diffViewProvider,
			messageStateHandler,
			fileContextTracker,
			taskState,
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
