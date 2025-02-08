import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"

interface TemperatureControlProps {
	value: number | undefined
	onChange: (value: number | undefined) => void
	maxValue?: number // Some providers like OpenAI use 0-2 range
}

export const TemperatureControl = ({ value, onChange, maxValue = 1 }: TemperatureControlProps) => {
	const [isCustomTemperature, setIsCustomTemperature] = useState(value !== undefined)

	// Sync internal state with prop changes when switching profiles
	useEffect(() => {
		const hasCustomTemperature = value !== undefined
		setIsCustomTemperature(hasCustomTemperature)
	}, [value])

	return (
		<div
			style={{
				marginTop: 10,
				marginBottom: 15,
				paddingLeft: 10,
				borderLeft: "2px solid var(--vscode-button-background)",
			}}>
			<VSCodeCheckbox
				checked={isCustomTemperature}
				onChange={(e: any) => {
					const isChecked = e.target.checked
					setIsCustomTemperature(isChecked)
					if (!isChecked) {
						onChange(undefined) // Unset the temperature
					} else if (value !== undefined) {
						onChange(value) // Use the value from apiConfiguration, if set
					}
				}}>
				<span style={{ fontWeight: "500" }}>Use custom temperature</span>
			</VSCodeCheckbox>

			<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
				Controls randomness in the model's responses. Higher values make output more random, lower values make
				it more deterministic.
			</p>

			{isCustomTemperature && (
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
						<input
							type="range"
							min="0"
							max={maxValue}
							step="0.05"
							value={value}
							onChange={(e) => {
								const newValue = parseFloat(e.target.value)
								onChange(isNaN(newValue) ? undefined : newValue)
							}}
							style={{
								flexGrow: 1,
								accentColor: "var(--vscode-button-background)",
								height: "2px",
							}}
						/>
						<span style={{ minWidth: "45px", textAlign: "left" }}>{value?.toFixed(2)}</span>
					</div>
				</div>
			)}
		</div>
	)
}
