import { HTMLAttributes, forwardRef, useCallback, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { Virtuoso } from "react-virtuoso"
import { ChevronDown, Skull } from "lucide-react"

import { CommandExecutionStatus, commandExecutionStatusSchema } from "@roo/schemas"
import { ExtensionMessage } from "@roo/shared/ExtensionMessage"
import { safeJsonParse } from "@roo/shared/safeJsonParse"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { Button } from "@src/components/ui"

interface CommandExecutionProps {
	executionId?: string
	command: string
	output: string
}

export const CommandExecution = forwardRef<HTMLDivElement, CommandExecutionProps>(
	({ executionId, command, output }, ref) => {
		const { terminalShellIntegrationDisabled = false } = useExtensionState()

		// If we aren't opening the VSCode terminal for this command then we default
		// to expanding the command execution output.
		const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)

		const [status, setStatus] = useState<CommandExecutionStatus | null>(null)

		const lines = useMemo(() => output.split("\n").filter((line) => line.trim() !== ""), [output])

		const onMessage = useCallback(
			(event: MessageEvent) => {
				if (!executionId) {
					return
				}

				const message: ExtensionMessage = event.data

				if (message.type === "commandExecutionStatus") {
					const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

					if (result.success) {
						if (result.data.executionId !== executionId) {
							return
						}

						if (result.data.status === "fallback") {
							setIsExpanded(true)
						} else {
							setStatus(result.data)
						}
					}
				}
			},
			[executionId],
		)

		useEvent("message", onMessage)

		return (
			<div ref={ref} className="w-full p-2 rounded-xs bg-vscode-editor-background">
				<div className="flex flex-row justify-between">
					<Line>{command}</Line>
					<div>
						{status?.status === "running" && (
							<div className="flex flex-row items-center gap-2 shrink-0 font-mono text-sm">
								<div className="rounded-full size-1.5 bg-lime-400" />
								<div>Running</div>
								{status.pid && <div>(PID: {status.pid})</div>}
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
							<div className="flex flex-row items-center gap-2 shrink-0 font-mono text-sm">
								<div className="rounded-full size-1.5 bg-red-400" />
								<div>Exited ({status.exitCode})</div>
							</div>
						)}
						{lines.length > 0 && (
							<div className="flex flex-row items-center justify-end gap-2">
								<Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)}>
									<div>Output</div>
									<ChevronDown
										className={cn("size-4 transition-transform duration-300", {
											"rotate-180": isExpanded,
										})}
									/>
								</Button>
							</div>
						)}
					</div>
				</div>
				<div className={cn("h-[200px] mt-1 pt-1 border-t border-border/25", { hidden: !isExpanded })}>
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
	},
)

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
