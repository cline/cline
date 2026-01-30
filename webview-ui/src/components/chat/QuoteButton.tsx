import { QuoteIcon } from "lucide-react"
import React from "react"
import styled from "styled-components"
import { Button } from "@/components/ui/button"

interface QuoteButtonProps {
	top: number
	left: number
	onClick: () => void
}

// Define props specifically for the styled component using transient props
interface ButtonContainerProps {
	$top: number
	$left: number
}

const ButtonContainer = styled.div<ButtonContainerProps>`
	top: ${(props) => props.$top}px; // Use transient prop $top
	left: ${(props) => props.$left}px; // Use transient prop $left
`

const QuoteButton: React.FC<QuoteButtonProps> = ({ top, left, onClick }) => {
	return (
		// Pass transient props to the styled component
		<ButtonContainer $left={left} $top={top} className="quote-button-class absolute">
			<Button
				aria-label="Quote selection"
				className="p-3 h-auto min-w-auto rounded-md shadow-sm transition-transform hover:scale-105 z-10"
				onClick={(e) => {
					e.stopPropagation() // Prevent triggering mouseup on the parent
					onClick()
				}}
				size="sm"
				title="Quote selection in reply">
				<QuoteIcon className="size-2 fill-button-foreground rotate-180 stroke-1" />
			</Button>
		</ButtonContainer>
	)
}

export default QuoteButton
