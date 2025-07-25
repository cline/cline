import { useCallback, useState, memo, useMemo } from "react"
import { useEvent } from "react-use"
import { ChevronDown, Skull } from "lucide-react"

import { CommandExecutionStatus, commandExecutionStatusSchema } from "@roo-code/types"

import { ExtensionMessage } from "@roo/ExtensionMessage"
import { safeJsonParse } from "@roo/safeJsonParse"

import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { Button } from "@src/components/ui"
import CodeBlock from "../common/CodeBlock"
import { CommandPatternSelector } from "./CommandPatternSelector"
import { extractPatternsFromCommand } from "../../utils/command-parser"

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandExecutionProps {
	executionId: string
	text?: string
	icon?: JSX.Element | null
	title?: JSX.Element | null
}

export const CommandExecution = ({ executionId, text, icon, title }: CommandExecutionProps) => {
	const {
		terminalShellIntegrationDisabled = false,
		allowedCommands = [],
		deniedCommands = [],
		setAllowedCommands,
		setDeniedCommands,
	} = useExtensionState()

	const { command, output: parsedOutput } = useMemo(() => parseCommandAndOutput(text), [text])

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)
	const [streamingOutput, setStreamingOutput] = useState("")
	const [status, setStatus] = useState<CommandExecutionStatus | null>(null)

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput

	// Extract command patterns from the actual command that was executed
	const commandPatterns = useMemo<CommandPattern[]>(() => {
		const extractedPatterns = extractPatternsFromCommand(command)
		return extractedPatterns.map((pattern) => ({
			pattern,
		}))
	}, [command])

	// Handle pattern changes
	const handleAllowPatternChange = (pattern: string) => {
		const isAllowed = allowedCommands.includes(pattern)
		const newAllowed = isAllowed ? allowedCommands.filter((p) => p !== pattern) : [...allowedCommands, pattern]
		const newDenied = deniedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)
		vscode.postMessage({ type: "allowedCommands", commands: newAllowed })
		vscode.postMessage({ type: "deniedCommands", commands: newDenied })
	}

	const handleDenyPatternChange = (pattern: string) => {
		const isDenied = deniedCommands.includes(pattern)
		const newDenied = isDenied ? deniedCommands.filter((p) => p !== pattern) : [...deniedCommands, pattern]
		const newAllowed = allowedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)
		vscode.postMessage({ type: "allowedCommands", commands: newAllowed })
		vscode.postMessage({ type: "deniedCommands", commands: newDenied })
	}

	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							setStatus(data)
							break
						case "output":
							setStreamingOutput(data.output)
							break
						case "fallback":
							setIsExpanded(true)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-1">
					{icon}
					{title}
				</div>
				<div className="flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status?.status === "started" && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								<div className="rounded-full size-1.5 bg-lime-400" />
								<div>Running</div>
								{status.pid && <div className="whitespace-nowrap">(PID: {status.pid})</div>}
								<Button
									variant="ghost"
									size="icon"
									onClick={() =>
										vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
									}>
									<Skull />
								</Button>
							</div>
						)}
						{status?.status === "exited" && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								<div
									className={cn(
										"rounded-full size-1.5",
										status.exitCode === 0 ? "bg-lime-400" : "bg-red-400",
									)}
								/>
								<div className="whitespace-nowrap">Exited ({status.exitCode})</div>
							</div>
						)}
						{output.length > 0 && (
							<Button variant="ghost" size="icon" onClick={() => setIsExpanded(!isExpanded)}>
								<ChevronDown
									className={cn("size-4 transition-transform duration-300", {
										"rotate-180": isExpanded,
									})}
								/>
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs">
				<div className="p-2">
					<CodeBlock source={command} language="shell" />
					<OutputContainer isExpanded={isExpanded} output={output} />
				</div>
				{command && command.trim() && (
					<CommandPatternSelector
						command={command}
						patterns={commandPatterns}
						allowedCommands={allowedCommands}
						deniedCommands={deniedCommands}
						onAllowPatternChange={handleAllowPatternChange}
						onDenyPatternChange={handleDenyPatternChange}
					/>
				)}
			</div>
		</>
	)
}

CommandExecution.displayName = "CommandExecution"

const OutputContainerInternal = ({ isExpanded, output }: { isExpanded: boolean; output: string }) => (
	<div
		className={cn("overflow-hidden", {
			"max-h-0": !isExpanded,
			"max-h-[100%] mt-1 pt-1 border-t border-border/25": isExpanded,
		})}>
		{output.length > 0 && <CodeBlock source={output} language="log" />}
	</div>
)

const OutputContainer = memo(OutputContainerInternal)

const parseCommandAndOutput = (text: string | undefined) => {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	return {
		command: text.slice(0, index),
		output: text.slice(index + COMMAND_OUTPUT_STRING.length),
	}
}
