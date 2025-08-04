import { useCallback, forwardRef, useState, useEffect } from "react"
import { DecoratedVSCodeTextField, VSCodeTextFieldWithNodesProps } from "./DecoratedVSCodeTextField"

export interface InputFormatter<T> {
	/**
	 * Parse the raw input string into the typed value
	 */
	parse: (input: string) => T | undefined

	/**
	 * Format the typed value for display in the input field
	 */
	format: (value: T | undefined) => string

	/**
	 * Filter/transform the input as the user types (optional)
	 */
	filter?: (input: string) => string
}

interface FormattedTextFieldProps<T> extends Omit<VSCodeTextFieldWithNodesProps, "value" | "onInput"> {
	value: T | undefined
	onValueChange: (value: T | undefined) => void
	formatter: InputFormatter<T>
}

function FormattedTextFieldInner<T>(
	{ value, onValueChange, formatter, ...restProps }: FormattedTextFieldProps<T>,
	forwardedRef: React.Ref<HTMLInputElement>,
) {
	const [rawInput, setRawInput] = useState<string>("")
	const [isTyping, setIsTyping] = useState(false)

	// Update raw input when external value changes (but not when we're actively typing)
	useEffect(() => {
		if (!isTyping) {
			setRawInput(formatter.format(value))
		}
	}, [value, formatter, isTyping])

	const handleInput = useCallback(
		(e: React.FormEvent<HTMLInputElement>) => {
			const input = e.target as HTMLInputElement
			setIsTyping(true)

			let filteredValue = input.value
			if (formatter.filter) {
				filteredValue = formatter.filter(input.value)
				input.value = filteredValue
			}

			setRawInput(filteredValue)
			const parsedValue = formatter.parse(filteredValue)
			onValueChange(parsedValue)
		},
		[formatter, onValueChange],
	)

	const handleBlur = useCallback(() => {
		setIsTyping(false)
		// On blur, format the value properly
		setRawInput(formatter.format(value))
	}, [formatter, value])

	const displayValue = isTyping ? rawInput : formatter.format(value)

	return (
		<DecoratedVSCodeTextField
			{...restProps}
			value={displayValue}
			onInput={handleInput}
			onBlur={handleBlur}
			ref={forwardedRef}
		/>
	)
}

export const FormattedTextField = forwardRef(FormattedTextFieldInner as any) as <T>(
	props: FormattedTextFieldProps<T> & { ref?: React.Ref<HTMLInputElement> },
) => React.ReactElement

// Common formatters for reuse
export const unlimitedIntegerFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		if (input.trim() === "") return undefined
		const value = parseInt(input)
		return !isNaN(value) && value > 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		return value === undefined || value === Infinity ? "" : value.toString()
	},
	filter: (input: string) => input.replace(/[^0-9]/g, ""),
}

export const unlimitedDecimalFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		if (input.trim() === "") return undefined
		const value = parseFloat(input)
		return !isNaN(value) && value >= 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		return value === undefined || value === Infinity ? "" : value.toString()
	},
	filter: (input: string) => {
		// Remove all non-numeric and non-dot characters
		let cleanValue = input.replace(/[^0-9.]/g, "")

		// Handle multiple dots - keep only the first one
		const firstDotIndex = cleanValue.indexOf(".")
		if (firstDotIndex !== -1) {
			// Keep everything up to and including the first dot, then remove any additional dots
			const beforeDot = cleanValue.substring(0, firstDotIndex + 1)
			const afterDot = cleanValue.substring(firstDotIndex + 1).replace(/\./g, "")
			cleanValue = beforeDot + afterDot
		}

		return cleanValue
	},
}
