// Write-back of SDK-session turns into legacy task artifacts.
//
// When a pre-SDK ("legacy") task is resumed on the SDK build, the conversation
// continues in the SDK session store (~/.cline/data/sessions/<id>/...), while
// the legacy artifacts (tasks/<id>/api_conversation_history.json and
// ui_messages.json) are left untouched. If the user then rolls back to the
// legacy build, every turn added on the SDK build is invisible (ENG-2338).
//
// This module keeps the legacy artifacts in sync: after each turn on a resumed
// legacy task, the SDK messages added since the resume boundary (the
// LEGACY_RESUME_MODEL_WARNING marker) are converted back to the legacy formats
// and appended after the original, untouched legacy prefix.
//
// Idempotency: a sidecar file (sdk_writeback.json) in the legacy task
// directory records the original prefix lengths and the lengths we last
// wrote. Each write-back replaces the full suffix (so edits/truncations on
// the SDK side propagate), and a length mismatch against the sidecar means
// something else (e.g. the legacy build after a rollback) modified the files —
// in that case the write-back refuses to touch them so it can never destroy
// work done on the legacy build.
//
// API-history safety: SDK turns use native tool_use/tool_result blocks, but
// the legacy build replays api_conversation_history.json to providers verbatim
// and may not declare tools (XML tool-calling mode) — native tool blocks would
// be rejected by e.g. the Anthropic API. Tool blocks are therefore written
// back as plain-text representations ("[Tool Use: name]" / "[Tool Result]"),
// matching the convention the legacy build itself uses when flattening blocks
// to text (see legacy formatContentBlockToMarkdown).

import fs from "node:fs"
import path from "node:path"
import type { Anthropic } from "@anthropic-ai/sdk"
import type { MessageWithMetadata, Message as SdkMessage } from "@cline/llms"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { readApiConversationHistory, readRawUiMessages, taskDirPath, writeLegacyTaskConversation } from "./legacy-state-reader"
import { findLegacyResumeWarningIndex } from "./legacy-task-handling"
import { sanitizeSdkUserMessagesForDisplay, sdkMessagesToClineMessages } from "./message-translator"

/** Sidecar file recording write-back bookkeeping inside the legacy task dir. */
export const LEGACY_WRITEBACK_STATE_FILE = "sdk_writeback.json"

interface LegacyWritebackState {
	version: 1
	/** Length of the original (pre-resume) legacy api_conversation_history.json */
	baseApiMessageCount: number
	/** Length of the original (pre-resume) legacy ui_messages.json */
	baseUiMessageCount: number
	/** Total api_conversation_history.json length after our last write */
	writtenApiMessageCount: number
	/** Total ui_messages.json length after our last write */
	writtenUiMessageCount: number
}

export interface LegacyTaskWritebackInput {
	taskId: string
	/** Legacy data dir the task lives in (undefined = default ~/.cline/data) */
	dataDir?: string
	/** Full persisted SDK conversation for the session (legacy prefix + new turns) */
	sdkMessages: MessageWithMetadata[]
}

export type LegacyTaskWritebackOutcome =
	| { status: "written"; apiSuffixCount: number; uiSuffixCount: number }
	| { status: "skipped"; reason: "no_resume_boundary" | "no_new_messages" | "diverged_legacy_files" }

type LegacyApiMessage = Anthropic.MessageParam & { ts?: number }
type SdkContentBlock = Exclude<SdkMessage["content"], string>[number]

function writebackStatePath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), LEGACY_WRITEBACK_STATE_FILE)
}

function readWritebackState(taskId: string, dataDir?: string): LegacyWritebackState | undefined {
	try {
		const statePath = writebackStatePath(taskId, dataDir)
		if (!fs.existsSync(statePath)) {
			return undefined
		}
		const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as LegacyWritebackState
		if (
			parsed?.version === 1 &&
			typeof parsed.baseApiMessageCount === "number" &&
			typeof parsed.baseUiMessageCount === "number" &&
			typeof parsed.writtenApiMessageCount === "number" &&
			typeof parsed.writtenUiMessageCount === "number"
		) {
			return parsed
		}
		return undefined
	} catch (error) {
		Logger.warn(`[LegacyTaskWriteback] Failed to read write-back state for ${taskId}:`, error)
		return undefined
	}
}

