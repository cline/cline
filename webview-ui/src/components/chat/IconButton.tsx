import { cn } from "@src/lib/utils"
import { Button, StandardTooltip } from "@src/components/ui"

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	iconClass: string
	title: string
	disabled?: boolean
	tooltip?: boolean
	isLoading?: boolean
	style?: React.CSSProperties
}

export const IconButton: React.FC<IconButtonProps> = ({
	iconClass,
	title,
	className,
	disabled,
	tooltip = true,
	isLoading,
	onClick,
	style,
	...props
}) => (
	<StandardTooltip content={tooltip ? title : undefined}>
		<Button
			aria-label={title}
			className={cn(
				"relative inline-flex items-center justify-center",
				"bg-transparent border-none p-1.5",
				"rounded-md min-w-[28px] min-h-[28px]",
				"text-vscode-foreground opacity-85",
				"transition-all duration-150",
				"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
				"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
				"active:bg-[rgba(255,255,255,0.1)]",
				!disabled && "cursor-pointer",
				disabled &&
					"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
				className,
			)}
			disabled={disabled}
			onClick={!disabled ? onClick : undefined}
			style={{ fontSize: 16.5, ...style }}
			{...props}>
			<span className={cn("codicon", iconClass, isLoading && "codicon-modifier-spin")} />
		</Button>
	</StandardTooltip>
)
