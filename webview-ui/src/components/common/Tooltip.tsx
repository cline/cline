import React, { useState } from "react"
import styled from "styled-components"
import {
	getAsVar,
	VSC_DESCRIPTION_FOREGROUND,
	VSC_INPUT_BORDER,
	VSC_INPUT_PLACEHOLDER_FOREGROUND,
	VSC_SIDEBAR_BACKGROUND,
} from "@/utils/vscStyles"

interface TooltipProps {
	visible?: boolean
	hintText?: string
	tipText: string
	children: React.ReactNode
	style?: React.CSSProperties
}

// add styled component for tooltip
const TooltipBody = styled.div<Pick<TooltipProps, "style">>`
	position: absolute;
	background-color: ${getAsVar(VSC_SIDEBAR_BACKGROUND)};
	color: ${getAsVar(VSC_DESCRIPTION_FOREGROUND)};
	padding: 5px;
	border-radius: 5px;
	bottom: 100%;
	left: ${(props) => props.style?.left ?? -180}%;
	z-index: ${(props) => props.style?.zIndex ?? 1000};
	white-space: wrap;
	max-width: 200px;
	border: 1px solid ${getAsVar(VSC_INPUT_BORDER)};
	pointer-events: none;
	font-size: 0.9em;
`

const Hint = styled.div`
	font-size: 0.8em;
	color: ${getAsVar(VSC_INPUT_PLACEHOLDER_FOREGROUND)};
	opacity: 0.8;
	margin-top: 2px;
`

const Tooltip: React.FC<TooltipProps> = ({ visible, tipText, hintText, children, style }) => {
	const [isHovered, setIsHovered] = useState(false)

	// Determine final visibility based on prop or internal state
	const shouldShow = visible !== undefined ? visible : isHovered

	return (
		<div
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{ position: "relative", display: "inline-block" }}>
			{children}
			{shouldShow && (
				<TooltipBody style={style}>
					{tipText}
					{hintText && <Hint>{hintText}</Hint>}
				</TooltipBody>
			)}
		</div>
	)
}

export default Tooltip
