import React, { useState, useRef, forwardRef } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

// ======== Interfaces ========

interface CopyButtonProps {
	textToCopy?: string
	onCopy?: () => string | void | null
	className?: string
	ariaLabel?: string
}

interface WithCopyButtonProps {
	children: React.ReactNode
	textToCopy?: string
	onCopy?: () => string | void | null
	position?: "top-right" | "bottom-right"
	style?: React.CSSProperties
	className?: string
	onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void
	ariaLabel?: string
}

// ======== Styled Components ========

const StyledButton = styled(VSCodeButton)`
	z-index: 1;
`

// Unified container component
const ContentContainer = styled.div`
	position: relative;
`

// Unified button container with flexible positioning
const ButtonContainer = styled.div<{ $position?: "top-right" | "bottom-right" }>`
	position: absolute;
	${(props) => {
		switch (props.$position) {
			case "bottom-right":
				return "bottom: 2px; right: 2px;"
			case "top-right":
			default:
				return "top: 5px; right: 5px;"
		}
	}}
	z-index: 1;
	opacity: 0;

	${ContentContainer}:hover & {
		opacity: 1;
	}
`

// ======== Component Implementations ========

/**
 * Base copy button component with clipboard functionality
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy, onCopy, className = "", ariaLabel }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		if (!textToCopy && !onCopy) return

		let textToCopyFinal = textToCopy

		if (onCopy) {
			const result = onCopy()
			if (typeof result === "string") {
				textToCopyFinal = result
			}
		}

		if (textToCopyFinal) {
			navigator.clipboard
				.writeText(textToCopyFinal)
				.then(() => {
					setCopied(true)
					setTimeout(() => setCopied(false), 1500)
				})
				.catch((err) => console.error("Copy failed", err))
		}
	}

	return (
		<StyledButton
			appearance="icon"
			onClick={handleCopy}
			className={className}
			aria-label={copied ? "Copied" : ariaLabel || "Copy"}>
			<span className={`codicon codicon-${copied ? "check" : "copy"}`}></span>
		</StyledButton>
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
			onMouseUp,
			ariaLabel, // Destructure ariaLabel
			...props
		},
		ref,
	) => {
		return (
			<ContentContainer ref={ref} onMouseUp={onMouseUp} style={style} className={className} {...props}>
				{children}
				{(textToCopy || onCopy) && (
					<ButtonContainer $position={position}>
						<CopyButton
							textToCopy={textToCopy}
							onCopy={onCopy}
							ariaLabel={ariaLabel} // Pass through the ariaLabel prop directly
						/>
					</ButtonContainer>
				)}
			</ContentContainer>
		)
	},
)

// Default export for convenience if needed, though named exports are preferred for clarity
const CopyButtonComponents = {
	CopyButton,
	WithCopyButton,
}
export default CopyButtonComponents
