import type { AutoApprovalSettings } from "../shared/AutoApprovalSettings"

export interface TaskLike {
	autoApprovalSettings: AutoApprovalSettings
	shouldAutoApproveTool: (toolName: string, requiresApproval?: boolean) => boolean
}

export interface ControllerLike {
	context: any
	postMessageToWebview: (...args: any[]) => void
	postStateToWebview: (...args: any[]) => void
}
