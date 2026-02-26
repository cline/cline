import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import { AskResponseRequest } from "@shared/proto/cline/task"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronRight } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { ACTION_METADATA } from "@/components/chat/auto-approve-menu/constants"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { cn } from "@/lib/utils"
import { FileServiceClient, TaskServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"

/**
 * Displays the command output content with optional log file link
 */
export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const lineCount = output.split("\n").length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				outputRef.current.scrollTop = outputRef.current.scrollHeight
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		if (!isContainerExpanded) {
			return null
		}

		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
					"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
					"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
					"overflow-y-visible": shouldAutoShow,
				})}
				ref={outputRef}>
				<div className="bg-code">{renderOutput()}</div>
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

interface CommandOutputRowProps {
	message: ClineMessage
	isCommandExecuting?: boolean
	isCommandPending?: boolean
	isCommandCompleted?: boolean
	isBackgroundExec?: boolean
	onCancelCommand?: () => void
	isOutputFullyExpanded: boolean
	setIsOutputFullyExpanded: (expanded: boolean) => void
}

/**
 * Displays a CLI command card with:
 * - Header with terminal icon
 * - Command text
 * - Collapsible output section
 * - Footer with auto-approve dropdown and action buttons
 */
export const CommandOutputRow = memo(({
	message,
	isCommandExecuting = false,
	isCommandPending = false,
	isCommandCompleted = false,
	isBackgroundExec = false,
	onCancelCommand,
	isOutputFullyExpanded,
	setIsOutputFullyExpanded,
}: CommandOutputRowProps) => {
	const { isChecked, updateAction } = useAutoApproveActions()
	const [isOutputExpanded, setIsOutputExpanded] = useState(false)

	// Find the executeSafeCommands action from metadata for the auto-approve dropdown
	const safeCommandsAction = ACTION_METADATA.find((a) => a.id === "executeSafeCommands")

	// If command is pending, it wasn't auto-approved, so show "Ask Every Time"
	// Otherwise show the current global setting
	const autoApprove = isCommandPending
		? false
		: safeCommandsAction
			? isChecked(safeCommandsAction)
			: false

	// Parse the message text to extract command and output
	const splitMessage = (text: string) => {
		const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
		if (outputIndex === -1) {
			return { command: text, output: "" }
		}
		return {
			command: text.slice(0, outputIndex).trim(),
			output: text
				.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
				.trim()
				.split("")
				.map((char) => {
					switch (char) {
						case "\t":
							return "→   "
						case "\b":
							return "⌫"
						case "\f":
							return "⏏"
						case "\v":
							return "⇳"
						default:
							return char
					}
				})
				.join(""),
		}
	}

	const { command: rawCommand, output } = splitMessage(message.text || "")
	const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
	const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
	const showCancelButton =
		(isCommandExecuting || isCommandPending) && typeof onCancelCommand === "function" && isBackgroundExec

	// Determine status display based on command state
	const getStatusDisplay = () => {
		if (isCommandExecuting) {
			return { text: "Running", color: "text-description", showCheck: false }
		}
		if (isCommandPending) {
			return { text: "Pending", color: "text-editor-warning-foreground", showCheck: false }
		}
		if (isCommandCompleted || (output.length > 0 && !isCommandExecuting && !isCommandPending)) {
			return { text: "Success", color: "text-success", showCheck: true }
		}
		return { text: "Skipped", color: "text-description", showCheck: false }
	}

	const status = getStatusDisplay()

	return (
		<div className="rounded-sm border border-editor-group-border overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-editor-group-border/50">
				<i className="codicon codicon-terminal text-description" />
				<span className="text-sm text-foreground">Run CLI Command</span>
			</div>

			{/* Command text */}
			<div className="px-3 pt-3 pb-1.5 bg-code">
				<pre className="font-mono text-sm whitespace-pre-wrap break-words m-0 text-link">{command}</pre>
			</div>

			{/* Command Output accordion */}
			{output.length > 0 && (
				<div>
					<button
						className={cn("flex items-center gap-1.5 w-full px-3 text-left", {
							"py-2": !isOutputExpanded,
							"pt-2 pb-1": isOutputExpanded,
						})}
						onClick={() => setIsOutputExpanded(!isOutputExpanded)}
						type="button">
						<ChevronRight
							className={cn("text-description transition-transform", {
								"rotate-90": isOutputExpanded,
							})}
							size={14}
						/>
						<span className="text-description text-sm">Command Output</span>
					</button>
					{isOutputExpanded && (
						<div>
							<CommandOutputContent
								isContainerExpanded={true}
								isOutputFullyExpanded={isOutputFullyExpanded}
								onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
								output={output}
							/>
						</div>
					)}
				</div>
			)}

			{/* Footer bar with auto-approve dropdown and action buttons */}
			<div className="flex items-center justify-between px-3 h-10 mt-2 bg-toolbar-hover/65">
				{/* Left side: Auto-approve dropdown */}
				<div className="flex items-center gap-2">
					<Select
						value={autoApprove ? "auto" : "ask"}
						onValueChange={(value) => {
							if (!safeCommandsAction) return
							updateAction(safeCommandsAction, value === "auto")
						}}>
						<SelectTrigger
							className="h-7 border-0 bg-transparent px-0 shadow-none text-sm text-foreground hover:text-description [&_svg]:opacity-100 [&_svg]:text-description"
							showIcon={true}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem className="text-sm" value="ask">
								Ask Every Time
							</SelectItem>
							<SelectItem className="text-sm" value="auto">
								Auto-approve
							</SelectItem>
						</SelectContent>
					</Select>
					{requestsApproval && isCommandPending && (
						<span className="text-xs text-editor-warning-foreground flex items-center gap-1.5">
							<i className="codicon codicon-warning text-[11px]" />
							Requires approval
						</span>
					)}
				</div>

				{/* Right side: Action buttons or status */}
				<div className="flex items-center gap-2">
					{/* Pending state: Cancel/Run buttons */}
					{isCommandPending && (
						<>
							<button
								className="text-sm text-foreground hover:text-description transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									TaskServiceClient.askResponse(
										AskResponseRequest.create({ responseType: "noButtonClicked" }),
									)
								}}
								type="button">
								Cancel
							</button>
							<button
								className="px-2.5 py-1 text-sm bg-button-background text-button-foreground rounded-sm hover:bg-button-hover-background transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									TaskServiceClient.askResponse(
										AskResponseRequest.create({ responseType: "yesButtonClicked" }),
									)
								}}
								type="button">
								Run
							</button>
						</>
					)}

					{/* Executing state: Spinner + optional Cancel */}
					{isCommandExecuting && (
						<>
							<i className="codicon codicon-loading codicon-modifier-spin text-sm text-description" />
							{showCancelButton ? (
								<button
									className="text-sm text-foreground hover:text-description transition-colors"
									onClick={(e) => {
										e.stopPropagation()
										onCancelCommand?.()
									}}
									type="button">
									Cancel
								</button>
							) : (
								<span className="text-sm text-description">Cancel</span>
							)}
						</>
					)}

					{/* Completed state: Status indicator */}
					{!isCommandPending && !isCommandExecuting && (
						<div className="flex items-center gap-1.5">
							{status.showCheck && <i className="codicon codicon-check text-sm text-success" />}
							<span className={cn("text-sm", status.color)}>{status.text}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	)
})

CommandOutputRow.displayName = "CommandOutputRow"
