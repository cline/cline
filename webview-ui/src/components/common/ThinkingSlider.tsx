import React, { useState, useRef, useEffect, useCallback } from "react"
import debounce from "debounce"
import styled from "styled-components"
import { getAsVar, VSC_SIDEBAR_BACKGROUND, VSC_DESCRIPTION_FOREGROUND, VSC_INPUT_BORDER } from "../../utils/vscStyles"

interface ThinkingSliderProps {
	value: number
	onChange: (value: number) => void
	disabled?: boolean
}

const SliderContainer = styled.div`
	position: relative;
	display: inline-block;
`

const BrainIcon = styled.div<{ disabled?: boolean }>`
	font-size: 16px;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};
	transform: scale(0.85);
	transform-origin: center;
	user-select: none;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
`

const TooltipBody = styled.div`
	position: absolute;
	background-color: ${getAsVar(VSC_SIDEBAR_BACKGROUND)};
	color: ${getAsVar(VSC_DESCRIPTION_FOREGROUND)};
	padding: 10px;
	border-radius: 5px;
	bottom: 100%;
	left: 50%;
	transform: translateX(-50%);
	margin-bottom: 8px;
	z-index: 10;
	width: 200px;
	border: 1px solid ${getAsVar(VSC_INPUT_BORDER)};
	font-size: 0.9em;

	// Arrow pointing down
	&::after {
		content: "";
		position: absolute;
		bottom: -6px;
		left: 50%;
		transform: translateX(-50%) rotate(45deg);
		width: 10px;
		height: 10px;
		background: ${getAsVar(VSC_SIDEBAR_BACKGROUND)};
		border-right: 1px solid ${getAsVar(VSC_INPUT_BORDER)};
		border-bottom: 1px solid ${getAsVar(VSC_INPUT_BORDER)};
	}
`

const SliderInput = styled.input`
	width: 100%;
	margin: 10px 0 5px;
`

const SliderValue = styled.div`
	text-align: center;
	font-size: 0.9em;
	margin-top: 5px;
`

const ThinkingSlider: React.FC<ThinkingSliderProps> = ({ value, onChange, disabled = false }) => {
	const [showTooltip, setShowTooltip] = useState(false)
	const [localValue, setLocalValue] = useState(value)
	const containerRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setLocalValue(value)
	}, [value])

	// Create a debounced version of setShowTooltip(false)
	const hideTooltipDebounced = useCallback(
		debounce(() => {
			setShowTooltip(false)
		}, 300), // 300ms delay before hiding
		[],
	)

	// Cancel the debounce when component unmounts
	useEffect(() => {
		return () => {
			hideTooltipDebounced.clear()
		}
	}, [hideTooltipDebounced])

	const handleMouseEnter = useCallback(() => {
		// Cancel any pending hide operations
		hideTooltipDebounced.clear()
		// Show immediately
		setShowTooltip(true)
	}, [hideTooltipDebounced])

	const handleMouseLeave = useCallback(() => {
		// Delay hiding to give time to move to the tooltip
		hideTooltipDebounced()
	}, [hideTooltipDebounced])

	const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = parseInt(e.target.value, 10)
		setLocalValue(newValue)
	}

	const handleSliderMouseUp = () => {
		onChange(localValue)
	}

	return (
		<SliderContainer ref={containerRef}>
			<BrainIcon
				disabled={disabled}
				onMouseEnter={() => !disabled && handleMouseEnter()}
				onMouseLeave={() => !disabled && handleMouseLeave()}
				className="codicon codicon-lightbulb-sparkle"
			/>

			{showTooltip && !disabled && (
				<TooltipBody ref={tooltipRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
					<div>Thinking Budget (tokens)</div>
					<SliderInput
						type="range"
						min="0"
						max="10000"
						value={localValue}
						onChange={handleSliderChange}
						onMouseUp={handleSliderMouseUp}
					/>
					<SliderValue>{localValue}</SliderValue>
				</TooltipBody>
			)}
		</SliderContainer>
	)
}

export default ThinkingSlider
