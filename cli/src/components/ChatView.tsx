/**
 * Unified Chat View component
 * Combines the welcome screen layout with task message display
 * Messages appear above the input field, input stays at bottom
 *
 * IMPORTANT: Ink Rendering and the "Flicker Problem"
 * ==================================================
 *
 * Problem:
 * When using Ink (React for CLI), we encountered severe flickering once the
 * output grew to fill the terminal height. The top line would repeat endlessly,
 * making the UI unusable.
 *
 * Root Cause:
 * Ink uses two different rendering strategies based on output height:
 *
 * 1. When outputHeight < terminal rows: Ink uses efficient line-erasing
 *    (ansiEscapes.eraseLines) to update content in place. This is smooth.
 *
 * 2. When outputHeight >= terminal rows: Ink switches to clearTerminal() +
 *    full redraw on EVERY re-render. This causes visible flicker because:
 *    - The entire screen clears
 *    - Content redraws from scratch
 *    - This happens on every state change (typing, streaming, spinner, etc.)
 *
 * This is in Ink's onRender() method in ink.js:
 *   if (outputHeight >= this.options.stdout.rows) {
 *     this.options.stdout.write(ansiEscapes.clearTerminal + output);
 *   }
 *
 * The underlying issue is Ink's use of ansi-escapes clearTerminal which does
 * ^[2J^[3J^[H (erase screen + erase scrollback + move home) instead of more
 * efficient alternatives like ^[H^[0J (move home + erase to bottom).
 *
 * See: https://github.com/vadimdemedes/ink/issues/359
 *
 * Why Other CLIs (Claude Code, Gemini CLI) Don't Flicker:
 * =======================================================
 *
 * They keep the dynamic region small by either:
 * - Printing history as static output (logs that scroll up)
 * - Using alternate buffer with internal scrolling
 * - Never letting dynamic content reach terminal height
 *
 * Alternate Buffer Mode (What We Tried):
 * Gemini CLI uses alternate screen buffer (\x1b[?1049h) which isolates the app
 * in a separate screen (like vim/less). This eliminates flicker but has a major
 * drawback: scroll wheel doesn't work without implementing custom mouse event
 * handling. Gemini CLI built MouseProvider + ScrollProvider infrastructure to
 * capture mouse events and handle scrolling manually.
 *
 * From Gemini CLI PR #13623:
 * "We're setting the default for useAlternateBuffer back to false for now.
 * We'll plan to re-enable once we support selection without ctrl-S, speed up
 * scrolling on terminals that report fewer scroll events than ideal, and
 * optimize performance issues related to very large tool messages."
 *
 * Our Solution: Static + Dynamic Split
 * ====================================
 *
 * We use Ink's <Static> component to split content into two regions:
 *
 * 1. Static Region (header + completed messages):
 *    - Rendered ONCE when items are added
 *    - Stays above the dynamic region
 *    - Scrolls up like terminal logs
 *    - Never re-renders, so no flicker contribution
 *    - IMPORTANT: Content in Static cannot update after initial render
 *      (e.g., AccountInfoView showing "Loading..." would stay that way forever)
 *
 * 2. Dynamic Region (current streaming message + input + status):
 *    - Only contains actively changing content
 *    - Stays small (well under terminal height)
 *    - Uses efficient line-erasing, not clearTerminal
 *
 * Implementation Details:
 * - loggedMessageTs: Set<number> tracks which messages have been rendered to Static
 * - headerLogged: boolean tracks if the header has been rendered
 * - staticItems: array of items to render in Static (header + new completed messages)
 * - completedMessages: messages that are done (not partial/streaming)
 * - currentMessage: the single message currently streaming (if any)
 *
 * When a message completes (partial becomes false), it moves from the dynamic
 * region to Static. The dynamic region only ever contains 0-1 messages plus
 * the input UI, keeping it well under terminal height.
 *
 * Other Important Settings:
 * - patchConsole: false in render() options - prevents Ink from interfering with console
 * - Console suppression in utils/console.ts - prevents core debug output from breaking Ink
 *
 * Centering in Static:
 * Ink's Box centering (justifyContent, alignItems) doesn't work reliably inside
 * Static. We use manual centering via centerText() which pads strings based on
 * process.stdout.columns.
 *
 * References:
 * - Ink flicker issue: https://github.com/vadimdemedes/ink/issues/359
 * - Gemini CLI (uses same @jrichman/ink fork): https://github.com/google-gemini/gemini-cli
 * - Gemini CLI alternate buffer PR: https://github.com/google-gemini/gemini-cli/pull/13623
 * - Ink source: node_modules/ink/build/ink.js (onRender method)
 * - log-update: node_modules/ink/build/log-update.js (eraseLines logic)
 */

import type { ApiProvider, ModelInfo } from "@shared/api"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics, getLastApiReqTotalTokens } from "@shared/getApiMetrics"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
import { getProviderModelIdKey } from "@shared/storage"
import type { Mode } from "@shared/storage/types"
import { execSync } from "child_process"
import { Box, Static, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getAvailableSlashCommands } from "@/core/controller/slash/getAvailableSlashCommands"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { StateManager } from "@/core/storage/StateManager"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { COLORS } from "../constants/colors"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useHomeEndKeys } from "../hooks/useHomeEndKeys"
import { useIsSpinnerActive } from "../hooks/useStateSubscriber"
import { findWordEnd, findWordStart, useTextInput } from "../hooks/useTextInput"
import { moveCursorDown, moveCursorUp } from "../utils/cursor"
import { setTerminalTitle } from "../utils/display"
import {
	checkAndWarnRipgrepMissing,
	extractMentionQuery,
	type FileSearchResult,
	insertMention,
	searchWorkspaceFiles,
} from "../utils/file-search"
import { isMouseEscapeSequence } from "../utils/input"
import { jsonParseSafe, parseImagesFromInput } from "../utils/parser"
import { extractSlashQuery, filterCommands, insertSlashCommand, sortCommandsWorkflowsFirst } from "../utils/slash-commands"
import { isFileEditTool, parseToolFromMessage } from "../utils/tools"
import { shutdownEvent } from "../vscode-shim"
import { ActionButtons, type ButtonActionType, getButtonConfig, getVisibleButtons } from "./ActionButtons"
import { AsciiMotionCli, StaticRobotFrame } from "./AsciiMotionCli"
import { ChatMessage } from "./ChatMessage"
import { FileMentionMenu } from "./FileMentionMenu"
import { HelpPanelContent } from "./HelpPanelContent"
import { HighlightedInput } from "./HighlightedInput"
import { HistoryPanelContent } from "./HistoryPanelContent"
import { providerModels } from "./ModelPicker"
import { SettingsPanelContent } from "./SettingsPanelContent"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { ThinkingIndicator } from "./ThinkingIndicator"

