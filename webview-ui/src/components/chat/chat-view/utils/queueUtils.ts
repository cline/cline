import type { ClineAsk } from "@shared/ExtensionMessage"

/**
 * ==================================================================================
 * MESSAGE QUEUE BLOCKING LOGIC
 * ==================================================================================
 *
 * This module determines when the message queue should be blocked from processing.
 * The queue holds messages the user typed while Cline was busy. These messages
 * should only be sent at appropriate times.
 *
 * GENERAL PRINCIPLE:
 * - Block queue when user needs to make a decision
 * - Block queue during active operations that could be disrupted
 * - Allow queue when task is complete or paused for user input
 *
 * ==================================================================================
 * ASK TYPES AND THEIR BLOCKING BEHAVIOR
 * ==================================================================================
 */

/**
 * CATEGORY 1: ALWAYS BLOCKING ASKS
 *
 * These asks ALWAYS require user attention and should ALWAYS block the queue,
 * regardless of auto-approval settings.
 *
 * | Ask Type              | When It Appears           | Why Block Queue                    |
 * |-----------------------|---------------------------|------------------------------------|
 * | api_req_failed        | API call failed           | User must retry or abort           |
 * | command_output        | Command running in term   | Wait for command to complete       |
 * | mistake_limit_reached | Too many consecutive errs | User must acknowledge + guide      |
 * | condense              | Context window full       | User reviewing conversation summary|
 * | report_bug            | User filing bug report    | User composing bug details         |
 */
const ALWAYS_BLOCKING_ASKS: readonly ClineAsk[] = [
	"api_req_failed",
	"command_output",
	"mistake_limit_reached",
	"condense",
	"report_bug",
] as const

/**
 * CATEGORY 2: TOOL APPROVAL ASKS (Block Only When Auto-Approve is OFF)
 *
 * These asks ONLY appear when the corresponding auto-approval setting is OFF.
 * When auto-approval is ON, the tool executes immediately and NO ask is shown.
 *
 * KEY INSIGHT: We don't need to check autoApprovalSettings here!
 * If we see one of these asks, it means auto-approval is already OFF.
 * If auto-approval were ON, the ask would never be created.
 *
 * | Ask Type             | Auto-Approve Setting       | When Ask Appears            | When Ask Hidden           |
 * |----------------------|----------------------------|-----------------------------|---------------------------|
 * | tool                 | readFiles / editFiles      | Setting is OFF              | Setting is ON (auto-exec) |
 * | command              | executeSafe/AllCommands    | Setting is OFF              | Setting is ON (auto-exec) |
 * | browser_action_launch| useBrowser                 | Setting is OFF              | Setting is ON (auto-exec) |
 * | use_mcp_server       | useMcp                     | Setting is OFF              | Setting is ON (auto-exec) |
 *
 * FLOW WHEN AUTO-APPROVE IS ON:
 * ```
 * Model calls tool → Backend checks settings → Auto-approve ON →
 * Execute immediately → No ask() called → clineAsk stays undefined →
 * Queue sees clineAsk=undefined → NOT blocked → Works correctly ✓
 * ```
 *
 * FLOW WHEN AUTO-APPROVE IS OFF:
 * ```
 * Model calls tool → Backend checks settings → Auto-approve OFF →
 * Call ask("tool", ...) → User sees approval dialog → clineAsk="tool" →
 * Queue sees clineAsk="tool" → BLOCKED (this is what we want) ✓
 * ```
 */
const TOOL_APPROVAL_ASKS: readonly ClineAsk[] = [
	"tool", // File read/write - blocked when readFiles/editFiles is OFF
	"command", // Command execution - blocked when executeSafe/AllCommands is OFF
	"browser_action_launch", // Browser automation - blocked when useBrowser is OFF
	"use_mcp_server", // MCP tool usage - blocked when useMcp is OFF
] as const

