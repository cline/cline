import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useDebounce } from "react-use"

interface TemperatureControlProps {
	value: number | undefined | null
	onChange: (value: number | undefined | null) => void
	maxValue?: number // Some providers like OpenAI use 0-2 range
}

export const TemperatureControl = ({ value, onChange, maxValue = 1 }: TemperatureControlProps) => {
	const [isCustomTemperature, setIsCustomTemperature] = useState(value !== undefined)
	const [inputValue, setInputValue] = useState(value)
	useDebounce(() => onChange(inputValue), 50, [onChange, inputValue])
	// Sync internal state with prop changes when switching profiles
	useEffect(() => {
		const hasCustomTemperature = value !== undefined && value !== null
		setIsCustomTemperature(hasCustomTemperature)
		setInputValue(value)
	}, [value])

	return (
		<>
			<div>
				<VSCodeCheckbox
					checked={isCustomTemperature}
					onChange={(e: any) => {
						const isChecked = e.target.checked
						setIsCustomTemperature(isChecked)
						if (!isChecked) {
							setInputValue(null) // Unset the temperature, note that undefined is unserializable
						} else {
							setInputValue(value ?? 0) // Use the value from apiConfiguration, if set
						}
					}}>
					<span className="font-medium">Use custom temperature</span>
				</VSCodeCheckbox>
				<div className="text-sm text-vscode-descriptionForeground">
					Controls randomness in the model's responses.
				</div>
			</div>

			{isCustomTemperature && (
				<div
					style={{
						marginLeft: 0,
						paddingLeft: 10,
						borderLeft: "2px solid var(--vscode-button-background)",
					}}>
					<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
						<input
							type="range"
							min="0"
							max={maxValue}
							step="0.01"
							value={inputValue ?? 0}
							className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							onChange={(e) => setInputValue(parseFloat(e.target.value))}
						/>
						<span>{inputValue}</span>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-1">
						Higher values make output more random, lower values make it more deterministic.
					</p>
				</div>
			)}
		</>
	)
}
