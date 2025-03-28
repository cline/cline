import { ClineAsk, ToolProgressStatus } from "../../schemas"
import { ToolParamName } from "../assistant-message"
import { ToolResponse } from "../Cline"

export type AskApproval = (
	type: ClineAsk,
	partialMessage?: string,
	progressStatus?: ToolProgressStatus,
) => Promise<boolean>

export type HandleError = (action: string, error: Error) => void

export type PushToolResult = (content: ToolResponse) => void

export type RemoveClosingTag = (tag: ToolParamName, content?: string) => string
