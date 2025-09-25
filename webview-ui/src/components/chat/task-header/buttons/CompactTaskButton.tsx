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
				<div className="flex flex-col gap-1 bg-menu rounded shadow-sm border border-menu-border z-100 max-w-xs py-1 px-2">
					<div className="text-xs font-medium">Compact Task</div>
					<div className="text-xs text-muted-foreground">
						Reduces the number of tokens used by summarizing the task.
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
