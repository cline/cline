import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
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
	...otherProps
}: DebouncedTextFieldProps) => {
	const [localValue, setLocalValue] = useDebouncedInput(initialValue, onChange)

	return (
		<VSCodeTextField
			{...otherProps}
			className={className}
			onInput={(e: any) => {
				const value = e.target.value
				setLocalValue(value)
			}}
			type={type}
			value={localValue}>
			{children}
		</VSCodeTextField>
	)
}
