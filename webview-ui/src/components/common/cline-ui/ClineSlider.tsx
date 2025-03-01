import { memo, useEffect, useState, useMemo } from "react"
import debounce from "debounce"

interface ClineSliderProps {
	id: string
	label: string
	value: number
	min: number
	max: number
	step: number
	onChange: (value: number) => void
	onChangeEnd?: (value: number) => void
	description?: string
	validateValue?: (value: number) => number
	dynamicColor?: boolean
	secondaryLabel?: string
	getSecondaryLabel?: (value: number, min: number, max: number) => string | JSX.Element
}

// Constants
const THUMB_SIZE = 24
const DEBOUNCE_DELAY = 300

const ClineSlider = ({
	id,
	label,
	value,
	min,
	max,
	step,
	onChange,
	onChangeEnd,
	description,
	validateValue,
	dynamicColor = false,
	secondaryLabel,
	getSecondaryLabel,
}: ClineSliderProps) => {
	// State
	const [localValue, setLocalValue] = useState(value)
	const [isDragging, setIsDragging] = useState(false)

	// Update local value when prop value changes (if not dragging)
	useEffect(() => {
		if (!isDragging) {
			setLocalValue(value)
		}
	}, [value, isDragging])

	// Create debounced onChange handler
	const debouncedOnChange = useMemo(() => debounce((val: number) => onChange(val), DEBOUNCE_DELAY), [onChange])

	// Clear debounce on unmount
	useEffect(() => () => debouncedOnChange.clear(), [debouncedOnChange])

	// Event handlers
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = parseInt(e.target.value, 10)
		setLocalValue(newValue)
		setIsDragging(true)
		debouncedOnChange(newValue)
	}

	const handleSlideEnd = () => {
		if (onChangeEnd) {
			const finalValue = validateValue ? validateValue(localValue) : localValue
			setLocalValue(finalValue)
			onChangeEnd(finalValue)
		}
		setTimeout(() => setIsDragging(false), 50)
	}

	// Calculate percentage for dynamic color
	const percentage = (localValue - min) / (max - min)
	const intensity = dynamicColor ? percentage : 0

	// Initialize styles once
	useEffect(() => {
		if (document.getElementById("cline-slider-styles")) return

		const styleElement = document.createElement("style")
		styleElement.id = "cline-slider-styles"
		styleElement.innerHTML = `
      .cline-slider {
        width: 100%;
        height: 16px;
        appearance: none;
        background-color: var(--track-color, var(--vscode-scrollbarSlider-background));
        border-radius: 8px;
        outline: none;
        cursor: pointer;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .cline-slider::-webkit-slider-thumb {
        appearance: none;
        width: var(--thumb-size, 24px);
        height: var(--thumb-size, 24px);
        border-radius: 50%;
        background: white;
        cursor: pointer;
        border: 2px solid var(--thumb-color, var(--vscode-button-background));
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        margin: 0;
      }
      
      .cline-slider:focus { outline: none; }
      
      .cline-slider:focus::-webkit-slider-thumb,
      .cline-slider:hover::-webkit-slider-thumb {
        background: white;
        border-color: var(--thumb-color, var(--vscode-button-hoverBackground));
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }
      
      .cline-slider:active::-webkit-slider-thumb {
        background: white;
        border-color: var(--thumb-color, var(--vscode-button-hoverBackground));
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }
    `
		document.head.appendChild(styleElement)
	}, [])

	// Common styles
	const containerStyle: React.CSSProperties = { marginTop: "10px" }
	const labelContainerStyle: React.CSSProperties = {
		display: "flex",
		justifyContent: "space-between",
		marginBottom: "10px",
		flexWrap: "wrap",
		gap: "12px",
	}
	const labelStyle: React.CSSProperties = {
		fontWeight: 500,
		display: "block",
		marginRight: "auto",
	}
	const valueStyle: React.CSSProperties = {
		color: "var(--vscode-button-foreground)",
		backgroundColor: "var(--vscode-button-background)",
		padding: "2px 6px",
		borderRadius: "4px",
	}
	const secondaryLabelStyle: React.CSSProperties = {
		fontWeight: 500,
		textAlign: "right",
		whiteSpace: "nowrap",
		flexShrink: 0,
	}
	const descriptionStyle: React.CSSProperties = {
		fontSize: "12px",
		marginTop: "5px",
		color: "var(--vscode-descriptionForeground)",
	}

	// Input style with dynamic color if enabled
	const inputStyle = {
		marginTop: "5px",
		"--thumb-size": `${THUMB_SIZE}px`,
		...(dynamicColor
			? {
					"--thumb-color": `var(--vscode-button-background)`,
					"--track-color": `var(--vscode-button-background)`,
					opacity: 0.5 + intensity * 0.5,
				}
			: {}),
	} as React.CSSProperties

	return (
		<div style={containerStyle}>
			<div style={labelContainerStyle}>
				<label htmlFor={id} style={labelStyle}>
					<span style={{ color: "var(--vscode-editor-foreground)" }}>{label}:</span>{" "}
					<span style={valueStyle}>{localValue}</span>
				</label>
				{(secondaryLabel || getSecondaryLabel) && (
					<div style={secondaryLabelStyle}>
						{secondaryLabel || (getSecondaryLabel && getSecondaryLabel(localValue, min, max))}
					</div>
				)}
			</div>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={localValue}
				onChange={handleChange}
				onMouseUp={handleSlideEnd}
				onTouchEnd={handleSlideEnd}
				className="cline-slider"
				style={inputStyle}
			/>
			{description && <p style={descriptionStyle}>{description}</p>}
		</div>
	)
}

export default memo(ClineSlider)
