import { useState, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

/**
 * Props for the BaseUrlField component
 */
interface BaseUrlFieldProps {
	value: string | undefined
	onChange: (value: string) => void
	defaultValue?: string
	label?: string
	placeholder?: string
}

/**
 * A reusable component for toggling and entering custom base URLs
 */
export const BaseUrlField = ({
	value,
	onChange,
	defaultValue = "",
	label = "Use custom base URL",
	placeholder = "Default: https://api.example.com",
}: BaseUrlFieldProps) => {
	const [isEnabled, setIsEnabled] = useState(!!value)

	// When value changes externally, update isEnabled state
	useEffect(() => {
		setIsEnabled(!!value)
	}, [value])

	const handleToggle = (e: any) => {
		const checked = e.target.checked === true
		setIsEnabled(checked)
		if (!checked) {
			onChange("")
		}
	}

	return (
		<div>
			<VSCodeCheckbox checked={isEnabled} onChange={handleToggle}>
				{label}
			</VSCodeCheckbox>

			{isEnabled && (
				<VSCodeTextField
					value={value || ""}
					style={{ width: "100%", marginTop: 3 }}
					type="url"
					onInput={(e: any) => onChange(e.target.value)}
					placeholder={placeholder}
				/>
			)}
		</div>
	)
}