/**
 * CATEGORY 3: ALWAYS ALLOWING ASKS
 *
 * These asks represent natural pause points where the queue SHOULD process.
 * These are moments when the user would naturally want their queued message sent.
 *
 * | Ask Type              | When It Appears           | Why ALLOW Queue                    |
 * |-----------------------|---------------------------|------------------------------------|
 * | followup              | Model asked a question    | User can answer + queue fires      |
 * | plan_mode_respond     | Plan mode discussion      | Conversational, queue is fine      |
 * | completion_result     | Task finished             | Perfect time for next request      |
 * | resume_task           | Resuming paused task      | Starting fresh, queue can fire     |
 * | resume_completed_task | Resuming completed task   | Starting fresh, queue can fire     |
 * | new_task              | New task context created  | Starting fresh, queue can fire     |
 *
 * Note: This array is for documentation purposes. The function below uses
 * the blocking arrays and allows everything else by default.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NEVER_BLOCKING_ASKS: readonly ClineAsk[] = [
	"followup",
	"plan_mode_respond",
	"completion_result",
	"resume_task",
	"resume_completed_task",
	"new_task",
] as const

/**
 * Determines if the given ask type should block queue processing.
 *
 * @param clineAsk - The current ask type, or undefined if no ask is active
 * @returns true if queue should be BLOCKED, false if queue can process
 *
 * DECISION TREE:
 * ```
 * clineAsk === undefined?
 *   └── YES → return false (queue can process, no ask blocking it)
 *   └── NO  → Is it in ALWAYS_BLOCKING_ASKS?
 *               └── YES → return true (always block)
 *               └── NO  → Is it in TOOL_APPROVAL_ASKS?
 *                           └── YES → return true (tool needs approval)
 *                           └── NO  → return false (allow queue)
 * ```
 *
 * EXAMPLES:
 *
 * Case 1: No active ask
 * ```
 * shouldBlockQueueForAsk(undefined) → false
 * // Queue can process - nothing is asking user for input
 * ```
 *
 * Case 2: API failed
 * ```
 * shouldBlockQueueForAsk("api_req_failed") → true
 * // Queue blocked - user must handle error first
 * ```
 *
 * Case 3: Tool approval (auto-approve OFF)
 * ```
 * shouldBlockQueueForAsk("tool") → true
 * // Queue blocked - user must approve/reject tool first
 * // Note: We only see "tool" ask because auto-approve is OFF
 * ```
 *
 * Case 4: Tool execution (auto-approve ON)
 * ```
 * shouldBlockQueueForAsk(undefined) → false
 * // Queue can process - but sendingDisabled=true blocks it anyway
 * // Note: clineAsk is undefined because tool auto-executed (no ask shown)
 * ```
 *
 * Case 5: Task completed
 * ```
 * shouldBlockQueueForAsk("completion_result") → false
 * // Queue can process - perfect time to send user's queued message
 * ```
 *
 * Case 6: Model asked followup
 * ```
 * shouldBlockQueueForAsk("followup") → false
 * // Queue can process - user's queued message is their response
 * ```
 */
export function shouldBlockQueueForAsk(clineAsk: ClineAsk | undefined): boolean {
	// No ask active - nothing blocking the queue from the ask side
	if (!clineAsk) {
		return false
	}

	// Category 1: Always block these - user must handle them first
	if ((ALWAYS_BLOCKING_ASKS as readonly string[]).includes(clineAsk)) {
		return true
	}

	// Category 2: Block tool approvals - user must approve/reject first
	// Note: If we see these asks, it means auto-approve is OFF for that tool type.
	// If auto-approve were ON, the ask would never be created and clineAsk would be undefined.
	if ((TOOL_APPROVAL_ASKS as readonly string[]).includes(clineAsk)) {
		return true
	}

	// Category 3 (implicit): Everything else allows queue processing
	// This includes followup, completion_result, resume_task, etc.
	return false
}

/**
 * Complete queue processing eligibility check.
 * Combines all blocking conditions into a single function.
 *
 * @returns true if queue CAN process, false if queue is BLOCKED
 *
 * BLOCKING CONDITIONS (if ANY are true, queue is blocked):
 *
 * 1. sendingDisabled = true
 *    - Active work happening (streaming, API request, tool executing)
 *    - This is the PRIMARY blocker during normal operation
 *
 * 2. messageQueueLength = 0
 *    - No messages to process (obvious)
 *
 * 3. isProcessing = true
 *    - Already processing a queued message (prevents race conditions)
 *
 * 4. messagesLength = 0
 *    - No task exists (user clicked "New Task", queue should clear not fire)
 *
 * 5. shouldBlockQueueForAsk(clineAsk) = true
 *    - User needs to make a decision (see function above for details)
 *
 * TIMING DIAGRAM - WHEN EACH BLOCKER IS ACTIVE:
 *
 * ```
 * ─────────────────────────────────────────────────────────────────────────
 * State:        | Idle | Stream | Tool(ON) | Tool(OFF) | Error | Complete |
 * ─────────────────────────────────────────────────────────────────────────
 * sendingDis.   |  ✗   |   ✓    |    ✓     |     ✗     |   ✓*  |    ✗     |
 * clineAsk      |  -   |   -    |    -     |   "tool"  | "err" | "complete"|
 * shouldBlock() |  ✗   |   ✗    |    ✗     |     ✓     |   ✓   |    ✗     |
 * ─────────────────────────────────────────────────────────────────────────
 * Queue blocked |  ✗   |   ✓    |    ✓     |     ✓     |   ✓   |    ✗     |
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Legend:
 * - Tool(ON) = Auto-approve is ON, tool executes immediately
 * - Tool(OFF) = Auto-approve is OFF, user sees approval dialog
 * - Error = api_req_failed or similar error state
 * - * = sendingDisabled may be true or false depending on error type
 * ```
 */
export function canProcessQueue(params: {
	sendingDisabled: boolean
	messageQueueLength: number
	clineAsk: ClineAsk | undefined
	isProcessing: boolean
	messagesLength: number
}): boolean {
	const { sendingDisabled, messageQueueLength, clineAsk, isProcessing, messagesLength } = params

	// Blocker 1: Active work happening
	if (sendingDisabled) {
		return false
	}

	// Blocker 2: No messages to send
	if (messageQueueLength === 0) {
		return false
	}

	// Blocker 3: Already processing (prevents duplicate sends)
	if (isProcessing) {
		return false
	}

	// Blocker 4: No task (shouldn't auto-start with queue after "New Task")
	if (messagesLength === 0) {
		return false
	}

	// Blocker 5: Ask requires user decision
	if (shouldBlockQueueForAsk(clineAsk)) {
		return false
	}

	// All checks passed - queue can process!
	return true
}
