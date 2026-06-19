import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect } from "react"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Props for the DebouncedTextField component
 */
interface DebouncedTextFieldProps {
	// Custom props for debouncing functionality
	initialValue: string
	onChange: (value: string) => void

	// Common VSCodeTextField props
	style?: React.CSSProperties
	type?: "text" | "password"
	placeholder?: string
	id?: string
	children?: React.ReactNode
	disabled?: boolean
	className?: string
	required?: boolean
	onFocus?: React.FocusEventHandler<HTMLElement>
	onBlur?: React.FocusEventHandler<HTMLElement>
	onLocalValueChange?: (value: string) => void
	shouldSyncInitialValue?: () => boolean
}

/**
 * A wrapper around VSCodeTextField that automatically handles debounced input
 * to prevent excessive API calls while typing
 */
export const DebouncedTextField = ({
	initialValue,
	onChange,
	children,
	type,
	className,
	onLocalValueChange,
	shouldSyncInitialValue,
	...otherProps
}: DebouncedTextFieldProps) => {
	const [localValue, setLocalValue] = useDebouncedInput(initialValue, onChange, 100, { shouldSyncInitialValue })

	useEffect(() => {
		onLocalValueChange?.(localValue)
	}, [localValue, onLocalValueChange])

	return (
		<VSCodeTextField
			{...otherProps}
			className={className}
			onInput={(e) => {
				const value = (e.target as HTMLInputElement).value
				setLocalValue(value)
			}}
			type={type}
			value={localValue}>
			{children}
		</VSCodeTextField>
	)
}
