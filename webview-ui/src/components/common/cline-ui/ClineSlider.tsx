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
	description?: string
	displayValue?: string | number
}

const ClineSlider = ({ id, label, value, min, max, step, onChange, description, displayValue = value }: ClineSliderProps) => {
	// Local state to update UI immediately
	const [localValue, setLocalValue] = useState(value)

	// Update local value when prop value changes
	useEffect(() => {
		setLocalValue(value)
	}, [value])

	// Create debounced onChange handler with useMemo
	const debouncedFn = useMemo(() => debounce((val: number) => onChange(val), 300), [onChange])

	// Clear debounce on unmount
	useEffect(() => {
		return () => {
			debouncedFn.clear()
		}
	}, [debouncedFn])

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = parseInt(e.target.value, 10)
		setLocalValue(newValue) // Update UI immediately
		debouncedFn(newValue) // Debounce the actual callback
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
        }
        
        .cline-slider::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          cursor: pointer;
          border: none;
        }
        
        .cline-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          cursor: pointer;
          border: none;
        }
        
        .cline-slider:focus {
          outline: none;
        }
        
        .cline-slider:focus::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:focus::-moz-range-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:hover::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:hover::-moz-range-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:active::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground);
        }
        
        .cline-slider:active::-moz-range-thumb {
          background: var(--vscode-button-hoverBackground);
        }
      `
			document.head.appendChild(styleElement)
		}
	}, [])

	return (
		<div style={{ marginTop: "10px" }}>
			<label htmlFor={id} style={{ fontWeight: 500, display: "block", marginBottom: "5px" }}>
				{label}: {displayValue !== value ? displayValue : localValue}
			</label>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={localValue}
				onChange={handleChange}
				className="cline-slider"
			/>
			{description && (
				<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>{description}</p>
			)}
		</div>
	)
}

export default memo(ClineSlider)
