import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useDebouncedInput } from "../utils/useDebouncedInput"

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
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key
 */
export const ApiKeyField = ({ initialValue, onChange, providerName, signupUrl, placeholder, helpText }: ApiKeyFieldProps) => {
	const [localValue, setLocalValue] = useDebouncedInput(initialValue, onChange)
	const { t } = useTranslation("common")

	return (
		<div>
			<VSCodeTextField
				onInput={(e: any) => setLocalValue(e.target.value)}
				placeholder={placeholder || t("api_provider.common.api_key_placeholder")}
				required={true}
				style={{ width: "100%" }}
				type="password"
				value={localValue}>
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.api_key_label", { providerName })}</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{helpText || t("api_provider.common.api_key_help_text")}
				{!localValue && signupUrl && (
					<VSCodeLink
						href={signupUrl}
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						{t("api_provider.common.api_key_signup_text", {
							providerName,
							article: /^[aeiou]/i.test(providerName) ? "n" : "",
						})}
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}
