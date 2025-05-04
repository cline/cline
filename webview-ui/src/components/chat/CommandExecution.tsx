import { HTMLAttributes, useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { Virtuoso } from "react-virtuoso"
import { ChevronDown, Skull } from "lucide-react"

import { CommandExecutionStatus, commandExecutionStatusSchema } from "@roo/schemas"
import { ExtensionMessage } from "@roo/shared/ExtensionMessage"
import { safeJsonParse } from "@roo/shared/safeJsonParse"
import { COMMAND_OUTPUT_STRING } from "@roo/shared/combineCommandSequences"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { Button } from "@src/components/ui"

interface CommandExecutionProps {
	executionId: string
	text?: string
}

export const CommandExecution = ({ executionId, text }: CommandExecutionProps) => {
	const { terminalShellIntegrationDisabled = false } = useExtensionState()

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)

	const [status, setStatus] = useState<CommandExecutionStatus | null>(null)
	const [output, setOutput] = useState("")
	const [command, setCommand] = useState(text)

	const lines = useMemo(
		() => [`$ ${command}`, ...output.split("\n").filter((line) => line.trim() !== "")],
		[output, command],
	)

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
							setCommand(data.command)
							setStatus(data)
							break
						case "output":
							setOutput((output) => output + data.output)
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

	useEffect(() => {
		if (!status && text) {
			const index = text.indexOf(COMMAND_OUTPUT_STRING)

			if (index === -1) {
				setCommand(text)
			} else {
				setCommand(text.slice(0, index))
				setOutput(text.slice(index + COMMAND_OUTPUT_STRING.length))
			}
		}
	}, [status, text])

	return (
		<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2">
			<div className="flex flex-row items-center justify-between gap-2 px-1">
				<Line className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">{command}</Line>
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
					{lines.length > 0 && (
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
			<div
				className={cn("mt-1 pt-1 border-t border-border/25", { hidden: !isExpanded })}
				style={{ height: Math.min((lines.length + 1) * 16, 200) }}>
				{lines.length > 0 && (
					<Virtuoso
						className="h-full"
						totalCount={lines.length}
						itemContent={(i) => <Line className="text-sm">{lines[i]}</Line>}
						followOutput="auto"
					/>
				)}
			</div>
		</div>
	)
}

type LineProps = HTMLAttributes<HTMLDivElement>

const Line = ({ className, ...props }: LineProps) => {
	return (
		<div
			className={cn("font-mono text-vscode-editor-foreground whitespace-pre-wrap break-words", className)}
			{...props}
		/>
	)
}

CommandExecution.displayName = "CommandExecution"
