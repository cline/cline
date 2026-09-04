/**
 * FrameMessageBridge — ClineMessage sinks for the v2 frame stream
 * (`sdk/packages/core/docs/agent-event-stream-design.md`).
 *
 * Implements the assembler's consumer API so the frame path produces the
 * same ClineMessages as the v1 translator (`message-translator.ts`):
 * streaming text/reasoning rows, tool rows (generic, completion, command,
 * MCP, read_files/apply_patch multi-file splits, ask_question
 * suppression, spawn_agent aggregation into the SubagentStatusRow rows),
 * usage, iteration markers, notices including compaction dividers, and
 * turn terminals (completion retag, terminal error rows with ErrorRow
 * reshaping). Parity with v1 is differential-test locked
 * (frame-message-bridge.differential.test.ts): both paths mint message
 * ids at identical points, so the produced rows must be equal.
 *
 * Ordering rules are the assembler's, not this file's: sinks receive
 * updates only between their open and close, children close before the
 * turn, and a force-close (interrupted) is silent — matching v1, where a
 * dangling block simply never got its content_end (W3).
 *
 * Not yet ported (the switchover checklist in the design doc, gated by
 * the pinned v1 translator tests): approval-coordinator interactions
 * (approved-row upserts, denial suppression — annotation wiring at the
 * flip). Until the switchover PR, v1 remains the production ClineMessage
 * source and this bridge runs shadow-only — its output is drained and
 * discarded by SdkFrameStream.
 */

