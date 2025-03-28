import { ClineAsk, ToolProgressStatus } from "../../schemas"
import { ToolResponse } from "../Cline"

export type AskApproval = (
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
) => Promise<boolean>

export type HandleError = (action: string, error: Error) => void

export type PushToolResult = (content: ToolResponse) => void