function writeWritebackState(taskId: string, state: LegacyWritebackState, dataDir?: string): void {
	fs.mkdirSync(taskDirPath(taskId, dataDir), { recursive: true })
	fs.writeFileSync(writebackStatePath(taskId, dataDir), JSON.stringify(state, null, 2), "utf-8")
}

// ---------------------------------------------------------------------------
// SDK suffix → legacy api_conversation_history.json entries
// ---------------------------------------------------------------------------

function toolResultContentToText(content: Extract<SdkContentBlock, { type: "tool_result" }>["content"]): string {
	if (typeof content === "string") {
		return content
	}
	return content
		.map((block) => {
			if (block.type === "text") {
				return block.text
			}
			if (block.type === "file") {
				return block.content
			}
			return "[Image]"
		})
		.join("\n")
}

function sdkBlockToLegacyApiBlocks(block: SdkContentBlock): Anthropic.ContentBlockParam[] {
	switch (block.type) {
		case "text":
			return block.text.trim() ? [{ type: "text", text: block.text }] : []
		case "image":
			return [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: block.mediaType,
						data: block.data,
					} as Anthropic.ImageBlockParam["source"],
				},
			]
		case "file":
			return block.content.trim() ? [{ type: "text", text: block.content }] : []
		case "tool_use":
			// Text representation: the legacy build may replay this history in
			// XML tool-calling mode where native tool_use blocks are invalid.
			return [
				{
					type: "text",
					text: `[Tool Use: ${block.name}]\n${JSON.stringify(block.input ?? {}, null, 2)}`,
				},
			]
		case "tool_result": {
			const resultText = toolResultContentToText(block.content)
			return [
				{
					type: "text",
					text: `[Tool Result${block.is_error ? " (Error)" : ""}${block.name ? ` for ${block.name}` : ""}]\n${resultText}`,
				},
			]
		}
		default:
			// thinking / redacted_thinking: signatures don't survive round-trips
			// and the legacy build never persisted reasoning, so drop them.
			return []
	}
}

/**
 * Convert the SDK-session suffix (turns added after the legacy resume
 * boundary) into legacy api_conversation_history.json entries.
 *
 * Only text and image blocks survive as-is; tool blocks become plain-text
 * representations so the history stays valid for any legacy provider mode.
 * Consecutive same-role messages are merged to preserve the strict
 * user/assistant alternation legacy providers expect.
 */
export function sdkSuffixToLegacyApiMessages(suffix: MessageWithMetadata[]): LegacyApiMessage[] {
	const converted: LegacyApiMessage[] = []
	for (const message of suffix) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue
		}
		const blocks: Anthropic.ContentBlockParam[] =
			typeof message.content === "string"
				? message.content.trim()
					? [{ type: "text", text: message.content }]
					: []
				: message.content.flatMap(sdkBlockToLegacyApiBlocks)
		if (blocks.length === 0) {
			continue
		}

		const previous = converted[converted.length - 1]
		if (previous && previous.role === message.role) {
			previous.content = [...(previous.content as Anthropic.ContentBlockParam[]), ...blocks]
			continue
		}

		const entry: LegacyApiMessage = { role: message.role, content: blocks }
		if (typeof message.ts === "number" && Number.isFinite(message.ts)) {
			entry.ts = message.ts
		}
		converted.push(entry)
	}
	return converted
}

// ---------------------------------------------------------------------------
// SDK suffix → legacy ui_messages.json entries
// ---------------------------------------------------------------------------

/**
 * Convert the SDK-session suffix into ClineMessages the legacy webview can
 * render, with wall-clock-plausible, strictly-ascending timestamps that sort
 * after the untouched legacy prefix.
 */
