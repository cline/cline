import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Props for the BaseUrlField component
 */
interface BaseUrlFieldProps {
	initialValue: string | undefined
	onChange: (value: string) => void
	/** Clears the persisted value. Reject to restore the authoritative enabled state. */
	onClear?: () => Promise<void>
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
	onClear,
	label = "Use custom base URL",
	placeholder = "Default: https://api.example.com",
	disabled = false,
	showLockIcon = false,
}: BaseUrlFieldProps) => {
	const [isEnabled, setIsEnabled] = useState(!!initialValue)
	const [isClearing, setIsClearing] = useState(false)
	const userToggledRef = useRef(false)
	const [localValue, setLocalValue, syncLocalValue] = useDebouncedInput(initialValue || "", (value: string) =>
		onChange(value.trim()),
	)

	// Provider config loads asynchronously, so a saved base URL usually arrives
	// after mount (initialValue starts undefined). Reflect it in the checkbox
	// once it lands, unless the user has already toggled the box themselves.
	useEffect(() => {
		if (!userToggledRef.current) {
			setIsEnabled(!!initialValue)
		}
	}, [initialValue])

	const handleToggle = (e: any) => {
		const checked = e.target.checked === true
		userToggledRef.current = true
		setIsEnabled(checked)
		if (!checked) {
			// Cancel any pending debounced edit before starting the clear. Otherwise
			// its timer or unmount cleanup could restore the non-empty URL while the
			// clear write is in flight.
			syncLocalValue("")
			let clearResult: Promise<void> | undefined
			try {
				clearResult = onClear?.()
			} catch {
				userToggledRef.current = false
				setIsEnabled(!!initialValue)
				syncLocalValue(initialValue || "")
				return
			}
			if (clearResult) {
				setIsClearing(true)
				void clearResult
					.catch(() => {
						userToggledRef.current = false
						setIsEnabled(!!initialValue)
						syncLocalValue(initialValue || "")
					})
					.finally(() => setIsClearing(false))
			} else {
				onChange("")
			}
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<VSCodeCheckbox checked={isEnabled} disabled={disabled || isClearing} onChange={handleToggle}>
					{label}
				</VSCodeCheckbox>
				{showLockIcon && <i className="codicon codicon-lock text-(--vscode-descriptionForeground) text-sm" />}
			</div>

			{isEnabled && (
				<VSCodeTextField
					disabled={disabled}
					onInput={(e: any) => setLocalValue(e.target.value)}
					placeholder={placeholder}
					style={{ width: "100%", marginTop: 3 }}
					type="text"
					value={localValue}
				/>
			)}
		</div>
	)
}
