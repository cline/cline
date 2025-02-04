import React, { useState } from "react"
import styled from "styled-components"
import {
	getAsVar,
	VSC_DESCRIPTION_FOREGROUND,
	VSC_SIDEBAR_BACKGROUND,
	VSC_INPUT_PLACEHOLDER_FOREGROUND,
} from "../../utils/vscStyles"

interface TooltipProps {
	hintText: string
	tipText: string
	children: React.ReactNode
}

// add styled component for tooltip
const TooltipBody = styled.div`
	position: absolute;
	background-color: ${getAsVar(VSC_SIDEBAR_BACKGROUND)};
	color: ${getAsVar(VSC_DESCRIPTION_FOREGROUND)};
	padding: 5px;
	border-radius: 5px;
	bottom: 90%;
	left: -150%;
	z-index: 10;
	white-space: wrap;
	max-width: 200px;
	box-shadow: 0px 0px 10px rgba(255, 255, 255, 0.1);
	pointer-events: none;
`

const Hint = styled.div`
	font-size: 0.9em;
	color: ${getAsVar(VSC_INPUT_PLACEHOLDER_FOREGROUND)};
`

const Tooltip: React.FC<TooltipProps> = ({ tipText, hintText, children }) => {
	const [visible, setVisible] = useState(false)

	const showTooltip = () => setVisible(true)
	const hideTooltip = () => setVisible(false)

	return (
		<div style={{ position: "relative", display: "inline-block" }} onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
			{children}
			{visible && (
				<TooltipBody>
					{tipText}
					{hintText && <Hint>{hintText}</Hint>}
				</TooltipBody>
			)}
		</div>
	)
}

export default Tooltip