export function sdkSuffixToLegacyUiMessages(suffix: MessageWithMetadata[], lastLegacyUiTs: number): ClineMessage[] {
	const clineMessages = sdkMessagesToClineMessages(sanitizeSdkUserMessagesForDisplay(suffix))

	// The suffix starts mid-conversation: its first user message is a
	// follow-up, not the task statement.
	const processed = clineMessages.map((message) =>
		message.type === "say" && message.say === "task" ? { ...message, say: "user_feedback" as const } : message,
	)

	// The translator always appends a trailing ask:"completion_result" so a
	// reopened SDK task shows the resume affordance. The legacy build derives
	// that ask itself on resume and treats a trailing completion ask as "task
	// completed", so only keep it when this suffix actually completed.
	const last = processed[processed.length - 1]
	if (last?.type === "ask" && last.ask === "completion_result") {
		const hasCompletion = processed.some((message) => message.type === "say" && message.say === "completion_result")
		if (!hasCompletion) {
			processed.pop()
		}
	}

	// Translator ids are monotonic counters, not timestamps. Re-stamp with
	// epoch-ms values anchored at the last SDK message's wall-clock time and
	// clamped to sort after the legacy prefix.
	const lastSdkTs = [...suffix].reverse().find((message) => typeof message.ts === "number" && Number.isFinite(message.ts))?.ts
	const anchorEnd = typeof lastSdkTs === "number" ? lastSdkTs : Date.now()
	const base = Math.max(lastLegacyUiTs + 1, anchorEnd - (processed.length - 1))
	return processed.map((message, index) => ({ ...message, ts: base + index }))
}

// ---------------------------------------------------------------------------
// Write-back entry point
// ---------------------------------------------------------------------------

/**
 * Sync a resumed legacy task's on-disk legacy artifacts with the turns added
 * on the SDK build. Never touches the original legacy prefix, and refuses to
 * write when the legacy files were modified by anything other than a previous
 * write-back (so a rollback-and-continue on the legacy build is never
 * clobbered).
 */
export function writeBackResumedLegacyTask(input: LegacyTaskWritebackInput): LegacyTaskWritebackOutcome {
	const { taskId, dataDir, sdkMessages } = input

	const warningIndex = findLegacyResumeWarningIndex(sdkMessages)
	if (warningIndex === -1) {
		return { status: "skipped", reason: "no_resume_boundary" }
	}
	const suffix = sdkMessages.slice(warningIndex + 1)

	const state = readWritebackState(taskId, dataDir)
	if (suffix.length === 0 && !state) {
		return { status: "skipped", reason: "no_new_messages" }
	}

	const apiHistory = readApiConversationHistory(taskId, dataDir)
	const uiMessages = readRawUiMessages(taskId, dataDir)

	if (state && (apiHistory.length !== state.writtenApiMessageCount || uiMessages.length !== state.writtenUiMessageCount)) {
		Logger.warn(
			`[LegacyTaskWriteback] Legacy files for task ${taskId} changed outside the write-back ` +
				`(api ${apiHistory.length}≠${state.writtenApiMessageCount}, ui ${uiMessages.length}≠${state.writtenUiMessageCount}); skipping`,
		)
		return { status: "skipped", reason: "diverged_legacy_files" }
	}

	const baseApiMessageCount = state?.baseApiMessageCount ?? apiHistory.length
	const baseUiMessageCount = state?.baseUiMessageCount ?? uiMessages.length

	const apiSuffix = sdkSuffixToLegacyApiMessages(suffix)
	const uiPrefix = uiMessages.slice(0, baseUiMessageCount)
	const lastLegacyUiTs = uiPrefix.reduce((max, message) => Math.max(max, message.ts ?? 0), 0)
	const uiSuffix = sdkSuffixToLegacyUiMessages(suffix, lastLegacyUiTs)

	if (!state && apiSuffix.length === 0 && uiSuffix.length === 0) {
		return { status: "skipped", reason: "no_new_messages" }
	}

	writeLegacyTaskConversation(
		taskId,
		{
			apiConversationHistory: [...apiHistory.slice(0, baseApiMessageCount), ...apiSuffix],
			uiMessages: [...uiPrefix, ...uiSuffix],
		},
		dataDir,
	)
	writeWritebackState(
		taskId,
		{
			version: 1,
			baseApiMessageCount,
			baseUiMessageCount,
			writtenApiMessageCount: baseApiMessageCount + apiSuffix.length,
			writtenUiMessageCount: baseUiMessageCount + uiSuffix.length,
		},
		dataDir,
	)

	return { status: "written", apiSuffixCount: apiSuffix.length, uiSuffixCount: uiSuffix.length }
}
