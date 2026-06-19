import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { DebouncedTextField } from "./DebouncedTextField"

/**
 * Props for the BaseUrlField component
 */
interface BaseUrlFieldProps {
	initialValue: string | undefined
	onChange: (value: string) => void
	defaultValue?: string
	label?: string
	placeholder?: string
	disabled?: boolean
	showLockIcon?: boolean
}

/**
 * A reusable component for toggling and entering custom base URLs
 */
export const BaseUrlField = ({
	initialValue,
	onChange,
	label = "Use custom base URL",
	placeholder = "Default: https://api.example.com",
	disabled = false,
	showLockIcon = false,
}: BaseUrlFieldProps) => {
	const [isEnabled, setIsEnabled] = useState(!!initialValue)

	useEffect(() => {
		setIsEnabled(!!initialValue)
	}, [initialValue])

	const handleToggle = (e: unknown) => {
		const checked = (e as { target: HTMLInputElement }).target.checked === true
		setIsEnabled(checked)
		if (!checked) {
			onChange("")
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<VSCodeCheckbox checked={isEnabled} disabled={disabled} onChange={handleToggle}>
					{label}
				</VSCodeCheckbox>
				{showLockIcon && <i className="codicon codicon-lock text-(--vscode-descriptionForeground) text-sm" />}
			</div>

			{isEnabled && (
				<DebouncedTextField
					disabled={disabled}
					initialValue={initialValue || ""}
					onChange={(value) => onChange(value.trim())}
					placeholder={placeholder}
					style={{ width: "100%", marginTop: 3 }}
					type="text"
				/>
			)}
		</div>
	)
}
