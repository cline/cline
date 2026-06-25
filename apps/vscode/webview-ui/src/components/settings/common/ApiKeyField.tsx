import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * Props for the ApiKeyField component
 */
interface ApiKeyFieldProps {
	initialValue: string
	onChange: (value: string) => void
	providerName: string
	signupUrl?: string
	placeholder?: string
	helpText?: string
	label?: string
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key
 */
export const ApiKeyField = ({
	initialValue,
	onChange,
	providerName,
	signupUrl,
	placeholder = "Enter API Key...",
	helpText,
	label = `${providerName} API Key`,
}: ApiKeyFieldProps) => {
	const [localValue, setLocalValue] = useState(initialValue)
	const isFocusedRef = useRef(false)
	const prevInitialValueRef = useRef(initialValue)

	useEffect(() => {
		if (prevInitialValueRef.current === initialValue) {
			return
		}

		prevInitialValueRef.current = initialValue

		// API key saves can update the masked initial value while the user is still typing.
		// Do not replace their in-progress input with the new mask, or subsequent saves only
		// persist the suffix typed after that rerender.
		if (!isFocusedRef.current) {
			setLocalValue(initialValue)
		}
	}, [initialValue])

	useDebounceEffect(
		() => {
			onChange(localValue)
		},
		100,
		[localValue],
	)

	return (
		<div>
			<VSCodeTextField
				onBlur={() => {
					isFocusedRef.current = false
				}}
				onFocus={() => {
					isFocusedRef.current = true
				}}
				onInput={(e: any) => setLocalValue(e.target.value)}
				placeholder={placeholder}
				required={true}
				style={{ width: "100%" }}
				type="password"
				value={localValue}>
				<span style={{ fontWeight: 500 }}>{label}</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{helpText || "This key is stored locally and only used to make API requests from this extension."}
				{!localValue && signupUrl && (
					<VSCodeLink
						href={signupUrl}
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a{/^[aeiou]/i.test(providerName) ? "n" : ""} {providerName} API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}
