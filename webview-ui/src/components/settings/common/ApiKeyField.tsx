import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

/**
 * Props for the ApiKeyField component
 */
interface ApiKeyFieldProps {
	value: string
	onChange: (e: any) => void
	providerName: string
	signupUrl?: string
	placeholder?: string
	helpText?: string
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key
 */
export const ApiKeyField = ({
	value,
	onChange,
	providerName,
	signupUrl,
	placeholder = "Enter API Key...",
	helpText,
}: ApiKeyFieldProps) => (
	<div>
		<VSCodeTextField value={value} style={{ width: "100%" }} type="password" onInput={onChange} placeholder={placeholder}>
			<span style={{ fontWeight: 500 }}>{providerName} API Key</span>
		</VSCodeTextField>
		<p
			style={{
				fontSize: "12px",
				marginTop: 3,
				color: "var(--vscode-descriptionForeground)",
			}}>
			{helpText || "This key is stored locally and only used to make API requests from this extension."}
			{!value && signupUrl && (
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
