import { StandardTooltip } from "@/components/ui"

interface IconButtonProps {
	icon: string
	onClick?: (e: React.MouseEvent) => void
	onMouseDown?: (e: React.MouseEvent) => void
	onMouseUp?: (e: React.MouseEvent) => void
	onMouseLeave?: (e: React.MouseEvent) => void
	title?: string
	size?: "small" | "medium"
	variant?: "default" | "transparent"
}

export function IconButton({
	icon,
	onClick,
	onMouseDown,
	onMouseUp,
	onMouseLeave,
	title,
	size = "medium",
	variant = "default",
}: IconButtonProps) {
	const sizeClasses = {
		small: "w-6 h-6",
		medium: "w-7 h-7",
	}

	const variantClasses = {
		default: "bg-transparent hover:bg-vscode-toolbar-hoverBackground",
		transparent: "bg-transparent hover:bg-vscode-toolbar-hoverBackground",
	}

	const handleClick = onClick || ((_event: React.MouseEvent) => {})

	const button = (
		<button
			className={`${sizeClasses[size]} flex items-center justify-center border-none text-vscode-editor-foreground cursor-pointer rounded-[3px] ${variantClasses[variant]}`}
			aria-label={title}
			onClick={handleClick}
			onMouseDown={onMouseDown}
			onMouseUp={onMouseUp}
			onMouseLeave={onMouseLeave}>
			<span className={`codicon codicon-${icon}`}></span>
		</button>
	)

	if (title) {
		return <StandardTooltip content={title}>{button}</StandardTooltip>
	}

	return button
}
