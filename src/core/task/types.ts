import { Anthropic } from "@anthropic-ai/sdk"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"

export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

export type CommandRunnerResult = [boolean, ToolResponse]

export type AskFn = (
	type: ClineAsk,
	text?: string,
	partial?: boolean,
) => Promise<{
	response: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
}>

export type SayFn = (
	type: ClineSay,
	text?: string,
	images?: string[],
	files?: string[],
	partial?: boolean,
) => Promise<number | undefined>
