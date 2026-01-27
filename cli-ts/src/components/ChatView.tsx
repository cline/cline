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

import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
import type { Mode } from "@shared/storage/types"
import { execSync } from "child_process"
import { Box, Static, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getAvailableSlashCommands } from "@/core/controller/slash/getAvailableSlashCommands"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { StateManager } from "@/core/storage/StateManager"
import { COLORS } from "../constants/colors"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useIsSpinnerActive } from "../hooks/useStateSubscriber"
import { moveCursorDown, moveCursorUp } from "../utils/cursor"
import {
	checkAndWarnRipgrepMissing,
	extractMentionQuery,
	type FileSearchResult,
	getRipgrepInstallInstructions,
	insertMention,
	searchWorkspaceFiles,
} from "../utils/file-search"
import { isMouseEscapeSequence } from "../utils/input"
import { jsonParseSafe, parseImagesFromInput } from "../utils/parser"
import { extractSlashQuery, filterCommands, insertSlashCommand, sortCommandsWorkflowsFirst } from "../utils/slash-commands"
import { isFileEditTool, parseToolFromMessage } from "../utils/tools"
import { ActionButtons, type ButtonActionType, getButtonConfig } from "./ActionButtons"
import { AsciiMotionCli, StaticRobotFrame } from "./AsciiMotionCli"
import { ChatMessage } from "./ChatMessage"
import { FileMentionMenu } from "./FileMentionMenu"
import { HighlightedInput } from "./HighlightedInput"
import { SettingsPanelContent } from "./SettingsPanelContent"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { ThinkingIndicator } from "./ThinkingIndicator"

interface ChatViewProps {
	controller?: any
	onExit?: () => void
	onComplete?: () => void
	onError?: () => void
	robotTopRow?: number
	initialPrompt?: string
	initialImages?: string[]
	taskId?: string
}

const SEARCH_DEBOUNCE_MS = 150
const RIPGREP_WARNING_DURATION_MS = 5000
const MAX_SEARCH_RESULTS = 15
const DEFAULT_CONTEXT_WINDOW = 200000

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

