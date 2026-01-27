import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useEffect, useRef } from "react"
import { ClineCompactIcon } from "@/assets/ClineCompactIcon"
import { Button } from "@/components/ui/button"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

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
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		// Check if output contains a log file path indicator
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
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
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isBackgroundExec = false, // vscodeTerminalExecutionMode === "backgroundExec"
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
	}: {
		message: ClineMessage
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isBackgroundExec?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
	}) => {
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

		// Check if this is a Cline subagent command (only on VSCode platform, not JetBrains/standalone)
		const isSubagentCommand = PLATFORM_CONFIG.type === PlatformType.VSCODE && command.trim().startsWith("cline ")
		let subagentPrompt: string | undefined

		if (isSubagentCommand) {
			// Parse the cline command to extract prompt
			// Format: cline "prompt"
			const clineCommandRegex = /^cline\s+"([^"]+)"(?:\s+--no-interactive)?/
			const match = command.match(clineCommandRegex)

			if (match) {
				subagentPrompt = match[1]
			}
		}

		// Customize icon and title for subagent commands
		const displayIcon = isSubagentCommand ? (
			<span className="text-foreground mb-[-1.5px]">
				<ClineCompactIcon />
			</span>
		) : (
			icon
		)

		const displayTitle = isSubagentCommand ? (
			<span className="text-foreground font-bold">Cline wants to use a subagent:</span>
		) : (
			title
		)

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{displayIcon}
				{displayTitle}
			</div>
		)

		return (
			<>
				{commandHeader}
				<div
					className="bg-code rounded-sm border border-editor-group-border"
					style={{
						transition: "all 0.3s ease-in-out",
					}}>
					{command && (
						<div className="bg-code flex items-center justify-between px-2 py-2.5 border-b border-editor-group-border rounded-sm rounded-b-none overflow-hidden">
							<div className="flex items-center gap-2 flex-1 m-w-0">
								<div
									className={cn("bg-description rounded-full w-2 h-2 shrink-0", {
										"bg-success animate-pulse": isCommandExecuting,
										"bg-editor-warning-foreground": isCommandPending,
									})}
								/>
								<span
									className={cn("text-description font-medium text-base shrink-0", {
										"text-success": isCommandExecuting,
										"text-editor-warning-foreground": isCommandPending,
									})}>
									{getCommandStatusText(isCommandExecuting, isCommandPending, isCommandCompleted)}
								</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												onCancelCommand?.()
											} else {
												// For regular terminal mode, show a message
												alert(
													"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
												)
											}
										}}
										size="sm"
										variant="secondary">
										{isBackgroundExec ? "cancel" : "stop"}
									</Button>
								)}
							</div>
						</div>
					)}

					{isSubagentCommand && subagentPrompt && (
						<div className="p-2.5 border-b border-editor-group-border">
							<div className="mb-0">
								<strong>Prompt:</strong> <span className="ph-no-capture font-editor">{subagentPrompt}</span>
							</div>
						</div>
					)}

					{!isSubagentCommand && (
						<div className="bg-code opacity-60 text-sm">
							<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
						</div>
					)}

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							output={output}
						/>
					)}
				</div>
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning"></i>
						<span>The model has determined this command requires explicit approval.</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

const CommandStatusMap = {
	executing: "Running",
	pending: "Pending",
	completed: "Completed",
	skipped: "Skipped",
}

function getCommandStatusText(isExecuting: boolean, isPending: boolean, isCompleted: boolean): string {
	if (isExecuting) {
		return CommandStatusMap.executing
	}
	if (isPending) {
		return CommandStatusMap.pending
	}
	if (isCompleted) {
		return CommandStatusMap.completed
	}
	return CommandStatusMap.skipped
}
