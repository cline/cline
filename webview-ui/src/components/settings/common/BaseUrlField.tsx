import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
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
	disabled?: boolean
	showLockIcon?: boolean
}

/**
 * A reusable component for toggling and entering custom base URLs
 */
export const BaseUrlField = ({
	initialValue,
	onChange,
	label,
	placeholder,
	disabled = false,
	showLockIcon = false,
}: BaseUrlFieldProps) => {
	const [isEnabled, setIsEnabled] = useState(!!initialValue)
	const [localValue, setLocalValue] = useDebouncedInput(initialValue || "", onChange)
	const { t } = useTranslation("common")

	const handleToggle = (e: any) => {
		const checked = e.target.checked === true
		setIsEnabled(checked)
		if (!checked) {
			setLocalValue("")
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<VSCodeCheckbox checked={isEnabled} disabled={disabled} onChange={handleToggle}>
					{label || t("api_provider.common.base_url_label")}
				</VSCodeCheckbox>
				{showLockIcon && <i className="codicon codicon-lock text-(--vscode-descriptionForeground) text-sm" />}
			</div>

			{isEnabled && (
				<VSCodeTextField
					disabled={disabled}
					onInput={(e: any) => setLocalValue(e.target.value.trim())}
					placeholder={placeholder || t("api_provider.common.base_url_placeholder")}
					style={{ width: "100%", marginTop: 3 }}
					type="text"
					value={localValue}
				/>
			)}
		</div>
	)
}