/** Ask types that need user interaction even in yolo mode */
const YOLO_INTERACTIVE_ASKS = new Set<ClineAsk>([
	"completion_result",
	"followup",
	"plan_mode_respond",
	"resume_task",
	"resume_completed_task",
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

export const ChatView: React.FC<ChatViewProps> = ({
	controller,
	onExit,
	onComplete: _onComplete,
	onError,
	robotTopRow,
	initialPrompt,
	initialImages,
	taskId,
}) => {
	// Get task state from context
	const taskState = useTaskState()
	const { controller: taskController } = useTaskContext()
	const { isActive: isSpinnerActive, startTime: spinnerStartTime } = useIsSpinnerActive()

	// Prefer prop controller over context controller (memoized for stable reference in callbacks)
	const ctrl = useMemo(() => controller || taskController, [controller, taskController])

	// Input state
	const [textInput, setTextInput] = useState("")
	const [cursorPos, setCursorPos] = useState(0)
	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isSearching, setIsSearching] = useState(false)
	const [showRipgrepWarning, setShowRipgrepWarning] = useState(false)
	const [respondedToAsk, setRespondedToAsk] = useState<number | null>(null)
	const [userScrolled, setUserScrolled] = useState(false)

	// Slash command state
	const [availableCommands, setAvailableCommands] = useState<SlashCommandInfo[]>([])
	const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
	const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
	const lastSlashIndexRef = useRef<number>(-1)

	// Settings panel state
	const [activePanel, setActivePanel] = useState<{ type: "settings"; initialMode?: "model-picker" } | null>(null)

	// Track which messages have been rendered to Static (by timestamp)
	// Using refs instead of state to avoid extra renders during streaming->static transition
	const loggedMessageTsRef = useRef<Set<number>>(new Set())
	const headerLoggedRef = useRef(false)
	const [gitBranch, setGitBranch] = useState<string | null>(null)
	const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats | null>(null)

	// Mode state
	const [mode, setMode] = useState<Mode>(() => {
		const stateManager = StateManager.get()
		return stateManager.getGlobalSettingsKey("mode") || "act"
	})

	const [yolo, setYolo] = useState<boolean>(() => StateManager.get().getGlobalSettingsKey("yoloModeToggled") ?? false)

	// Sync mode from core state updates (e.g. yolo auto-switching plan to act)
	useEffect(() => {
		if (taskState.mode && taskState.mode !== mode) {
			setMode(taskState.mode as Mode)
		}
	}, [taskState.mode])

	const toggleYolo = useCallback(() => {
		const newValue = !yolo
		setYolo(newValue)
		StateManager.get().setGlobalState("yoloModeToggled", newValue)
	}, [yolo])

	// Get model ID based on current mode
	// Re-read when activePanel changes (settings panel closes) to pick up changes
	const modelId = useMemo(() => {
		const stateManager = StateManager.get()
		const modelKey = mode === "act" ? "actModeApiModelId" : "planModeApiModelId"
		return (stateManager.getGlobalSettingsKey(modelKey) as string) || "claude-sonnet-4-20250514"
	}, [mode, activePanel])

	const toggleMode = useCallback(() => {
		const newMode: Mode = mode === "act" ? "plan" : "act"
		setMode(newMode)
		const stateManager = StateManager.get()
		stateManager.setGlobalState("mode", newMode)
	}, [mode])

	const refs = useRef({
		searchTimeout: null as NodeJS.Timeout | null,
		lastQuery: "",
		hasCheckedRipgrep: false,
	})

	const { prompt, imagePaths } = parseImagesFromInput(textInput)
	const mentionInfo = useMemo(() => extractMentionQuery(textInput), [textInput])
	const slashInfo = useMemo(() => extractSlashQuery(textInput), [textInput])
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
				setAvailableCommands(sortCommandsWorkflowsFirst([...cliCommands, ...cliOnlyCommands]))
			} catch {
				// Fallback: commands will be empty, menu won't show
			}
		}
		loadCommands()
	}, [ctrl])

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
			return true
		})

		// Combine command messages with their output (like webview does)
		return combineCommandSequences(filtered)
	}, [messages])

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

			setRespondedToAsk(pendingAsk.ts)
			setTextInput("")
			setCursorPos(0)

			try {
				await ctrl.task.handleWebviewAskResponse(responseType, text)
			} catch {
				// Controller may be disposed
			}
		},
		[ctrl, pendingAsk],
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
					// Check for resume states that should trigger exit
					if (pendingAsk?.ask === "resume_task" || pendingAsk?.ask === "resume_completed_task") {
						onExit?.()
					} else {
						sendAskResponse("noButtonClicked")
					}
					break
				case "proceed":
					// Proceed can be either yesButtonClicked or messageResponse depending on context
					sendAskResponse("yesButtonClicked")
					break
				case "new_task":
					// For now, signal to start a new task (user can type new prompt)
					setRespondedToAsk(pendingAsk?.ts || null)
					setTextInput("")
					setCursorPos(0)
					break
				case "cancel":
					handleCancel()
					break
			}
		},
		[controller, taskController, sendAskResponse, pendingAsk, onExit, handleCancel],
	)

	// Handle task submission (new task)
	const handleSubmit = useCallback(
		async (text: string, images: string[]) => {
			if (!ctrl || !text.trim()) return

			setTextInput("")
			setCursorPos(0)

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
				await ctrl.initTask(text.trim(), validImages.length > 0 ? validImages : undefined)
			} catch (_error) {
				onError?.()
			}
		},
		[ctrl, onError],
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
	useInput((input, key) => {
		// Filter out mouse escape sequences from AsciiMotionCli's mouse tracking
		if (isMouseEscapeSequence(input)) {
			return
		}

		// When a panel is open, let the panel handle its own input
		if (activePanel) {
			return
		}

		const inSlashMenu = slashInfo.inSlashMode && filteredCommands.length > 0 && !slashMenuDismissed
		const inFileMenu = mentionInfo.inMentionMode && fileResults.length > 0 && !inSlashMenu

		// Slash command menu navigation (takes priority over file menu)
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
					if (cmd.name === "settings") {
						setActivePanel({ type: "settings" })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}
					if (cmd.name === "models") {
						// If separate models for plan/act is enabled, just open settings (user picks which mode)
						const hasSeparateModels = StateManager.get().getGlobalSettingsKey("planActSeparateModelsSetting")
						setActivePanel({ type: "settings", initialMode: hasSeparateModels ? undefined : "model-picker" })
						setTextInput("")
						setCursorPos(0)
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
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

		// File mention menu navigation
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

		// Handle button actions (1 for primary, 2 for secondary)
		// Only when buttons are enabled, not streaming, and no text has been typed
		if (
			buttonConfig.enableButtons &&
			!isSpinnerActive &&
			textInput === "" &&
			!isYoloSuppressed(yolo, pendingAsk?.ask as ClineAsk | undefined)
		) {
			if (input === "1" && buttonConfig.primaryAction) {
				handleButtonAction(buttonConfig.primaryAction, true)
				return
			}
			if (input === "2" && buttonConfig.secondaryAction) {
				handleButtonAction(buttonConfig.secondaryAction, false)
				return
			}
		}

		// Handle ask responses for options and text input
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

		// Normal input handling
		if (key.shift && key.tab) {
			toggleYolo()
			return
		}
		if (key.tab && !mentionInfo.inMentionMode && !slashInfo.inSlashMode) {
			toggleMode()
			return
		}
		if (key.return && !mentionInfo.inMentionMode && !slashInfo.inSlashMode && !pendingAsk) {
			if (prompt.trim() || imagePaths.length > 0) {
				handleSubmit(prompt.trim(), imagePaths)
			}
			return
		}
		if (key.backspace || key.delete) {
			if (cursorPos > 0) {
				setTextInput((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos))
				setCursorPos((pos) => pos - 1)
			}
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
		if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.tab) {
			setTextInput((prev) => prev.slice(0, cursorPos) + input + prev.slice(cursorPos))
			setCursorPos((pos) => pos + input.length)
		}
	})

	const borderColor = mode === "act" ? COLORS.primaryBlue : "yellow"
	const metrics = getApiMetrics(messages)
	const showSlashMenu = slashInfo.inSlashMode && !slashMenuDismissed
	const showFileMenu = mentionInfo.inMentionMode && !showSlashMenu

	// Determine input placeholder/prompt text (no longer needed with buttons, but keep for options/text modes)
	let inputPrompt = ""
	if (pendingAsk && !yolo && askType === "options" && askOptions.length > 0) {
		inputPrompt = `(1-${askOptions.length} or type)`
	}

	return (
		<Box flexDirection="column" width="100%">
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
						<AsciiMotionCli onScroll={() => setUserScrolled(true)} robotTopRow={robotTopRow} />
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

				{/* Ripgrep warning if needed */}
				{showRipgrepWarning && (
					<Box marginTop={1}>
						<Text color="yellow">Warning: ripgrep not found - file search will be slower. </Text>
						<Text color="gray">Install: {getRipgrepInstallInstructions()}</Text>
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

				{/* Input field with border - hidden when panel is open */}
				{!activePanel && (
					<Box
						borderColor={borderColor}
						borderStyle="round"
						flexDirection="row"
						justifyContent="space-between"
						paddingLeft={1}
						paddingRight={1}
						width="100%">
						<Box>
							{inputPrompt && <Text color="yellow">{inputPrompt} </Text>}
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
						onClose={() => setActivePanel(null)}
					/>
				)}

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
					<>
						{/* Row 1: Instructions (left, can wrap) | Plan/Act toggle (right, no wrap) */}
						<Box justifyContent="space-between" paddingLeft={1} paddingRight={1} width="100%">
							<Box flexShrink={1} flexWrap="wrap">
								<Text color="gray">@ for files · / for commands</Text>
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
									const bar = createContextBar(
										metrics.totalTokensIn + metrics.totalTokensOut,
										DEFAULT_CONTEXT_WINDOW,
									)
									return (
										<Text>
											<Text>{bar.filled}</Text>
											<Text color="gray">{bar.empty}</Text>
										</Text>
									)
								})()} <Text color="gray">
									({(metrics.totalTokensIn + metrics.totalTokensOut).toLocaleString()}) | $
									{metrics.totalCost.toFixed(3)}
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
							{yolo ? (
								<Text color="green">⏵⏵ Auto-approve all enabled (Shift+Tab)</Text>
							) : (
								<Text color="gray">Auto-approve all disabled (Shift+Tab)</Text>
							)}
						</Box>
					</>
				)}
			</Box>
		</Box>
	)
}
