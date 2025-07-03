import { useState, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Props for the BaseUrlField component
 */
interface BaseUrlFieldProps {
	initialValue: string | undefined
	onChange: (value: string) => void
	defaultValue?: string
	label?: string
	placeholder?: string
}

/**
 * A reusable component for toggling and entering custom base URLs
 */
export const BaseUrlField = ({
	initialValue,
	onChange,
	label = "Use custom base URL",
	placeholder = "Default: https://api.example.com",
}: BaseUrlFieldProps) => {
	const [isEnabled, setIsEnabled] = useState(!!initialValue)
	const [localValue, setLocalValue] = useDebouncedInput(initialValue || "", onChange)

	const handleToggle = (e: any) => {
		const checked = e.target.checked === true
		setIsEnabled(checked)
		if (!checked) {
			setLocalValue("")
		}
	}

	return (
		<div>
			<VSCodeCheckbox checked={isEnabled} onChange={handleToggle}>
				{label}
			</VSCodeCheckbox>

			{isEnabled && (
				<VSCodeTextField
					value={localValue}
					style={{ width: "100%", marginTop: 3 }}
					type="url"
					onInput={(e: any) => setLocalValue(e.target.value)}
					placeholder={placeholder}
				/>
			)}
		</div>
	)
}
