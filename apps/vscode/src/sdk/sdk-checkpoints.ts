import type { ClineMessage } from "@shared/ExtensionMessage"

export function isVisibleCheckpointUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

/**
 * Ask rows whose user response is delivered INSIDE the running turn (folded
 * into the pending tool's result) instead of as a standalone user message in
 * SDK history: ask_question answers and tool/command/MCP/subagent approval
 * feedback, plus legacy ask types with the same semantics. Notably NOT
 * `completion_result` or `resume_task`: responses to those start a new agent
 * turn and are persisted as standalone user messages.
 *
 * Keep in sync with the webview's copy in
 * webview-ui/src/components/chat/chat-view/utils/messageUtils.ts.
 */
const IN_RUN_ANSWER_ASKS = new Set<string>([
	"followup",
	"plan_mode_respond",
	"act_mode_respond",
	"mistake_limit_reached",
	"tool",
	"command",
	"command_output",
	"use_mcp_server",
	"use_subagents",
	"browser_action_launch",
])

/**
 * True when the user_feedback bubble at `index` answered an in-run ask. Such
 * bubbles have no standalone user message in SDK history, so run counting and
 * transcript-to-history ordinal mapping must skip them or every later ordinal
 * maps one slot too far (Reset Chat then fails with "Could not map edited
 * message to persisted conversation history").
 */
export function isCheckpointAnswerMessage(messages: ClineMessage[], index: number): boolean {
	const message = messages[index]
	if (message?.type !== "say" || message.say !== "user_feedback") {
		return false
	}

	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const previous = messages[cursor]
		if (previous.say === "checkpoint_created") {
			continue
		}
		if (previous.type === "ask") {
			return IN_RUN_ANSWER_ASKS.has(previous.ask ?? "")
		}
		// Rows that prove the run progressed past any pending ask: an answer
		// bubble is emitted the moment its ask resolves, before another model
		// request, an error, or task completion can appear. A bubble beyond one
		// of these is a genuine follow-up (e.g. sent after the turn completed),
		// even though an already-resolved ask row sits further up.
		if (
			isVisibleCheckpointUserMessage(previous) ||
			previous.say === "api_req_started" ||
			previous.say === "error" ||
			previous.say === "completion_result"
		) {
			return false
		}
	}

	return false
}

export function isCheckpointRunUserMessage(messages: ClineMessage[], index: number): boolean {
	return isVisibleCheckpointUserMessage(messages[index]) && !isCheckpointAnswerMessage(messages, index)
}

export function getCheckpointRunCountForMessage(messages: ClineMessage[], targetIndex: number): number | undefined {
	if (!isCheckpointRunUserMessage(messages, targetIndex)) {
		return undefined
	}

	let runCount = 0
	for (let index = 0; index <= targetIndex; index += 1) {
		if (isCheckpointRunUserMessage(messages, index)) {
			runCount += 1
		}
	}
	return runCount
}

export function findVisibleCheckpointUserMessageByRun(
	messages: ClineMessage[],
	runCount: number,
): { message: ClineMessage; index: number } | undefined {
	let seenUsers = 0
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index]
		if (!isCheckpointRunUserMessage(messages, index)) {
			continue
		}
		seenUsers += 1
		if (seenUsers === runCount) {
			return { message, index }
		}
	}
	return undefined
}
