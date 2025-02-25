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
	displayValue?: string | number
	validateValue?: (value: number) => number // Optional function to validate the value
}

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
}: ClineSliderProps) => {
	// Local state to update UI immediately
	const [localValue, setLocalValue] = useState(value)
	// Track if the user is currently dragging
	const [isDragging, setIsDragging] = useState(false)

	// Update local value when prop value changes
	useEffect(() => {
		// Only update localValue from props if not currently dragging
		if (!isDragging) {
			setLocalValue(value)
		}
	}, [value, isDragging])

	// Create debounced onChange handler with useMemo
	const debouncedOnChange = useMemo(() => debounce((val: number) => onChange(val), 300), [onChange])

	// Clear debounce on unmount
	useEffect(() => {
		return () => {
			debouncedOnChange.clear()
		}
	}, [debouncedOnChange])

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = parseInt(e.target.value, 10)
		setLocalValue(newValue) // Update UI immediately
		setIsDragging(true) // Mark as dragging
		debouncedOnChange(newValue) // Debounce the onChange callback
	}

	const handleSlideEnd = () => {
		if (onChangeEnd) {
			// If validateValue is provided, use it to validate the value before passing to onChangeEnd
			const finalValue = validateValue ? validateValue(localValue) : localValue
			setLocalValue(finalValue)
			onChangeEnd(finalValue)
		}
		// Reset dragging state after a short delay to allow value prop to update
		setTimeout(() => setIsDragging(false), 50)
	}

	// Initialize the styles once when the component is first mounted
	useEffect(() => {
		// Check if the style has already been added to avoid duplicates
		if (!document.getElementById("cline-slider-styles")) {
			const styleElement = document.createElement("style")
			styleElement.id = "cline-slider-styles"
			styleElement.innerHTML = `
        .cline-slider {
          width: 100%;
          height: 4px;
          appearance: none;
          background-color: var(--vscode-scrollbarSlider-background);
          border-radius: 2px;
          outline: none;
          cursor: pointer;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .cline-slider::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          cursor: pointer;
          border: none;
          margin: 0;
        }
        
        .cline-slider:focus {
          outline: none;
        }
        
        .cline-slider:focus::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:hover::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:active::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
      `
			document.head.appendChild(styleElement)
		}
	}, [])

	return (
		<div style={{ marginTop: "10px" }}>
			<label htmlFor={id} style={{ fontWeight: 500, display: "block", marginBottom: "5px" }}>
				{label}: {localValue}
			</label>
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
			/>
			{description && (
				<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>{description}</p>
			)}
		</div>
	)
}

export default memo(ClineSlider)
