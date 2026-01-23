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

import type { ClineAsk } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import type { Mode } from "@shared/storage/types"
import { execSync } from "child_process"
import { Box, Static, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { useTaskContext, useTaskState } from "../context/TaskContext"
import { useIsSpinnerActive } from "../hooks/useStateSubscriber"
import {
	checkAndWarnRipgrepMissing,
	extractMentionQuery,
	type FileSearchResult,
	getRipgrepInstallInstructions,
	insertMention,
	searchWorkspaceFiles,
} from "../utils/file-search"
import { jsonParseSafe, parseImagesFromInput } from "../utils/parser"
import { AsciiMotionCli, StaticRobotFrame } from "./AsciiMotionCli"
import { ChatMessage } from "./ChatMessage"
import { FileMentionMenu } from "./FileMentionMenu"
import { ThinkingIndicator } from "./ThinkingIndicator"

interface ChatViewProps {
	controller?: any
	onExit?: () => void
	onComplete?: () => void
	onError?: () => void
	robotTopRow?: number
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

export const ChatView: React.FC<ChatViewProps> = ({ controller, onExit, onComplete: _onComplete, onError, robotTopRow }) => {
	// Get task state from context
	const taskState = useTaskState()
	const { controller: taskController } = useTaskContext()
	const { isActive: isSpinnerActive, startTime: spinnerStartTime } = useIsSpinnerActive()

	// Input state
	const [textInput, setTextInput] = useState("")
	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isSearching, setIsSearching] = useState(false)
	const [showRipgrepWarning, setShowRipgrepWarning] = useState(false)
	const [escPressedOnce, setEscPressedOnce] = useState(false)
	const [respondedToAsk, setRespondedToAsk] = useState<number | null>(null)

	// Track which messages have been rendered to Static (by timestamp)
	// Using refs instead of state to avoid extra renders during streaming->static transition
	const loggedMessageTsRef = useRef<Set<number>>(new Set())
	const headerLoggedRef = useRef(false)
	const [gitBranch, setGitBranch] = useState<string | null>(null)

	// Mode state
	const [mode, setMode] = useState<Mode>(() => {
		const stateManager = StateManager.get()
		return stateManager.getGlobalSettingsKey("mode") || "act"
	})

	const yolo = useMemo(() => StateManager.get().getGlobalSettingsKey("yoloModeToggled"), [])

	// Get model ID based on current mode
	const modelId = useMemo(() => {
		const stateManager = StateManager.get()
		const modelKey = mode === "act" ? "actModeApiModelId" : "planModeApiModelId"
		return (stateManager.getGlobalSettingsKey(modelKey) as string) || "claude-sonnet-4-20250514"
	}, [mode])

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

	const workspacePath = useMemo(() => {
		try {
			const ctrl = controller || taskController
			const root = ctrl?.getWorkspaceManagerSync?.()?.getPrimaryRoot?.()
			if (root?.path) {
				return root.path
			}
		} catch {
			// Fallback to cwd
		}
		return process.cwd()
	}, [controller, taskController])

	// Get git branch on mount
	useEffect(() => {
		setGitBranch(getGitBranch(workspacePath))
	}, [workspacePath])

	const messages = taskState.clineMessages || []

	// Filter messages we want to display
	const displayMessages = useMemo(() => {
		return messages.filter((m) => {
			if (m.say === "api_req_finished") return false
			if (m.say === "text" && !m.text?.trim()) return false
			if (m.say === "checkpoint_created") return false
			if (m.say === "api_req_started") return false
			return true
		})
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

		for (let i = 0; i < displayMessages.length; i++) {
			const msg = displayMessages[i]
			const isLast = i === displayMessages.length - 1

			// Check if this message type should skip dynamic rendering
			const shouldSkipDynamic =
				skipDynamicTypes.has(msg.say || "") || (msg.type === "ask" && skipDynamicTypes.has(msg.ask || ""))

			if (msg.partial) {
				// Message is still streaming
				if (isLast && !shouldSkipDynamic) {
					// Show in dynamic region (normal streaming)
					current = msg
				}
				// If shouldSkipDynamic and partial: don't show anywhere, wait for complete
			} else {
				// Message is complete, add to static
				completed.push(msg)
			}
		}

		return { completedMessages: completed, currentMessage: current }
	}, [displayMessages])

	// Determine if we're in welcome state (no messages yet)
	const isWelcomeState = displayMessages.length === 0

	// Build Static items - each item is rendered once and stays above dynamic content
	const staticItems = useMemo(() => {
		const items: Array<{ type: "header" } | { type: "message"; message: (typeof displayMessages)[0] }> = []

		// Add header as first item ONLY after messages start (so animated robot shows first)
		// Once messages exist, add header to static so it scrolls up with history
		if (!headerLoggedRef.current && displayMessages.length > 0) {
			items.push({ type: "header" })
			headerLoggedRef.current = true
		}

		// Add completed messages that haven't been logged yet
		for (const msg of completedMessages) {
			if (!loggedMessageTsRef.current.has(msg.ts)) {
				items.push({ type: "message", message: msg })
				loggedMessageTsRef.current.add(msg.ts)
			}
		}

		return items
	}, [completedMessages, displayMessages.length])

	// Check for pending ask message
	const lastMessage = messages[messages.length - 1]
	const pendingAsk =
		lastMessage?.type === "ask" && !lastMessage.partial && respondedToAsk !== lastMessage.ts ? lastMessage : null
	const askType = pendingAsk ? getAskPromptType(pendingAsk.ask as ClineAsk, pendingAsk.text || "") : "none"
	const askOptions = pendingAsk && askType === "options" ? parseAskOptions(pendingAsk.text || "") : []

	// Send response to ask message
	const sendAskResponse = useCallback(
		async (responseType: string, text?: string) => {
			const ctrl = controller || taskController
			if (!ctrl?.task || !pendingAsk) return

			setRespondedToAsk(pendingAsk.ts)
			setTextInput("")

			try {
				await ctrl.task.handleWebviewAskResponse(responseType, text)
			} catch {
				// Controller may be disposed
			}
		},
		[controller, taskController, pendingAsk],
	)

	// Handle task submission (new task)
	const handleSubmit = useCallback(
		async (text: string, images: string[]) => {
			const ctrl = controller || taskController
			if (!ctrl || !text.trim()) return

			setTextInput("")

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
		[controller, taskController, onError],
	)

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
		// Mouse events look like: [<35;46;17M or contain escape characters
		if (input.includes("\x1b") || input.includes("[<") || /\d+;\d+[Mm]/.test(input)) {
			return
		}

		const inMenu = mentionInfo.inMentionMode && fileResults.length > 0

		// Menu navigation
		if (inMenu) {
			if (key.upArrow) {
				setSelectedIndex((i) => (i > 0 ? i - 1 : fileResults.length - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((i) => (i < fileResults.length - 1 ? i + 1 : 0))
				return
			}
			if (key.tab || key.return) {
				const file = fileResults[selectedIndex]
				if (file) {
					setTextInput(insertMention(textInput, mentionInfo.atIndex, file.path))
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

		// Handle ask responses
		if (pendingAsk && !yolo) {
			if (askType === "confirmation") {
				// y/n confirmation
				if (input.toLowerCase() === "y") {
					sendAskResponse("yesButtonClicked")
					return
				} else if (input.toLowerCase() === "n") {
					if (pendingAsk.ask === "resume_task" || pendingAsk.ask === "resume_completed_task") {
						onExit?.()
						return
					}
					sendAskResponse("noButtonClicked")
					return
				}
			} else if (askType === "options") {
				// Number selection for options, or free text
				if (key.return && textInput.trim()) {
					sendAskResponse("messageResponse", textInput.trim())
					return
				}
				// Check if it's a number for option selection (only when no text typed yet)
				const num = parseInt(input, 10)
				if (textInput === "" && !Number.isNaN(num) && num >= 1 && num <= askOptions.length) {
					const selectedOption = askOptions[num - 1]
					sendAskResponse("optionSelected", selectedOption)
					return
				}
			} else if (askType === "text") {
				// Text input mode
				if (key.return && textInput.trim()) {
					sendAskResponse("messageResponse", textInput.trim())
					return
				}
			}
		}

		// Normal input handling
		if (key.tab && !mentionInfo.inMentionMode) {
			toggleMode()
			return
		}
		if (key.return && !mentionInfo.inMentionMode && !pendingAsk) {
			if (prompt.trim() || imagePaths.length > 0) {
				handleSubmit(prompt.trim(), imagePaths)
			}
			return
		}
		if (key.escape && !mentionInfo.inMentionMode) {
			if (escPressedOnce) {
				onExit?.()
			} else {
				setEscPressedOnce(true)
			}
			return
		}
		if (key.backspace || key.delete) {
			setTextInput((prev) => prev.slice(0, -1))
			setEscPressedOnce(false)
			return
		}
		if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.tab) {
			setTextInput((prev) => prev + input)
			setEscPressedOnce(false)
		}
	})

	const borderColor = mode === "act" ? "blueBright" : "yellow"
	const metrics = getApiMetrics(messages)

	// Determine input placeholder/prompt text
	let inputPrompt = ""
	if (pendingAsk && !yolo) {
		if (askType === "confirmation") {
			inputPrompt = "(y/n)"
		}
	}

	return (
		<Box>
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
					return <ChatMessage key={item.message.ts} message={item.message} />
				}}
			</Static>

			{/* Dynamic region - only current streaming message + input */}
			<Box flexDirection="column" width="100%">
				{/* Animated robot and welcome text - only shown before messages start */}
				{isWelcomeState && (
					<Box flexDirection="column" marginBottom={1}>
						<AsciiMotionCli robotTopRow={robotTopRow} />
						<Text> </Text>
						<Text bold color="white">
							{centerText("What can I do for you?")}
						</Text>
					</Box>
				)}

				{/* Current streaming message */}
				{currentMessage && <ChatMessage isStreaming message={currentMessage} />}

				{/* Ripgrep warning if needed */}
				{showRipgrepWarning && (
					<Box marginTop={1}>
						<Text color="yellow">Warning: ripgrep not found - file search will be slower. </Text>
						<Text color="gray">Install: {getRipgrepInstallInstructions()}</Text>
					</Box>
				)}

				{/* Options list for ask prompts */}
				{pendingAsk && askType === "options" && askOptions.length > 0 && !yolo && (
					<Box flexDirection="column" marginBottom={1}>
						{askOptions.map((opt, idx) => (
							<Text color="gray" key={idx}>
								{idx + 1}. {opt}
							</Text>
						))}
					</Box>
				)}

				{/* Thinking indicator when processing */}
				{isSpinnerActive && !pendingAsk && (
					<Box marginBottom={1}>
						<ThinkingIndicator mode={mode} startTime={spinnerStartTime} />
					</Box>
				)}

				{/* Input field with border - ALWAYS shown */}
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
						<Text>{textInput}</Text>
						<Text color="gray">▌</Text>
					</Box>
					<Text color="gray" dimColor>
						↵ send
					</Text>
				</Box>

				{/* File mention menu - below input */}
				{mentionInfo.inMentionMode && (
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
				{imagePaths.length > 0 && (
					<Box paddingLeft={1} paddingRight={1}>
						<Text color="magenta">
							{imagePaths.length} image{imagePaths.length > 1 ? "s" : ""} attached
						</Text>
					</Box>
				)}

				{/* Row 1: Instructions (left, can wrap) | Plan/Act toggle (right, no wrap) */}
				<Box justifyContent="space-between" paddingLeft={1} paddingRight={1} width="100%">
					<Box flexShrink={1} flexWrap="wrap">
						<Text color="gray" dimColor>
							@ for files · / for commands ·{" "}
						</Text>
						<Text bold={escPressedOnce} color={escPressedOnce ? "white" : "gray"} dimColor={!escPressedOnce}>
							{escPressedOnce ? "Press Esc again to exit" : "Esc to exit"}
						</Text>
					</Box>
					<Box flexShrink={0} gap={1}>
						<Box>
							<Text bold={mode === "plan"} color={mode === "plan" ? "yellow" : "gray"}>
								{mode === "plan" ? "●" : "○"} Plan
							</Text>
						</Box>
						<Box>
							<Text bold={mode === "act"} color={mode === "act" ? "blueBright" : "gray"}>
								{mode === "act" ? "●" : "○"} Act
							</Text>
						</Box>
						<Text color="gray" dimColor>
							(Tab)
						</Text>
					</Box>
				</Box>

				{/* Row 2: Model/context/tokens/cost */}
				<Box paddingLeft={1} paddingRight={1}>
					<Text>
						<Text color="gray">{modelId.length > 20 ? modelId.substring(0, 17) + "..." : modelId}</Text> {(() => {
							const bar = createContextBar(metrics.totalTokensIn + metrics.totalTokensOut, DEFAULT_CONTEXT_WINDOW)
							return (
								<>
									<Text color="gray">{bar.filled}</Text>
									<Text color="gray" dimColor>
										{bar.empty}
									</Text>
								</>
							)
						})()}
						<Text color="gray"> ({(metrics.totalTokensIn + metrics.totalTokensOut).toLocaleString()})</Text>
						<Text color="gray"> | </Text>
						<Text color="gray">${metrics.totalCost.toFixed(3)}</Text>
					</Text>
				</Box>

				{/* Row 3: Repo/branch */}
				<Box paddingLeft={1} paddingRight={1}>
					<Text color="gray">
						{workspacePath.split("/").pop() || workspacePath}
						{gitBranch && (
							<Text color="gray">
								{" "}
								(<Text color="gray">{gitBranch}</Text>)
							</Text>
						)}
					</Text>
				</Box>
			</Box>
		</Box>
	)
}
