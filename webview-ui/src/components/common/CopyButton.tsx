import { CheckCheckIcon, CopyIcon } from "lucide-react"
import { forwardRef, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CopyButtonProps {
	textToCopy?: string
	onCopy?: () => string | undefined | null
	className?: string
	ariaLabel?: string
}

interface WithCopyButtonProps {
	children: React.ReactNode
	textToCopy?: string
	onCopy?: () => string | undefined | null
	position?: "top-right" | "bottom-right"
	style?: React.CSSProperties
	className?: string
	copyButtonClassname?: string
	onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void
	ariaLabel?: string
}

const COPIED_TIMEOUT = 1500

const POSITION_CLASSES = {
	"top-right": "top-5 right-5",
	"bottom-right": "bottom-1 right-2",
} as const

/**
 * Base copy button component with clipboard functionality
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy, onCopy, className, ariaLabel }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		const text = onCopy?.() || textToCopy
		if (!text) {
			return
		}

		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true)
				setTimeout(() => setCopied(false), COPIED_TIMEOUT)
			})
			.catch((err) => console.error("Copy failed", err))
	}, [textToCopy, onCopy])

	return (
		<Button
			aria-label={copied ? "Copied" : ariaLabel || "Copy"}
			className={cn("scale-90", className)}
			onClick={handleCopy}
			size="icon"
			variant="icon">
			{copied ? <CheckCheckIcon className="size-2" /> : <CopyIcon className="size-2" />}
		</Button>
	)
}

/**
 * Container component that wraps content with a copy button
 */
export const WithCopyButton = forwardRef<HTMLDivElement, WithCopyButtonProps>(
	(
		{
			children,
			textToCopy,
			onCopy,
			position = "top-right",
			style,
			className,
			copyButtonClassname,
			onMouseUp,
			ariaLabel,
			...props
		},
		ref,
	) => {
		const hasCopyFunctionality = !!(textToCopy || onCopy)

		return (
			<div className={cn("group relative w-full", className)} onMouseUp={onMouseUp} ref={ref} style={style} {...props}>
				{hasCopyFunctionality && (
					<div
						className={cn(
							"absolute opacity-0 group-hover:opacity-100 transition-opacity",
							POSITION_CLASSES[position],
							copyButtonClassname,
						)}>
						<CopyButton ariaLabel={ariaLabel} onCopy={onCopy} textToCopy={textToCopy} />
					</div>
				)}
				{children}
			</div>
		)
	},
)

WithCopyButton.displayName = "WithCopyButton"
