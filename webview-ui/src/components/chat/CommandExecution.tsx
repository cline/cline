import { HTMLAttributes, forwardRef, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { ChevronDown } from "lucide-react"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

interface CommandExecutionProps {
	command: string
	output: string
}

export const CommandExecution = forwardRef<HTMLDivElement, CommandExecutionProps>(({ command, output }, ref) => {
	const { terminalShellIntegrationDisabled = false } = useExtensionState()

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)

	const lines = useMemo(() => output.split("\n"), [output])

	return (
		<div ref={ref} className="w-full p-2 rounded-xs bg-vscode-editor-background">
			<div
				className={cn("flex flex-row justify-between cursor-pointer active:opacity-75", {
					"opacity-50": isExpanded,
				})}
				onClick={() => setIsExpanded(!isExpanded)}>
				<Line>{command}</Line>
				<ChevronDown className={cn("size-4 transition-transform duration-300", { "rotate-180": isExpanded })} />
			</div>
			<div className={cn("h-[200px]", { hidden: !isExpanded })}>
				<Virtuoso
					className="h-full mt-2"
					totalCount={lines.length}
					itemContent={(i) => <Line>{lines[i]}</Line>}
					followOutput="auto"
				/>
			</div>
		</div>
	)
})

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
