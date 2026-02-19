import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { ChevronDown, ChevronRight } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"

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

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isBackgroundExec = false,
		onCancelCommand,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
	}: {
		message: ClineMessage
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isBackgroundExec?: boolean
		onCancelCommand?: () => void
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
	}) => {
		const [isOutputExpanded, setIsOutputExpanded] = useState(false)

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

				{/* Footer bar */}
				<div className="flex items-center justify-between px-3 py-2 border-t border-editor-group-border/50">
					<div className="flex items-center gap-2">
						<button
							className="flex items-center gap-1 text-sm text-foreground hover:text-description transition-colors"
							type="button">
							<span>Ask Everytime</span>
							<ChevronDown className="text-description" size={14} />
						</button>
						{showCancelButton && (
							<Button
								onClick={(e) => {
									e.stopPropagation()
									if (isBackgroundExec) {
										onCancelCommand?.()
									} else {
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
						{requestsApproval && (
							<span className="text-xs text-editor-warning-foreground flex items-center gap-1.5">
								<i className="codicon codicon-warning text-[11px]" />
								Requires approval
							</span>
						)}
					</div>
					<div className="flex items-center gap-1.5">
						{status.showCheck && <i className="codicon codicon-check text-sm text-success" />}
						<span className={cn("text-sm", status.color)}>{status.text}</span>
					</div>
				</div>
			</div>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"
