import { Anthropic } from "@anthropic-ai/sdk"
import cloneDeep from "clone-deep"
import delay from "delay"
import fs from "fs/promises"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import { DiffViewProvider } from "../../integrations/editor/DiffViewProvider"
import { findToolName, formatContentBlockToMarkdown } from "../../integrations/misc/export-markdown"
import { TerminalManager } from "../../integrations/terminal/TerminalManager"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { listFiles } from "../../services/glob/list-files"
import { ApiConfiguration } from "../../shared/api"
import { findLastIndex } from "../../shared/array"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import {
	ClineApiReqCancelReason,
	ClineApiReqInfo,
	ClineAsk,
	ClineMessage,
	ClineSay,
} from "../../shared/ExtensionMessage"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { HistoryItem } from "../../shared/HistoryItem"
import { ClineAskResponse } from "../../shared/WebviewMessage"
import { calculateApiCost } from "../../utils/cost"
import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { parseMentions } from "../mentions"
import { AssistantMessageContent, parseAssistantMessage, ToolUseName } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { addCustomInstructions, SYSTEM_PROMPT } from "../prompts/system"
import { truncateHalfConversation } from "../sliding-window"
import { ClineProvider, GlobalFileNames } from "../webview/ClineProvider"
import { presentAssistantMessageContent } from "./presentAssistantMessageContent"
import { UserContent, ToolResponse } from "./clineTypes"

export async function handleConsecutiveMistakes(
	consecutiveMistakeCount: number,
	apiModelId: string,
	ask: (type: ClineAsk, text?: string) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>,
	say: (type: ClineSay, text?: string, images?: string[]) => Promise<undefined>,
	userContent: UserContent,
): Promise<number> {
	if (consecutiveMistakeCount >= 3) {
		const { response, text, images } = await ask(
		"mistake_limit_reached",
		apiModelId.includes("claude")
			? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
			: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.5 Sonnet for its advanced agentic coding capabilities."
		)
		if (response === "messageResponse") {
		userContent.push(
			...[
			{
				type: "text",
				text: formatResponse.tooManyMistakes(text),
			} as Anthropic.Messages.TextBlockParam,
			...formatResponse.imageBlocks(images),
			]
		)
		}
		return 0 // Reset consecutive mistake count
	}
	return consecutiveMistakeCount
}