interface ChatViewProps {
	controller?: any
	onExit?: () => void
	onComplete?: () => void
	onError?: () => void
	initialPrompt?: string
	initialImages?: string[]
	taskId?: string
}

const SEARCH_DEBOUNCE_MS = 150
const RIPGREP_WARNING_DURATION_MS = 5000
const MAX_SEARCH_RESULTS = 15
const DEFAULT_CONTEXT_WINDOW = 200000
const PASTE_COLLAPSE_THRESHOLD = 100 // Characters before showing placeholder
const MAX_HISTORY_ITEMS = 20 // Max history items to navigate with up/down arrows

/**
 * Get current git branch name
 */
function getGitBranch(cwd?: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
		return branch
	} catch {
		return null
	}
}

interface GitDiffStats {
	files: number
	additions: number
	deletions: number
}

/**
 * Get git diff stats (files changed, additions, deletions)
 */
function getGitDiffStats(cwd?: string): GitDiffStats | null {
	try {
		const output = execSync("git diff --shortstat", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()

		if (!output) return null

		// Parse output like "2 files changed, 10 insertions(+), 5 deletions(-)"
		const filesMatch = output.match(/(\d+) file/)
		const addMatch = output.match(/(\d+) insertion/)
		const delMatch = output.match(/(\d+) deletion/)

		return {
			files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
			additions: addMatch ? parseInt(addMatch[1], 10) : 0,
			deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
		}
	} catch {
		return null
	}
}

/**
 * Create a progress bar for context window usage
 * Returns { filled, empty } strings to allow different coloring
 */
function createContextBar(used: number, total: number, width: number = 8): { filled: string; empty: string } {
	const ratio = Math.min(used / total, 1)
	// Use ceil so any usage > 0 shows at least one bar
	const filledCount = used > 0 ? Math.max(1, Math.ceil(ratio * width)) : 0
	const emptyCount = width - filledCount
	return { filled: "█".repeat(filledCount), empty: "█".repeat(emptyCount) }
}

/**
 * Center text by padding with spaces
 */
function centerText(text: string, terminalWidth?: number): string {
	const width = terminalWidth || process.stdout.columns || 80
	const padding = Math.max(0, Math.floor((width - text.length) / 2))
	return " ".repeat(padding) + text
}

/**
 * Yolo mode auto-approves tool use, commands, browser actions, etc. so the AI can work
 * uninterrupted. But some ask types genuinely need user input -- you can't auto-approve
 * "task completed, what next?" or a followup question the AI is asking the user.
 *
 * This whitelist defines which ask types should still show buttons and allow text input
 * even when yolo mode is enabled. Everything NOT in this set gets suppressed (buttons
 * hidden, input blocked), which is the correct behavior for tool/browser/mcp approvals
 * since core auto-approves those before they even reach the UI.
 *
 * Any new ask types added in the future will be suppressed by default in yolo mode.
 * If a new ask type needs user interaction, add it here explicitly.
 */
const YOLO_INTERACTIVE_ASKS = new Set<ClineAsk>([
	"completion_result",
	// In yolo mode, ExecuteCommandToolHandler auto-approves commands via say() (not ask()) at line 176,
	// so command asks never reach the UI for regular tool use. The only command ask that reaches the UI
	// is from AttemptCompletionHandler (line 135), which uses askApprovalAndPushFeedback("command", ...)
	// to let the user choose whether to run the suggested verification command after task completion.
	"command",
	"followup",
	"plan_mode_respond",
	"resume_task",
	"resume_completed_task",
	"new_task",
])

function isYoloSuppressed(yolo: boolean, ask: ClineAsk | undefined): boolean {
	return yolo && (!ask || !YOLO_INTERACTIVE_ASKS.has(ask))
}

/**
 * Get the type of prompt needed for an ask message
 */
function getAskPromptType(ask: ClineAsk, text: string): "confirmation" | "text" | "options" | "none" {
	switch (ask) {
		case "followup":
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, { options: undefined as string[] | undefined })
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			return "text"
		}
		case "completion_result":
			return "text"
		case "resume_task":
		case "resume_completed_task":
		case "command":
		case "tool":
		case "browser_action_launch":
		case "use_mcp_server":
		case "api_req_failed":
			return "confirmation"
		default:
			return "none"
	}
}

/**
 * Parse options from an ask message
 */
function parseAskOptions(text: string): string[] {
	const parts = jsonParseSafe(text, { options: [] as string[] })
	return parts.options || []
}

/**
 * Expand pasted text placeholders back to actual content
 * Replaces [Pasted text #N +X lines] with the stored content
 */
function expandPastedTexts(text: string, pastedTexts: Map<number, string>): string {
	return text.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (match, num) => {
		const content = pastedTexts.get(parseInt(num, 10))
		return content ?? match
	})
}

