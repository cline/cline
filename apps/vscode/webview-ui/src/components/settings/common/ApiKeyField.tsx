import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useRef, useState } from "react"
import { DebouncedTextField } from "./DebouncedTextField"

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

	return (
		<div>
			<DebouncedTextField
				initialValue={initialValue}
				onBlur={() => {
					isFocusedRef.current = false
				}}
				onChange={onChange}
				onFocus={() => {
					isFocusedRef.current = true
				}}
				onLocalValueChange={setLocalValue}
				placeholder={placeholder}
				required={true}
				shouldSyncInitialValue={() => !isFocusedRef.current}
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>{label}</span>
			</DebouncedTextField>
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