import type { SessionConsumer, StreamDiagnostic, ToolSink, TurnConsumer } from "@cline/core/frames"
import type { CloseFinal, NoticeBody, Outcome, ToolStart, UsageBody } from "@cline/shared"
import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type {
	ClineApiReqInfo,
	ClineAskUseSubagents,
	ClineMessage,
	ClineSaySubagentStatus,
	ClineSayTool,
	ClineSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import {
	buildCompactionMessage,
	buildMcpToolPayload,
	extractCommandText,
	extractFileReads,
	extractToolOutputText,
	getApplyPatchString,
	getCompletionResultText,
	getSpawnAgentTaskPrompt,
	isCompletionTool,
	normalizeUsageEvent,
	parseCompactionNoticeMetadata,
	parseMcpToolName,
	readLineRangeFields,
	reshapeErrorForWebview,
	sdkToolToClineSayTool,
	splitApplyPatchByFile,
	toDisplaySayTool,
} from "./message-translator"

/** Retained diagnostics, newest last, bounded for a long session. */
const MAX_RETAINED_DIAGNOSTICS = 100

/**
 * Status notices that are internal diagnostics with no user-facing copy —
 * the same suppression set as the v1 translator (kept in sync with the
 * `emitStatusNotice` call sites in sdk/packages/core/src/extensions/context/compaction.ts).
 */
const INTERNAL_STATUS_NOTICES = new Set(["compaction-budget-adjusted"])

export interface FrameMessageBridgeDeps {
	/** Mint a ClineMessage ts — the same authority the v1 state uses. */
	nextTs: () => number
	/** UI mode for the completion retag's say kind; undefined means act. */
	getUiMode?: () => "plan" | "act" | "yolo" | undefined
	/** Working directory for tool-path relativization. */
	getCwd?: () => string | undefined
	/** Active provider/model ids for error reshaping (ErrorRow UI). */
	getActiveProviderId?: () => string | undefined
	getActiveModelId?: () => string | undefined
}

/**
 * Session-level sink: mints rows for notices/usage and delegates turn
 * bodies to per-turn consumers that hold the turn-scoped retag state.
 */
export class FrameMessageBridge implements SessionConsumer {
	private messages: ClineMessage[] = []
	diagnostics: Array<{ code: string; detail?: string; seq?: number }> = []

	/** Minting/config access shared with this file's turn consumers. */
	readonly deps: FrameMessageBridgeDeps

	constructor(deps: FrameMessageBridgeDeps) {
		this.deps = deps
	}

	/** Drain produced messages (the shadow runner discards them until switchover). */
	takeMessages(): ClineMessage[] {
		const out = this.messages
		this.messages = []
		return out
	}

	onTurn(): TurnConsumer {
		return new BridgeTurnConsumer(this)
	}

	onSessionNotice(notice: NoticeBody): void {
		// Session-scope notices render as info rows, mirroring the v1
		// translator's notice default wherever the notice fires.
		this.push({
			ts: this.deps.nextTs(),
			type: "say",
			say: "info",
			text: notice.message ?? "",
			partial: false,
		})
	}

	onIdle(): void {
		// Quiescence is a host-lifecycle signal (rebuild scheduler), not a
		// chat row; the switchover wiring subscribes to it separately.
	}

	onDiagnostic(diagnostic: StreamDiagnostic): void {
		this.diagnostics.push({
			code: diagnostic.code,
			seq: diagnostic.seq,
			detail: diagnostic.detail,
		})
		if (this.diagnostics.length > MAX_RETAINED_DIAGNOSTICS) {
			this.diagnostics.shift()
		}
		Logger.warn(
			`[FrameMessageBridge] ${diagnostic.code}${diagnostic.detail ? ` ${diagnostic.detail}` : ""} (seq ${diagnostic.seq ?? "?"})`,
		)
	}

	/** Visible to the turn consumers in this file. */
	push(message: ClineMessage): void {
		this.messages.push(message)
	}
}

/**
 * Aggregates the spawn_agent tool blocks of one iteration into the
 * SubagentStatusRow UI: one say:"use_subagents" prompts row and one
 * say:"subagent" status row, each replaced in place as spawns open,
 * progress, and close, plus a say:"subagent_usage" row once every spawn
 * has closed. The group is the sole owner of the item list — the status
 * and usage payloads are derived from it — and of the two row identities,
 * minted lazily in v1's order (prompts at the first open, status at the
 * first progress or close).
 *
 * Iteration-scoped, as in v1: the turn consumer replaces its group at
 * each iteration_started, so a spawn block that closes after the boundary
 * finds no entry and only re-emits the (then empty) group's status.
 */
class SpawnAgentGroup {
	private readonly entries = new Map<string, SubagentStatusItem>()
	private promptsTs: number | undefined
	private statusTs: number | undefined

	constructor(private readonly bridge: FrameMessageBridge) {}

	register(blockId: string, prompt: string): void {
		this.entries.set(blockId, {
			index: this.entries.size + 1,
			prompt,
			status: "running",
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
		})
		const payload: ClineAskUseSubagents = { prompts: this.items().map((entry) => entry.prompt) }
		if (this.promptsTs === undefined) {
			this.promptsTs = this.bridge.deps.nextTs()
		}
		this.bridge.push({
			ts: this.promptsTs,
			type: "say",
			say: "use_subagents",
			text: JSON.stringify(payload),
			partial: true,
		})
	}

	progress(blockId: string, update: unknown): void {
		if (this.entries.size === 0) {
			// v1 renders progress only while the group has members; a
			// stray update after the iteration reset emits nothing.
			return
		}
		const entry = this.entries.get(blockId)
		const data = isRecord(update) ? update : undefined
		if (entry && data) {
			if (typeof data.toolCalls === "number") entry.toolCalls = data.toolCalls
			if (typeof data.inputTokens === "number") entry.inputTokens = data.inputTokens
			if (typeof data.outputTokens === "number") entry.outputTokens = data.outputTokens
			if (typeof data.totalCost === "number") entry.totalCost = data.totalCost
			if (typeof data.contextTokens === "number") entry.contextTokens = data.contextTokens
			if (typeof data.contextWindow === "number") entry.contextWindow = data.contextWindow
			if (typeof data.contextUsagePercentage === "number") entry.contextUsagePercentage = data.contextUsagePercentage
			if (typeof data.latestToolCall === "string") entry.latestToolCall = data.latestToolCall
		}
		this.pushStatus("running", true)
	}

	close(blockId: string, outcome: Outcome, final: CloseFinal): void {
		const entry = this.entries.get(blockId)
		if (entry) {
			// SpawnAgentOutput: { text, usage: { inputTokens, outputTokens } }.
			const output = final.type === "tool" && isRecord(final.output) ? final.output : undefined
			if (output) {
				entry.result = typeof output.text === "string" ? output.text : undefined
				const usage = isRecord(output.usage) ? output.usage : undefined
				if (usage) {
					if (typeof usage.inputTokens === "number") entry.inputTokens = usage.inputTokens
					if (typeof usage.outputTokens === "number") entry.outputTokens = usage.outputTokens
				}
			}
			if (outcome.kind === "error") {
				entry.status = "failed"
				entry.error = outcome.error.message
			} else {
				entry.status = "completed"
			}
		}

		const items = this.items()
		const allDone = items.every((item) => item.status === "completed" || item.status === "failed")
		const hasFailed = items.some((item) => item.status === "failed")
		this.pushStatus(allDone ? (hasFailed ? "failed" : "completed") : "running", !allDone)

		if (allDone) {
			const usage: ClineSubagentUsageInfo = {
				source: "subagents",
				tokensIn: items.reduce((acc, item) => acc + (item.inputTokens || 0), 0),
				tokensOut: items.reduce((acc, item) => acc + (item.outputTokens || 0), 0),
				cacheWrites: 0,
				cacheReads: 0,
				cost: items.reduce((acc, item) => acc + (item.totalCost || 0), 0),
			}
			this.bridge.push({
				ts: this.bridge.deps.nextTs(),
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify(usage),
				partial: false,
			})
		}
	}

	private items(): SubagentStatusItem[] {
		return Array.from(this.entries.values()).sort((a, b) => a.index - b.index)
	}

	private pushStatus(status: ClineSaySubagentStatus["status"], partial: boolean): void {
		const items = this.items()
		const payload: ClineSaySubagentStatus = {
			status,
			total: items.length,
			completed: items.filter((item) => item.status === "completed" || item.status === "failed").length,
			successes: items.filter((item) => item.status === "completed").length,
			failures: items.filter((item) => item.status === "failed").length,
			toolCalls: items.reduce((acc, item) => acc + (item.toolCalls || 0), 0),
			inputTokens: items.reduce((acc, item) => acc + (item.inputTokens || 0), 0),
			outputTokens: items.reduce((acc, item) => acc + (item.outputTokens || 0), 0),
			contextWindow: items.reduce((acc, item) => Math.max(acc, item.contextWindow || 0), 0),
			maxContextTokens: items.reduce((acc, item) => Math.max(acc, item.contextTokens || 0), 0),
			maxContextUsagePercentage: items.reduce((acc, item) => Math.max(acc, item.contextUsagePercentage || 0), 0),
			items,
		}
		if (this.statusTs === undefined) {
			this.statusTs = this.bridge.deps.nextTs()
		}
		this.bridge.push({
			ts: this.statusTs,
			type: "say",
			say: "subagent",
			text: JSON.stringify(payload),
			partial,
		})
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Per-turn state: the completion-retag candidate, the open compaction
 * divider, and the current iteration's spawn_agent group — all turn-scoped
 * by v1's emission rules (the divider is finalized at this turn's terminal,
 * never carried across turns; the group is replaced per iteration). */
class BridgeTurnConsumer implements TurnConsumer {
	private turnFinalText: { ts: number; text: string } | undefined
	private attemptCompletionSeen = false
	private openCompactionTs: number | undefined
	private spawnAgents: SpawnAgentGroup | undefined

	constructor(private readonly bridge: FrameMessageBridge) {}

	onText(): ReturnType<TurnConsumer["onText"]> {
		const ts = this.bridge.deps.nextTs()
		const turn = this
		let accumulated = ""
		const bridge = this.bridge
		return {
			onDelta(text: string): void {
				accumulated += text
				bridge.push({ ts, type: "say", say: "text", text: accumulated, partial: true })
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: { text: string }): void {
				// A force-close is silent: v1 never saw a content_end for a
				// dangling text block (W3), so neither does this path.
				if (outcome.kind === "interrupted") {
					return
				}
				bridge.push({ ts, type: "say", say: "text", text: final.text, partial: false })
				if (final.text.trim()) {
					turn.recordTurnFinalText(ts, final.text)
				}
			},
		}
	}

	onReasoning(): ReturnType<TurnConsumer["onReasoning"]> {
		const ts = this.bridge.deps.nextTs()
		let accumulated = ""
		const bridge = this.bridge
		return {
			onDelta(reasoning: string): void {
				accumulated += reasoning
				bridge.push({ ts, type: "say", say: "reasoning", text: accumulated, reasoning: accumulated, partial: true })
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: { reasoning: string }): void {
				if (outcome.kind === "interrupted") {
					return
				}
				bridge.push({
					ts,
					type: "say",
					say: "reasoning",
					text: final.reasoning,
					reasoning: final.reasoning,
					partial: false,
				})
			},
		}
	}

	onTool(start: ToolStart): ToolSink {
		// Tool activity after a text block means that text wasn't the
		// turn-final response — drop the retag candidate (v1 rule).
		this.turnFinalText = undefined
		const toolName = start.toolName
		const bridge = this.bridge
		const cwd = bridge.deps.getCwd?.()

		// ask_question (and ask_followup_question) is serviced by the
		// interaction coordinator, which emits the proper ask:"followup"
		// row; a generic tool row here would orphan (v1 suppresses it too).
		// No mint, no row — at open or close.
		if (toolName === "ask_question" || toolName === "ask_followup_question") {
			return { onProgress() {}, onAnnotation() {}, onClose() {} }
		}

		// spawn_agent blocks aggregate into the iteration's group rather than
		// rendering a row each. The sink resolves the group at each call, not
		// at open: a block that outlives the iteration reports to the group
		// current at that moment, as v1's per-callId lookup does.
		if (toolName === "spawn_agent") {
			const blockId = start.blockId
			const turn = this
			turn.spawnAgentGroup().register(blockId, getSpawnAgentTaskPrompt(start.input))
			return {
				onProgress(update: unknown): void {
					turn.spawnAgentGroup().progress(blockId, update)
				},
				onAnnotation(): void {},
				onClose(outcome: Outcome, final: CloseFinal): void {
					if (outcome.kind === "interrupted") {
						return
					}
					turn.spawnAgentGroup().close(blockId, outcome, final)
				},
			}
		}

		if (isCompletionTool(toolName)) {
			// The completion tool drives the green box: partial here, the
			// non-partial finalize at close. attemptCompletionSeen makes the
			// turn end in the "completed" phase rather than awaiting_followup.
			this.attemptCompletionSeen = true
			const ts = bridge.deps.nextTs()
			bridge.push({
				ts,
				type: "say",
				say: "completion_result",
				text: getCompletionResultText(start.input),
				partial: true,
			})
			return {
				onProgress() {},
				onAnnotation() {},
				onClose(outcome: Outcome, final: CloseFinal): void {
					if (outcome.kind === "interrupted" || final.type !== "tool") {
						return
					}
					bridge.push({
						ts,
						type: "say",
						say: "completion_result",
						text: getCompletionResultText(final.input ?? start.input),
						partial: false,
					})
				},
			}
		}

		// Command tools render as say:"command" with the output marker while
		// running (ChatRow shows "executing" until the marker resolves).
		if (toolName === "run_commands" || toolName === "execute_command") {
			const ts = bridge.deps.nextTs()
			bridge.push({
				ts,
				type: "say",
				say: "command",
				text: `${extractCommandText(start.input)}\n${COMMAND_OUTPUT_STRING}`,
				partial: true,
			})
			return {
				onProgress() {},
				onAnnotation() {},
				onClose(outcome: Outcome, final: CloseFinal): void {
					if (outcome.kind === "interrupted" || final.type !== "tool") {
						return
					}
					const input = final.input ?? start.input
					const commandText = extractCommandText(input)
					const outputStr =
						outcome.kind === "error" ? `Error: ${outcome.error.message}` : extractToolOutputText(final.output)
					bridge.push({
						ts,
						type: "say",
						say: "command",
						text: outputStr ? `${commandText}\n${COMMAND_OUTPUT_STRING}\n${outputStr}` : commandText,
						partial: false,
						commandCompleted: true,
					})
				},
			}
		}

		// MCP tools (serverName__toolName) render via use_mcp_server with
		// ClineAskUseMcpServer JSON, plus a response row at close.
		const mcpInfo = parseMcpToolName(toolName)
		if (mcpInfo) {
			const ts = bridge.deps.nextTs()
			bridge.push({
				ts,
				type: "say",
				say: "use_mcp_server",
				text: buildMcpToolPayload(mcpInfo, start.input),
				partial: true,
			})
			return {
				onProgress() {},
				onAnnotation() {},
				onClose(outcome: Outcome, final: CloseFinal): void {
					if (outcome.kind === "interrupted" || final.type !== "tool") {
						return
					}
					const input = final.input ?? start.input
					bridge.push({
						ts,
						type: "say",
						say: "use_mcp_server",
						text: buildMcpToolPayload(mcpInfo, input),
						partial: false,
					})
					const outputStr =
						outcome.kind === "error" ? `Error: ${outcome.error.message}` : extractToolOutputText(final.output)
					if (outputStr) {
						bridge.push({
							ts: bridge.deps.nextTs(),
							type: "say",
							say: "mcp_server_response",
							text: outputStr,
							partial: false,
						})
					}
				},
			}
		}

		// Generic tool row (spawn_agent renders generically until its
		// dedicated aggregation port — see the design doc checklist).
		const ts = bridge.deps.nextTs()
		bridge.push({
			ts,
			type: "say",
			say: "tool",
			text: JSON.stringify(toDisplaySayTool(sdkToolToClineSayTool(toolName, start.input), cwd)),
			partial: true,
		})
		return {
			onProgress(): void {
				// v1 ignores content_update for generic tools; the partial
				// row from the open is the running state until close.
			},
			onAnnotation(): void {},
			onClose(outcome: Outcome, final: CloseFinal): void {
				if (outcome.kind === "interrupted") {
					// v1 W3 silence: a dangling tool never got its content_end.
					return
				}
				if (final.type !== "tool") {
					return
				}
				const input = final.input ?? start.input

				// read_files may read multiple files in one call: one tool
				// row per file so the group summary reflects the reads.
				if (toolName === "read_files" || toolName === "read_file") {
					const fileReads = extractFileReads(input as Record<string, unknown> | undefined)
					if (fileReads.length > 1) {
						fileReads.forEach((fileRead, index) => {
							const sayTool: ClineSayTool = {
								tool: "readFile",
								path: fileRead.path,
								...readLineRangeFields(fileRead),
							}
							bridge.push({
								ts: index === 0 ? ts : bridge.deps.nextTs(),
								type: "say",
								say: "tool",
								text: JSON.stringify(toDisplaySayTool(sayTool, cwd)),
								partial: false,
							})
						})
						return
					}
				}

				// apply_patch may edit multiple files in one call: one row
				// per file so each diff row shows only that file's changes
				// (cline#9904). Errored patches fall through to the generic
				// error path below.
				if (toolName === "apply_patch" && outcome.kind !== "error") {
					const patch = getApplyPatchString(input)
					const perFileTools = patch ? splitApplyPatchByFile(patch) : []
					if (perFileTools.length > 1) {
						perFileTools.forEach((sayTool, index) => {
							bridge.push({
								ts: index === 0 ? ts : bridge.deps.nextTs(),
								type: "say",
								say: "tool",
								text: JSON.stringify(toDisplaySayTool(sayTool, cwd)),
								partial: false,
							})
						})
						return
					}
				}

				const sayTool = toDisplaySayTool(sdkToolToClineSayTool(toolName, input), cwd)
				bridge.push({ ts, type: "say", say: "tool", text: JSON.stringify(sayTool), partial: false })
				if (outcome.kind === "error") {
					bridge.push({
						ts: bridge.deps.nextTs(),
						type: "say",
						say: "error",
						text: outcome.error.message,
						partial: false,
					})
				}
			},
		}
	}

	onMedia(): void {
		// The v1 adapter never emits media content events.
	}

	onSubAgent(): TurnConsumer | null {
		// Main chat renders sub-agents via the spawn_agent tool rows (P5's
		// structural pruning — replaces v1's timing-based suppression).
		return null
	}

	onNotice(notice: NoticeBody): void {
		switch (notice.noticeType) {
			case "iteration_started": {
				// v1's iteration_start: the spawn_agent aggregation resets
				// (its reset() clears the group) and an api_req_started row
				// per API request (spinner + cost display placeholder).
				this.spawnAgents = undefined
				this.bridge.push({
					ts: this.bridge.deps.nextTs(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ request: undefined } satisfies ClineApiReqInfo),
					partial: false,
				})
				return
			}
			case "iteration_finished": {
				// v1's iteration_end emits nothing.
				return
			}
			case "recovery": {
				// Recoverable errors are in-run notices, not turn outcomes;
				// any tool failure is already inline on its tool row (v1
				// parity — see the war-story comment in the v1 error case).
				Logger.warn(`[FrameMessageBridge] Recoverable agent error (run continues): ${notice.message ?? ""}`)
				return
			}
			case "status": {
				const compaction = parseCompactionNoticeMetadata(notice.metadata)
				if (compaction) {
					// Compaction dividers update in place: "started" mints the
					// row's ts, the terminal notice reuses it. A divider still
					// open at the turn's terminal is finalized there (see
					// onClose) — v1's rule, kept turn-scoped here.
					const ts =
						compaction.status === "started"
							? (this.openCompactionTs = this.bridge.deps.nextTs())
							: (this.openCompactionTs ?? this.bridge.deps.nextTs())
					if (compaction.status !== "started") {
						this.openCompactionTs = undefined
					}
					this.bridge.push(buildCompactionMessage(compaction, ts))
					return
				}
				if (INTERNAL_STATUS_NOTICES.has(notice.message ?? "")) {
					return
				}
				break
			}
			default:
				break
		}
		// Non-status notices (and unrecognized status ones) are info rows —
		// a future notice surfaces as its raw slug instead of vanishing.
		this.bridge.push({
			ts: this.bridge.deps.nextTs(),
			type: "say",
			say: "info",
			text: notice.message ?? "",
			partial: false,
		})
	}

	onUsage(usage: UsageBody): void {
		const normalized = normalizeUsageEvent(usage)
		const apiReqInfo: ClineApiReqInfo = {
			tokensIn: normalized.tokensIn,
			tokensOut: normalized.tokensOut,
			cacheWrites: normalized.cacheWrites,
			cacheReads: normalized.cacheReads,
			cost: normalized.totalCost,
		}
		this.bridge.push({
			ts: this.bridge.deps.nextTs(),
			type: "say",
			say: "api_req_started",
			text: JSON.stringify(apiReqInfo),
			partial: false,
		})
	}

	onClose(outcome: Outcome): void {
		// A compaction divider still open here means the turn was aborted or
		// errored mid-compaction: finalize it first so the divider row lands
		// before the retag/error rows (v1 order). "failed" only for a
		// terminal error event; done(reason:"error") and every other
		// terminal finalizes as "cancelled" (v1's done branch does this
		// unconditionally; its error branch is the only "failed").
		const openCompactionTs = this.openCompactionTs
		this.openCompactionTs = undefined
		if (openCompactionTs !== undefined) {
			const status = outcome.kind === "error" && outcome.via === "error" ? "failed" : "cancelled"
			this.bridge.push(buildCompactionMessage({ status, mode: "auto" }, openCompactionTs))
		}

		if (outcome.kind === "error") {
			// v1 retags neither errored turn: an errored turn didn't end on
			// its text response.
			this.turnFinalText = undefined
			if (outcome.via === "error") {
				// Serialize the error for the webview's ErrorRow (special
				// types: insufficient credits, spend limit, auth, quota) and
				// emit the recovery pair — the api_req_started replaces the
				// spinner on the last request row, the ask renders Retry.
				const errorPayload = reshapeErrorForWebview(
					{ message: outcome.error.message },
					this.bridge.deps.getActiveProviderId?.(),
					this.bridge.deps.getActiveModelId?.(),
					outcome.error.providerErrorClass,
				)
				this.bridge.push({
					ts: this.bridge.deps.nextTs(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ streamingFailedMessage: errorPayload } satisfies ClineApiReqInfo),
					partial: false,
				})
				this.bridge.push({
					ts: this.bridge.deps.nextTs(),
					type: "ask",
					ask: "api_req_failed",
					text: errorPayload,
					partial: false,
				})
			}
			// via "done": done(reason:"error") records the error outcome
			// (turn phase) but emits no rows — the coordinator reads the
			// outcome at switchover.
			return
		}

		// v1 retags only on done(reason:"completed") exactly —
		// max_iterations/mistake_limit turns keep their plain text.
		const completedExactly = outcome.kind === "completed" && (outcome.finishReason ?? "completed") === "completed"
		if (completedExactly && !this.attemptCompletionSeen) {
			// Inferred completion feedback: retag the turn's final text row
			// in place (same ts) for the legacy done visual.
			const finalText = this.turnFinalText
			this.turnFinalText = undefined
			if (finalText) {
				this.bridge.push({
					ts: finalText.ts,
					type: "say",
					say: this.bridge.deps.getUiMode?.() === "plan" ? "plan_completion_result" : "completion_result",
					text: finalText.text,
					partial: false,
				})
			}
			return
		}
		this.turnFinalText = undefined
	}

	private recordTurnFinalText(ts: number, text: string): void {
		this.turnFinalText = { ts, text }
	}

	/** The current iteration's spawn_agent group, created on first use. */
	private spawnAgentGroup(): SpawnAgentGroup {
		if (this.spawnAgents === undefined) {
			this.spawnAgents = new SpawnAgentGroup(this.bridge)
		}
		return this.spawnAgents
	}
}
