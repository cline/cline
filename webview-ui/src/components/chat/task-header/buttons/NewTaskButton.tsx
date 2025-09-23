import { cn } from "@heroui/react"
import { XIcon } from "lucide-react"
import HeroTooltip from "@/components/common/HeroTooltip"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	return (
		<HeroTooltip content="Close current task to start new one" delay={1000} placement="bottom">
			<button
				aria-label="Start a New Task"
				className={cn(
					"flex items-center border-0 text-sm font-bold bg-transparent opacity-70 hover:opacity-100",
					className,
					"hover:bg-muted/10 px-0 cursor-pointer",
				)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick()
				}}
				type="button">
				<XIcon size="14" />
			</button>
		</HeroTooltip>
	)
}

export default NewTaskButton
