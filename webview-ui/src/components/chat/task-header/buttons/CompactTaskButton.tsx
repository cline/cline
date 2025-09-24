import { cn, Tooltip } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FoldVerticalIcon } from "lucide-react"

const CompactTaskButton: React.FC<{
	className?: string
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className }) => {
	return (
		<Tooltip
			content={
				<div className="flex flex-col gap-1.5 bg-menu rounded shadow-sm border border-menu-border z-100 max-w-xs p-4">
					<div className="text-sm font-medium">Compact Task</div>
					<div className="text-sm text-muted-foreground">
						Reduces the number of tokens used by summarizing the task. To enable automatic condensing, turn on{" "}
						<kbd>Auto Compact</kbd> in the settings and set the threshold by clicking on the context window usage bar.
					</div>
				</div>
			}
			delay={0}
			disableAnimation={true}
			placement="bottom">
			<VSCodeButton
				appearance="icon"
				className={cn(
					"text-foreground flex items-center text-sm font-bold hover:bg-transparent hover:opacity-80",
					className,
				)}
				onClick={onClick}
				type="button">
				<FoldVerticalIcon size={12} />
			</VSCodeButton>
		</Tooltip>
	)
}

export default CompactTaskButton