export const ChatView: React.FC<ChatViewProps> = ({
	controller,
	onExit,
	onComplete: _onComplete,
	onError,
	initialPrompt,
	initialImages,
	taskId,
}) => {
	// Get Ink app instance for graceful exit
	const { exit: inkExit } = useApp()

	// Get task state from context
	const taskState = useTaskState()
	const { controller: taskController, clearState } = useTaskContext()
	const { isActive: isSpinnerActive, startTime: spinnerStartTime } = useIsSpinnerActive()

	// Prefer prop controller over context controller (memoized for stable reference in callbacks)
	const ctrl = useMemo(() => controller || taskController, [controller, taskController])

	// Input state - using hook for text editing with keyboard shortcuts
	const {
		text: textInput,
		cursorPos,
		setText: setTextInput,
		setCursorPos,
		handleKeyboardSequence,
		handleCtrlShortcut,
		deleteCharBefore,
		insertText: insertTextAtCursor,
	} = useTextInput()

	// Ref for text input (used by useHomeEndKeys)
	const textInputRef = useRef(textInput)
	textInputRef.current = textInput

	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0) // For file menu
	const [historyIndex, setHistoryIndex] = useState(-1) // -1 = not browsing history, 0+ = history item index
	const [savedInput, setSavedInput] = useState("") // Save user's input when entering history mode
	const [isSearching, setIsSearching] = useState(false)
	const [showRipgrepWarning, setShowRipgrepWarning] = useState(false)
	const [respondedToAsk, setRespondedToAsk] = useState<number | null>(null)
	const [userScrolled, setUserScrolled] = useState(false)

	// Pasted text storage - maps placeholder number to full pasted content
	const [pastedTexts, setPastedTexts] = useState<Map<number, string>>(new Map())
	const pasteCounterRef = useRef(0)
	// Track paste timing to combine chunks that arrive in rapid succession
	const lastPasteTimeRef = useRef<number>(0)
	const activePasteNumRef = useRef<number>(0)
	const activePasteStartPosRef = useRef<number>(0) // Where the placeholder starts in the text
	const activePasteLinesRef = useRef<number>(0) // Total line count for current paste
	const pasteUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Debounce placeholder updates
	const PASTE_CHUNK_WINDOW_MS = 150 // Chunks within this window are combined into one paste
	const PASTE_UPDATE_DEBOUNCE_MS = 50 // Debounce visual updates to avoid flicker

	// Slash command state
	const [availableCommands, setAvailableCommands] = useState<SlashCommandInfo[]>([])
	const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
	const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
	const lastSlashIndexRef = useRef<number>(-1)

	// Panel state
	const [activePanel, setActivePanel] = useState<
		| { type: "settings"; initialMode?: "model-picker" | "featured-models"; initialModelKey?: "actModelId" | "planModelId" }
		| { type: "history" }
		| { type: "help" }
		| null
	>(null)

	// Handle Home/End keys from raw stdin (Ink doesn't expose these in useInput)
	useHomeEndKeys({
		onHome: useCallback(() => setCursorPos(0), [setCursorPos]),
		onEnd: useCallback(() => setCursorPos(textInputRef.current.length), [setCursorPos]),
		isActive: !activePanel, // Only active when no panel is open
	})

	// Track when we're exiting to hide UI elements before exit
	const [isExiting, setIsExiting] = useState(false)

	// Task switch handling: when switching tasks via /history, we clear the terminal and
	// increment a counter used as the root Box's key. This forces React to remount the tree,
	// giving us a fresh Static instance. Mirrors how App.tsx handles resize with resizeKey.
	const [taskSwitchKey, setTaskSwitchKey] = useState(0)
	const prevFirstMessageTs = useRef<number | null>(null)

	// Listen for shutdown event (Ctrl+C) to hide UI before exit
	useEffect(() => {
		const subscription = shutdownEvent.event(() => {
			const session = Session.get()
			const summary = session.getStats()
			telemetryService.captureHostEvent("exit", JSON.stringify(summary))
			setIsExiting(true)
		})
		return () => subscription.dispose()
	}, [])

	const [gitBranch, setGitBranch] = useState<string | null>(null)
	const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats | null>(null)

	// Mode state
	const [mode, setMode] = useState<Mode>(() => {
		const stateManager = StateManager.get()
		return stateManager.getGlobalSettingsKey("mode") || "act"
	})

	const [yolo, setYolo] = useState<boolean>(() => StateManager.get().getGlobalSettingsKey("yoloModeToggled") ?? false)
	const [autoApproveAll, setAutoApproveAll] = useState<boolean>(
		() => StateManager.get().getGlobalSettingsKey("autoApproveAllToggled") ?? false,
	)

	// Sync mode from core state updates (e.g. yolo auto-switching plan to act)
	useEffect(() => {
		if (taskState.mode && taskState.mode !== mode) {
			setMode(taskState.mode as Mode)
		}
	}, [taskState.mode])

	const toggleAutoApproveAll = useCallback(() => {
		const newValue = !autoApproveAll
		setAutoApproveAll(newValue)
		StateManager.get().setGlobalState("autoApproveAllToggled", newValue)
	}, [autoApproveAll])

	// Get provider based on current mode (computed first since modelId depends on it)
	const provider = useMemo(() => {
		const stateManager = StateManager.get()
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		return (stateManager.getGlobalSettingsKey(providerKey) as string) || ""
	}, [mode, activePanel])

	// Get model ID based on current mode and provider
	// Different providers use different state keys (e.g., cline uses actModeOpenRouterModelId)
	// Re-read when activePanel changes (settings panel closes) to pick up changes
	const modelId = useMemo(() => {
		if (!provider) return ""
		const stateManager = StateManager.get()
		const modelKey = getProviderModelIdKey(provider as ApiProvider, mode)
		return (stateManager.getGlobalSettingsKey(modelKey as string) as string) || ""
	}, [mode, provider, activePanel])

	const toggleMode = useCallback(async () => {
		const newMode: Mode = mode === "act" ? "plan" : "act"
		setMode(newMode)

		// When switching from plan to act, include any text in the input box
		// Text stays visible in the input - don't clear it
		if (newMode === "act" && textInput.trim()) {
			const expandedText = expandPastedTexts(textInput, pastedTexts)
			await ctrl.togglePlanActMode(newMode, { message: expandedText.trim() })
		} else {
			await ctrl.togglePlanActMode(newMode)
		}
	}, [mode, ctrl, textInput, pastedTexts])

	// Clear the terminal view and reset task state (used by /clear and "Start New Task" button)
	// This is async to ensure clearTask() completes before we remount, preventing race conditions
	// where the old messages get fetched and restored before the controller clears them.
	const clearViewAndResetTask = useCallback(async () => {
		// First, clear the task on the controller and wait for it to finish
		// This ensures the controller has no messages before we remount
		if (ctrl) {
			await ctrl.clearTask()
		}

		// Now clear the terminal and reset React state
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H") // Clear screen + scrollback, cursor home
		setTaskSwitchKey((k) => k + 1) // Force remount for fresh Static instance
		clearState() // Force clear React state (bypasses empty messages check)
		setTextInput("")
		setCursorPos(0)

		// Post the now-empty state
		if (ctrl) {
			ctrl.postStateToWebview()
		}
	}, [ctrl, clearState])

	const refs = useRef({
		searchTimeout: null as NodeJS.Timeout | null,
		lastQuery: "",
		hasCheckedRipgrep: false,
	})

	const { prompt, imagePaths } = parseImagesFromInput(textInput)
	const mentionInfo = useMemo(() => extractMentionQuery(textInput), [textInput])
	const slashInfo = useMemo(() => extractSlashQuery(textInput, cursorPos), [textInput, cursorPos])
	const filteredCommands = useMemo(
		() => filterCommands(availableCommands, slashInfo.query),
		[availableCommands, slashInfo.query],
	)

	// Reset slash menu dismissed state when a new slash is typed
	useEffect(() => {
		if (slashInfo.slashIndex !== lastSlashIndexRef.current) {
			lastSlashIndexRef.current = slashInfo.slashIndex
			setSlashMenuDismissed(false)
			setSelectedSlashIndex(0)
		}
	}, [slashInfo.slashIndex])

	const workspacePath = useMemo(() => {
		try {
			const root = ctrl?.getWorkspaceManagerSync?.()?.getPrimaryRoot?.()
			if (root?.path) {
				return root.path
			}
		} catch {
			// Fallback to cwd
		}
		return process.cwd()
	}, [ctrl])

	// Get git branch on mount
	useEffect(() => {
		setGitBranch(getGitBranch(workspacePath))
		setGitDiffStats(getGitDiffStats(workspacePath))
	}, [workspacePath])

	// Load existing task when taskId is provided
	useEffect(() => {
		if (!taskId) return
		if (!ctrl) return
		// Prevent duplicate loads after resize. The resize fix remounts components via
		// resizeKey, but the controller's task persists. Skip if already loaded.
		if (ctrl.task?.taskId === taskId) return

		// Load the task by ID
		showTaskWithId(ctrl, StringRequest.create({ value: taskId })).catch((error) => {
			console.error("Error loading task:", error)
			onError?.()
		})
	}, [taskId, ctrl, onError])

	// Load available slash commands on mount
	useEffect(() => {
		const loadCommands = async () => {
			if (!ctrl) return
			try {
				const response = await getAvailableSlashCommands(ctrl, EmptyRequest.create())
				const cliCommands = response.commands.filter((cmd) => cmd.cliCompatible !== false)
				// Add CLI-only commands (like /settings) that are handled locally
				const cliOnlyCommands: SlashCommandInfo[] = CLI_ONLY_COMMANDS.map((cmd) => ({
					name: cmd.name,
					description: cmd.description || "",
					section: cmd.section || "default",
					cliCompatible: true,
				}))
				setAvailableCommands([...cliOnlyCommands, ...sortCommandsWorkflowsFirst(cliCommands)])
			} catch {
				// Fallback: commands will be empty, menu won't show
			}
		}
		loadCommands()
	}, [ctrl])

	// Get history items (limited to MAX_HISTORY_ITEMS, most recent first)
	const getHistoryItems = useCallback(() => {
		const history = StateManager.get().getGlobalStateKey("taskHistory")
		if (!history?.length) return []
		const filtered = [...history]
			.reverse()
			.map((item) => item.task)
			.slice(0, MAX_HISTORY_ITEMS)
			.filter(Boolean) as string[]
		return [...new Set(filtered)]
	}, [])

	const messages = taskState.clineMessages || []

	// Refresh git diff stats when messages change (after file edits)
	const lastMsg = messages[messages.length - 1]
	useEffect(() => {
		setGitDiffStats(getGitDiffStats(workspacePath))
	}, [messages.length, lastMsg?.partial, lastMsg?.ts, workspacePath])

	// Filter messages we want to display
	const displayMessages = useMemo(() => {
		const filtered = messages.filter((m) => {
			if (m.say === "api_req_finished") return false
			if (m.say === "checkpoint_created") return false
			if (m.say === "api_req_started") return false
			if (m.say === "api_req_retried") return false // Redundant with error_retry messages
			if (m.say === "reasoning") return false // Hide thinking traces - they clutter the UI
			return true
		})

		// Combine command messages with their output (like webview does)
		return combineCommandSequences(filtered)
	}, [messages])

	// Detect task switches by watching first message timestamp change.
	// When user selects a different task from /history, the messages array updates with
	// the new task's messages. We clear the terminal first, then increment the key to
	// trigger a re-render. The clear must happen before setState so the new render isn't wiped.
	const firstMessageTs = displayMessages[0]?.ts ?? null
	useEffect(() => {
		if (prevFirstMessageTs.current !== null && firstMessageTs !== null && prevFirstMessageTs.current !== firstMessageTs) {
			process.stdout.write("\x1b[2J\x1b[3J\x1b[H") // Clear screen + scrollback, cursor home
			setTaskSwitchKey((k) => k + 1) // Trigger remount after clear
		}
		prevFirstMessageTs.current = firstMessageTs
	}, [firstMessageTs])

	// Split messages into completed (for Static) and current (for dynamic region)
	const { completedMessages, currentMessage } = useMemo(() => {
		const completed: typeof displayMessages = []
		let current: (typeof displayMessages)[0] | null = null

		// Tool types that should skip dynamic rendering entirely.
		// Plan and completion text tend to be very long, and because this typically
		// exceeds the height of the user's terminal, it causes flashing issues
		// (Ink uses clearTerminal when output >= terminal rows).
		// These messages wait until complete before showing directly in static.
		const skipDynamicTypes = new Set(["completion_result", "plan_mode_respond"])

		// Check if a followup message has options but no selection yet
		const isUnselectedFollowup = (msg: (typeof displayMessages)[0]) => {
			if (msg.type === "ask" && msg.ask === "followup" && msg.text) {
				try {
					const parsed = JSON.parse(msg.text)
					return parsed.options && parsed.options.length > 0 && !parsed.selected
				} catch {
					return false
				}
			}
			return false
		}

		// Check if message is a file edit tool (should skip dynamic to avoid rendering issues)
		const isFileEditToolMessage = (msg: (typeof displayMessages)[0]) => {
			if ((msg.say === "tool" || msg.ask === "tool") && msg.text) {
				const toolInfo = parseToolFromMessage(msg.text)
				return toolInfo ? isFileEditTool(toolInfo.toolName) : false
			}
			return false
		}

		// Check if a command should stay in dynamic region
		// Commands need to wait for output to be combined before going to static
		const shouldCommandStayInDynamic = (msg: (typeof displayMessages)[0], isLast: boolean) => {
			const isCommand = msg.ask === "command" || msg.say === "command"
			if (!isCommand) return false

			// If not completed, definitely stay in dynamic
			if (!msg.commandCompleted) return true

			// If completed but no output yet AND still the last message,
			// stay in dynamic to allow output to be combined
			const hasOutput = msg.text?.includes("Output:") ?? false
			if (!hasOutput && isLast) return true

			return false
		}

		for (let i = 0; i < displayMessages.length; i++) {
			const msg = displayMessages[i]
			const isLast = i === displayMessages.length - 1

			// Check if this message type should skip dynamic rendering
			const shouldSkipDynamic =
				skipDynamicTypes.has(msg.say || "") ||
				(msg.type === "ask" && skipDynamicTypes.has(msg.ask || "")) ||
				isFileEditToolMessage(msg)

			if (msg.partial) {
				// Message is still streaming
				if (isLast && !shouldSkipDynamic) {
					// Show in dynamic region (normal streaming)
					current = msg
				}
				// If shouldSkipDynamic and partial: don't show anywhere, wait for complete
			} else if (isLast && isUnselectedFollowup(msg)) {
				// Keep unselected followup in dynamic region so it updates when selected
				current = msg
			} else if (shouldCommandStayInDynamic(msg, isLast)) {
				// Command needs to stay in dynamic to allow output to be combined
				if (isLast) {
					current = msg
				}
				// If not last but should stay in dynamic, don't add to static yet
			} else {
				// Message is complete, add to static
				completed.push(msg)
			}
		}

		return { completedMessages: completed, currentMessage: current }
	}, [displayMessages])

	// Determine if we're in welcome state (no messages yet and user hasn't scrolled)
	const isWelcomeState = displayMessages.length === 0 && !userScrolled

	// Build Static items - each item is rendered once and stays above dynamic content
	// We pass ALL completed messages to Static and let Ink handle deduplication by key.
	// Static internally tracks which keys have been rendered and only renders new ones.
	const staticItems = useMemo(() => {
		const items: Array<
			{ key: string; type: "header" } | { key: string; type: "message"; message: (typeof displayMessages)[0] }
		> = []

		// Add header as first item ONLY after messages start or user scrolls (so animated robot shows first)
		// Once messages exist or user scrolls, add header to static so it scrolls up with history
		if (displayMessages.length > 0 || userScrolled) {
			items.push({ key: "header", type: "header" })
		}

		// Pass ALL completed messages to Static - it will dedupe by key internally
		for (const msg of completedMessages) {
			items.push({ key: String(msg.ts), type: "message", message: msg })
		}

		return items
	}, [completedMessages, displayMessages.length, userScrolled])

	// Check for pending ask message
	const lastMessage = messages[messages.length - 1]
	const pendingAsk =
		lastMessage?.type === "ask" && !lastMessage.partial && respondedToAsk !== lastMessage.ts ? lastMessage : null
	const askType = pendingAsk ? getAskPromptType(pendingAsk.ask as ClineAsk, pendingAsk.text || "") : "none"
	const askOptions = pendingAsk && askType === "options" ? parseAskOptions(pendingAsk.text || "") : []

	// Send response to ask message
	const sendAskResponse = useCallback(
		async (responseType: string, text?: string) => {
			if (!ctrl?.task || !pendingAsk) return

			// Expand any pasted text placeholders
			const expandedText = text ? expandPastedTexts(text, pastedTexts) : text

			setRespondedToAsk(pendingAsk.ts)
			setTextInput("")
			setCursorPos(0)
			setPastedTexts(new Map()) // Clear stored pastes
			pasteCounterRef.current = 0

			try {
				await ctrl.task.handleWebviewAskResponse(responseType, expandedText)
			} catch {
				// Controller may be disposed
			}
		},
		[ctrl, pendingAsk, pastedTexts],
	)

	// Handle cancel/interrupt
	const handleCancel = useCallback(async () => {
		if (!ctrl) return

		try {
			await ctrl.cancelTask()
		} catch {
			// Controller may be disposed
		}
	}, [ctrl])

	// Handle exit - hide input first, show summary, then exit Ink app gracefully
	const handleExit = useCallback(() => {
		setIsExiting(true)
		// Delay to allow Ink to re-render with session summary visible
		setTimeout(() => {
			inkExit()
			onExit?.()
		}, 150)
	}, [inkExit, onExit])

	// Get button config based on the last message state
	const buttonConfig = useMemo(() => {
		const lastMsg = messages[messages.length - 1] as ClineMessage | undefined
		return getButtonConfig(lastMsg, isSpinnerActive)
	}, [messages, isSpinnerActive])

	// Handle button actions (1 for primary, 2 for secondary)
	const handleButtonAction = useCallback(
		async (action: ButtonActionType | undefined, _isPrimary: boolean) => {
			if (!action) return

			if (!ctrl) return

			switch (action) {
				case "approve":
				case "retry":
					sendAskResponse("yesButtonClicked")
					break
				case "reject":
					// Check for states that should trigger exit (all end-of-task states with Exit button)
					if (
						pendingAsk?.ask === "resume_task" ||
						pendingAsk?.ask === "resume_completed_task" ||
						pendingAsk?.ask === "completion_result" ||
						pendingAsk?.ask === "new_task"
					) {
						handleExit()
					} else {
						sendAskResponse("noButtonClicked")
					}
					break
				case "proceed":
					// Proceed can be either yesButtonClicked or messageResponse depending on context
					sendAskResponse("yesButtonClicked")
					break
				case "new_task":
					if (pendingAsk?.ask === "new_task") {
						// Model called new_task tool - create new task with context
						setRespondedToAsk(pendingAsk.ts)
						setTextInput("")
						setCursorPos(0)
						await ctrl.initTask(pendingAsk.text || "")
					} else {
						// From completion_result or resume_completed_task - full clear
						await clearViewAndResetTask()
					}
					break
				case "cancel":
					handleCancel()
					break
			}
		},
		[controller, taskController, sendAskResponse, pendingAsk, handleExit, handleCancel, clearViewAndResetTask],
	)

	// Handle task submission (new task)
	const handleSubmit = useCallback(
		async (text: string, images: string[]) => {
			if (!ctrl || !text.trim()) return

			// Expand any pasted text placeholders
			const expandedText = expandPastedTexts(text, pastedTexts)

			setTextInput("")
			setCursorPos(0)
			setPastedTexts(new Map()) // Clear stored pastes
			pasteCounterRef.current = 0

			try {
				// Convert image paths to data URLs if needed
				const imageDataUrls =
					images.length > 0
						? await Promise.all(
								images.map(async (p) => {
									try {
										const fs = await import("fs/promises")
										const path = await import("path")
										const data = await fs.readFile(p)
										const ext = path.extname(p).toLowerCase().slice(1)
										const mimeType = ext === "jpg" ? "jpeg" : ext
										return `data:image/${mimeType};base64,${data.toString("base64")}`
									} catch {
										return null
									}
								}),
							)
						: []
				const validImages = imageDataUrls.filter((img): img is string => img !== null)
				setTerminalTitle(expandedText.trim())
				await ctrl.initTask(expandedText.trim(), validImages.length > 0 ? validImages : undefined)
			} catch (_error) {
				onError?.()
			}
		},
		[ctrl, onError, pastedTexts],
	)

	// Auto-submit initial prompt if provided
	useEffect(() => {
		const autoSubmit = async () => {
			if (!initialPrompt && (!initialImages || initialImages.length === 0)) {
				return
			}

			const ctrl = controller || taskController
			if (!ctrl) {
				return
			}

			// Small delay to ensure TaskContext subscription is set up
			// TaskContextProvider's useEffect needs to override postStateToWebview first
			await new Promise((resolve) => setTimeout(resolve, 100))

			try {
				// Set terminal title to the task prompt
				if (initialPrompt) {
					setTerminalTitle(initialPrompt)
				}
				// initialImages are already data URLs from index.ts processing
				await ctrl.initTask(initialPrompt || "", initialImages && initialImages.length > 0 ? initialImages : undefined)
			} catch (_error) {
				onError?.()
			}
		}

		autoSubmit()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []) // Only run once on mount

	// Search for files when in mention mode
	useEffect(() => {
		const { current: r } = refs

		if (!mentionInfo.inMentionMode) {
			setFileResults([])
			setSelectedIndex(0)
			if (r.searchTimeout) {
				clearTimeout(r.searchTimeout)
				r.searchTimeout = null
			}
			return
		}

		// Check for ripgrep on first mention trigger
		if (!r.hasCheckedRipgrep) {
			r.hasCheckedRipgrep = true
			if (checkAndWarnRipgrepMissing()) {
				setShowRipgrepWarning(true)
				setTimeout(() => setShowRipgrepWarning(false), RIPGREP_WARNING_DURATION_MS)
			}
		}

		const { query } = mentionInfo
		if (query === r.lastQuery) {
			return
		}
		r.lastQuery = query

		if (r.searchTimeout) {
			clearTimeout(r.searchTimeout)
		}
		setIsSearching(true)

		r.searchTimeout = setTimeout(async () => {
			try {
				const results = await searchWorkspaceFiles(query, workspacePath, MAX_SEARCH_RESULTS)
				setFileResults(results)
				setSelectedIndex(0)
			} catch {
				setFileResults([])
			} finally {
				setIsSearching(false)
			}
		}, SEARCH_DEBOUNCE_MS)

		return () => {
			if (r.searchTimeout) {
				clearTimeout(r.searchTimeout)
			}
		}
	}, [mentionInfo.inMentionMode, mentionInfo.query, workspacePath])

	// Handle keyboard input
	//
	// KEYBOARD PRIORITY ORDER (first match wins):
	// 1. Mouse escape sequences -> filtered out (from AsciiMotionCli tracking)
	// 2. Option+arrow escape sequences -> word navigation (handleKeyboardSequence)
	// 3. Option+arrow via key.meta -> word navigation (backup for when Ink parses it)
	// 4. Panel open -> bail (let panel handle its own input)
	// 5. Slash menu open -> menu navigation (up/down/tab/return/escape)
	// 6. File menu open -> menu navigation (up/down/tab/return/escape)
	// 7. History navigation -> up/down when input empty or matches history item
	// 8. Button actions -> "1"/"2" keys when buttons shown and no text typed
	// 9. Ask responses -> return to send, numbers for option selection
	// 10. Ctrl shortcuts -> Ctrl+A/E/W/U (handleCtrlShortcut)
	// 11. Large paste detection -> collapse into placeholder
	// 12. Normal input -> tab (mode toggle), return (submit), backspace, arrows, text
	//
	// Note: Home/End keys are handled separately by useHomeEndKeys hook because
	// Ink doesn't expose them in useInput (it sets input='' for these keys).
	//
	useInput((input, key) => {
		// 1. Filter out mouse escape sequences from AsciiMotionCli's mouse tracking
		if (isMouseEscapeSequence(input)) {
			return
		}

		// 2. Handle Option+arrow escape sequences for word navigation
		if (handleKeyboardSequence(input)) {
			return
		}

		// 3. Handle Option+arrow via key.meta (backup - Ink sometimes parses these instead of passing raw sequence)
		if (key.meta) {
			if (key.leftArrow) {
				setCursorPos(findWordStart(textInput, cursorPos))
				return
			}
			if (key.rightArrow) {
				setCursorPos(findWordEnd(textInput, cursorPos))
				return
			}
		}

		// 4. When a panel is open, let the panel handle its own input
		if (activePanel) {
			return
		}

		const inSlashMenu = slashInfo.inSlashMode && filteredCommands.length > 0 && !slashMenuDismissed
		const inFileMenu = mentionInfo.inMentionMode && fileResults.length > 0 && !inSlashMenu

		// 5. Slash command menu navigation (takes priority over file menu)
		if (inSlashMenu) {
			if (key.upArrow) {
				setSelectedSlashIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				setSelectedSlashIndex((i) => Math.min(filteredCommands.length - 1, i + 1))
				return
			}
			if (key.tab || key.return) {
				const cmd = filteredCommands[selectedSlashIndex]
				if (cmd) {
					// Handle CLI-only commands locally
					if (cmd.name === "help") {
						setActivePanel({ type: "help" })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "settings") {
						setActivePanel({ type: "settings" })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "models") {
						const apiConfig = StateManager.get().getApiConfiguration()
						// Use current mode's provider to determine picker type
						const provider =
							mode === "act"
								? apiConfig.actModeApiProvider || apiConfig.planModeApiProvider
								: apiConfig.planModeApiProvider || apiConfig.actModeApiProvider
						const initialMode = !provider ? undefined : provider === "cline" ? "featured-models" : "model-picker"
						// Set model for current mode (plan or act)
						const initialModelKey = mode === "act" ? "actModelId" : "planModelId"
						setActivePanel({ type: "settings", initialMode, initialModelKey })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "history") {
						setActivePanel({ type: "history" })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "clear") {
						clearViewAndResetTask()
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "exit") {
						handleExit()
						return
					}
					const newText = insertSlashCommand(textInput, slashInfo.slashIndex, cmd.name)
					setTextInput(newText)
					setCursorPos(newText.length)
					setSelectedSlashIndex(0)
				}
				return
			}
			if (key.escape) {
				// Dismiss the menu without modifying text
				setSlashMenuDismissed(true)
				setSelectedSlashIndex(0)
				return
			}
		}

		// 6. File mention menu navigation
		if (inFileMenu) {
			if (key.upArrow) {
				setSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((i) => Math.min(fileResults.length - 1, i + 1))
				return
			}
			if (key.tab || key.return) {
				const file = fileResults[selectedIndex]
				if (file) {
					const newText = insertMention(textInput, mentionInfo.atIndex, file.path)
					setTextInput(newText)
					setCursorPos(newText.length)
					setFileResults([])
					setSelectedIndex(0)
				}
				return
			}
			if (key.escape) {
				setFileResults([])
				setSelectedIndex(0)
				return
			}
		}

		// 7. History navigation with up/down arrows
		// Only works when: input is empty, or input matches the currently selected history item
		if (key.upArrow && !inSlashMenu && !inFileMenu) {
			const historyItems = getHistoryItems()
			if (historyItems.length > 0) {
				const canNavigate =
					textInput === "" ||
					(historyIndex >= 0 && historyIndex < historyItems.length && textInput === historyItems[historyIndex])

				if (canNavigate) {
					// Save original input when first entering history mode
					if (historyIndex === -1) {
						setSavedInput(textInput)
					}
					const newIndex = Math.min(historyIndex + 1, historyItems.length - 1)
					if (newIndex !== historyIndex) {
						setHistoryIndex(newIndex)
						const historyText = historyItems[newIndex]
						setTextInput(historyText)
						setCursorPos(historyText.length)
					}
					return
				}
			}
		}

		if (key.downArrow && !inSlashMenu && !inFileMenu) {
			const historyItems = getHistoryItems()
			if (historyIndex >= 0) {
				const canNavigate = historyIndex < historyItems.length && textInput === historyItems[historyIndex]

				if (canNavigate) {
					const newIndex = historyIndex - 1
					if (newIndex >= 0) {
						// Move to older history item
						setHistoryIndex(newIndex)
						const historyText = historyItems[newIndex]
						setTextInput(historyText)
						setCursorPos(historyText.length)
					} else {
						// Exit history mode, restore saved input
						setHistoryIndex(-1)
						setTextInput(savedInput)
						setCursorPos(savedInput.length)
					}
					return
				}
			}
		}

		// 8. Handle button actions (1 for primary, 2 for secondary)
		// Only when buttons are enabled, not streaming, and no text has been typed
		if (
			buttonConfig.enableButtons &&
			!isSpinnerActive &&
			textInput === "" &&
			!isYoloSuppressed(yolo, pendingAsk?.ask as ClineAsk | undefined)
		) {
			const { hasPrimary, hasSecondary } = getVisibleButtons(buttonConfig)

			if (input === "1") {
				// "1" triggers primary if shown, otherwise secondary if it's the only button
				if (hasPrimary && buttonConfig.primaryAction) {
					handleButtonAction(buttonConfig.primaryAction, true)
					return
				} else if (hasSecondary && !hasPrimary && buttonConfig.secondaryAction) {
					handleButtonAction(buttonConfig.secondaryAction, false)
					return
				}
			}
			if (input === "2" && hasPrimary && hasSecondary && buttonConfig.secondaryAction) {
				// "2" only works when both buttons are shown
				handleButtonAction(buttonConfig.secondaryAction, false)
				return
			}
		}

		// 9. Handle ask responses for options and text input
		if (pendingAsk && !isYoloSuppressed(yolo, pendingAsk.ask as ClineAsk | undefined)) {
			// Allow sending text message for any ask type where sending is enabled
			if (key.return && textInput.trim() && !buttonConfig.sendingDisabled) {
				sendAskResponse("messageResponse", textInput.trim())
				return
			}
			// Number selection for options (only when no text typed yet)
			if (askType === "options") {
				const num = parseInt(input, 10)
				if (textInput === "" && !Number.isNaN(num) && num >= 1 && num <= askOptions.length) {
					const selectedOption = askOptions[num - 1]
					sendAskResponse("messageResponse", selectedOption)
					return
				}
			}
		}

		// 10. Handle Ctrl+ shortcuts (Ctrl+A, Ctrl+E, Ctrl+W, etc.)
		if (key.ctrl && input && handleCtrlShortcut(input)) {
			return
		}

		// 11. Detect paste by checking if input length exceeds threshold
		// Large pastes mess up the terminal UI, so we collapse them into a placeholder
		// Terminal sends large pastes in multiple chunks, so we combine chunks that arrive rapidly
		if (input && input.length > PASTE_COLLAPSE_THRESHOLD) {
			const now = Date.now()
			const timeSinceLastPaste = now - lastPasteTimeRef.current
			lastPasteTimeRef.current = now

			// Check if this is a continuation of a recent paste (within time window)
			if (timeSinceLastPaste < PASTE_CHUNK_WINDOW_MS && activePasteNumRef.current > 0) {
				// Append to existing paste content (store immediately, don't lose data)
				const pasteNum = activePasteNumRef.current
				const chunkLines = input.match(/[\r\n]/g)?.length || 0
				activePasteLinesRef.current += chunkLines

				setPastedTexts((prev) => {
					const next = new Map(prev)
					const existing = next.get(pasteNum) || ""
					next.set(pasteNum, existing + input)
					return next
				})

				// Debounce the visual update to avoid flicker while chunks are arriving
				if (pasteUpdateTimeoutRef.current) {
					clearTimeout(pasteUpdateTimeoutRef.current)
				}
				pasteUpdateTimeoutRef.current = setTimeout(() => {
					const newPlaceholder = `[Pasted text #${pasteNum} +${activePasteLinesRef.current} lines]`
					setTextInput((prev) => {
						const pattern = new RegExp(`\\[Pasted text #${pasteNum} \\+\\d+ lines\\]`)
						return prev.replace(pattern, newPlaceholder)
					})
					// Update cursor to be right after the placeholder
					setCursorPos(activePasteStartPosRef.current + newPlaceholder.length)
					Logger.info(`Paste #${pasteNum} complete: ${activePasteLinesRef.current} lines`)
				}, PASTE_UPDATE_DEBOUNCE_MS)

				return // Don't add another placeholder
			}

			// New paste operation - create placeholder
			pasteCounterRef.current += 1
			const pasteNum = pasteCounterRef.current
			activePasteNumRef.current = pasteNum
			activePasteStartPosRef.current = cursorPos // Track where placeholder starts
			// Count line breaks in the pasted content (handle both \n and \r)
			const extraLines = input.match(/[\r\n]/g)?.length || 0
			activePasteLinesRef.current = extraLines // Track total lines
			const placeholder = `[Pasted text #${pasteNum} +${extraLines} lines]`
			// Store the full content
			setPastedTexts((prev) => {
				const next = new Map(prev)
				next.set(pasteNum, input)
				return next
			})

			setTextInput((prev) => prev.slice(0, cursorPos) + placeholder + prev.slice(cursorPos))
			setCursorPos(cursorPos + placeholder.length)
			return // Exit early - don't also add the raw input via normal handling below
		}

		// 12. Normal input handling
		if (key.shift && key.tab) {
			toggleAutoApproveAll()
			return
		}
		if (key.tab && !mentionInfo.inMentionMode && !slashInfo.inSlashMode) {
			toggleMode()
			return
		}
		if (key.return && !mentionInfo.inMentionMode && !slashInfo.inSlashMode && !pendingAsk && !isSpinnerActive) {
			if (prompt.trim() || imagePaths.length > 0) {
				handleSubmit(prompt.trim(), imagePaths)
			}
			return
		}
		if (key.backspace || key.delete) {
			deleteCharBefore()
			return
		}
		// Cursor movement (when not in a menu)
		if (key.leftArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos((pos) => Math.max(0, pos - 1))
			return
		}
		if (key.rightArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos((pos) => Math.min(textInput.length, pos + 1))
			return
		}
		if (key.upArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos(moveCursorUp(textInput, cursorPos))
			return
		}
		if (key.downArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos(moveCursorDown(textInput, cursorPos))
			return
		}
		// Normal input (single char or short paste)
		if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.tab) {
			insertTextAtCursor(input)
		}
	})

	const borderColor = mode === "act" ? COLORS.primaryBlue : "yellow"
	const metrics = getApiMetrics(messages)

	// Get last API request total tokens for context window progress
	const lastApiReqTotalTokens = useMemo(() => getLastApiReqTotalTokens(messages), [messages])

	// Get context window size from model info
	const contextWindowSize = useMemo(() => {
		const providerData = providerModels[provider]
		if (providerData && modelId in providerData.models) {
			const modelInfo = providerData.models[modelId] as ModelInfo
			if (modelInfo?.contextWindow) {
				return modelInfo.contextWindow
			}
		}
		return DEFAULT_CONTEXT_WINDOW
	}, [provider, modelId])

	const showSlashMenu = slashInfo.inSlashMode && !slashMenuDismissed
	const showFileMenu = mentionInfo.inMentionMode && !showSlashMenu

	// Determine input placeholder/prompt text (no longer needed with buttons, but keep for options/text modes)
	let inputPrompt = ""
	if (pendingAsk && !yolo && askType === "options" && askOptions.length > 0) {
		inputPrompt = `(1-${askOptions.length} or type)`
	}

	return (
		<Box flexDirection="column" key={taskSwitchKey} width="100%">
			{/* Static content - rendered once, stays above dynamic region */}
			<Static items={staticItems}>
				{(item) => {
					if (item.type === "header") {
						// Show static robot frame in header (first frame, looking straight ahead)
						return (
							<Box flexDirection="column" key="header">
								<StaticRobotFrame />
								<Text> </Text>
								<Text bold color="white">
									{centerText("What can I do for you?")}
								</Text>
								<Text> </Text>
							</Box>
						)
					}

					// Completed message
					return (
						<Box key={item.message.ts} paddingX={1} width="100%">
							<ChatMessage message={item.message} mode={mode} />
						</Box>
					)
				}}
			</Static>

			{/* Dynamic region - only current streaming message + input */}
			<Box flexDirection="column" width="100%">
				{/* Animated robot and welcome text - only shown before messages start and user hasn't scrolled */}
				{isWelcomeState && (
					<Box flexDirection="column" marginBottom={1}>
						<AsciiMotionCli onScroll={() => setUserScrolled(true)} />
						<Text> </Text>
						<Text bold color="white">
							{centerText("What can I do for you?")}
						</Text>
					</Box>
				)}

				{/* Current streaming message */}
				{currentMessage && (
					<Box paddingX={1} width="100%">
						<ChatMessage isStreaming message={currentMessage} mode={mode} />
					</Box>
				)}

				{/* Action buttons for tool approvals and other asks (not during streaming) */}
				{buttonConfig.enableButtons &&
					!isSpinnerActive &&
					!isYoloSuppressed(yolo, pendingAsk?.ask as ClineAsk | undefined) && (
						<ActionButtons config={buttonConfig} mode={mode} />
					)}

				{/* Thinking indicator when processing */}
				{isSpinnerActive && <ThinkingIndicator mode={mode} onCancel={handleCancel} startTime={spinnerStartTime} />}

				{/* Input field with border - hidden when panel is open or exiting */}
				{!activePanel && !isExiting && (
					<Box
						borderColor={borderColor}
						borderStyle="round"
						flexDirection="row"
						justifyContent="space-between"
						paddingLeft={1}
						paddingRight={1}
						width="100%">
						<Box>
							{inputPrompt && <Text color={borderColor}>{inputPrompt} </Text>}
							<HighlightedInput
								availableCommands={availableCommands.map((c) => c.name)}
								cursorPos={cursorPos}
								text={textInput}
							/>
						</Box>
					</Box>
				)}

				{/* Settings panel */}
				{activePanel?.type === "settings" && (
					<SettingsPanelContent
						controller={ctrl}
						initialMode={activePanel.initialMode}
						initialModelKey={activePanel.initialModelKey}
						onClose={() => setActivePanel(null)}
					/>
				)}

				{/* History panel */}
				{activePanel?.type === "history" && ctrl && (
					<HistoryPanelContent
						controller={ctrl}
						onClose={() => setActivePanel(null)}
						onSelectTask={() => setActivePanel(null)}
					/>
				)}

				{/* Help panel */}
				{activePanel?.type === "help" && <HelpPanelContent onClose={() => setActivePanel(null)} />}

				{/* Slash command menu - below input (takes priority over file menu) */}
				{showSlashMenu && !activePanel && (
					<Box paddingLeft={1} paddingRight={1}>
						<SlashCommandMenu
							commands={filteredCommands}
							query={slashInfo.query}
							selectedIndex={selectedSlashIndex}
						/>
					</Box>
				)}

				{/* File mention menu - below input (only when not in slash mode) */}
				{showFileMenu && !activePanel && (
					<Box paddingLeft={1} paddingRight={1}>
						<FileMentionMenu
							isLoading={isSearching}
							query={mentionInfo.query}
							results={fileResults}
							selectedIndex={selectedIndex}
							showRipgrepWarning={showRipgrepWarning}
						/>
					</Box>
				)}

				{/* Attached images */}
				{imagePaths.length > 0 && !activePanel && (
					<Box paddingLeft={1} paddingRight={1}>
						<Text color="magenta">
							{imagePaths.length} image{imagePaths.length > 1 ? "s" : ""} attached
						</Text>
					</Box>
				)}

				{/* Footer - hidden when any menu or panel is shown */}
				{!showSlashMenu && !showFileMenu && !activePanel && (
					<Box flexDirection="column" width="100%">
						{/* Row 1: Instructions (left, can wrap) | Plan/Act toggle (right, no wrap) */}
						<Box justifyContent="space-between" paddingLeft={1} paddingRight={1} width="100%">
							<Box flexShrink={1} flexWrap="wrap">
								<Text color="gray">/ for commands · @ for files</Text>
							</Box>
							<Box flexShrink={0} gap={1}>
								<Box>
									<Text bold={mode === "plan"} color={mode === "plan" ? "yellow" : undefined}>
										{mode === "plan" ? "●" : "○"} Plan
									</Text>
								</Box>
								<Box>
									<Text bold={mode === "act"} color={mode === "act" ? COLORS.primaryBlue : undefined}>
										{mode === "act" ? "●" : "○"} Act
									</Text>
								</Box>
								<Text color="gray">(Tab)</Text>
							</Box>
						</Box>

						{/* Row 2: Model/context/tokens/cost */}
						<Box paddingLeft={1} paddingRight={1}>
							<Text>
								{modelId} {(() => {
									const bar = createContextBar(lastApiReqTotalTokens, contextWindowSize)
									return (
										<Text>
											<Text>{bar.filled}</Text>
											<Text color="gray">{bar.empty}</Text>
										</Text>
									)
								})()} <Text color="gray">
									({lastApiReqTotalTokens.toLocaleString()}) | ${metrics.totalCost.toFixed(3)}
								</Text>
							</Text>
						</Box>

						{/* Row 3: Repo/branch/diff stats */}
						<Box paddingLeft={1} paddingRight={1}>
							<Text>
								{workspacePath.split("/").pop() || workspacePath}
								{gitBranch && ` (${gitBranch})`}
								{gitDiffStats && gitDiffStats.files > 0 && (
									<Text color="gray">
										{" "}
										| {gitDiffStats.files} file{gitDiffStats.files !== 1 ? "s" : ""}{" "}
										<Text color="green">+{gitDiffStats.additions}</Text>{" "}
										<Text color="red">-{gitDiffStats.deletions}</Text>
									</Text>
								)}
							</Text>
						</Box>

						{/* Row 4: Auto-approve toggle */}
						<Box paddingLeft={1} paddingRight={1}>
							{autoApproveAll ? (
								<Text>
									<Text color="green">⏵⏵ Auto-approve all enabled</Text>
									<Text color="gray"> (Shift+Tab)</Text>
								</Text>
							) : (
								<Text color="gray">Auto-approve all disabled (Shift+Tab)</Text>
							)}
						</Box>
					</Box>
				)}
			</Box>
		</Box>
	)
}
