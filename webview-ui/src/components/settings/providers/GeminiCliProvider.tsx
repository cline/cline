import { ApiConfiguration } from "@shared/api"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"

interface GeminiCliProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

const GeminiCliProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: GeminiCliProviderProps) => {
	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.geminiCliOAuthPath || ""}
				style={{ width: "100%", marginTop: 3 }}
				type="text"
				onInput={handleInputChange("geminiCliOAuthPath")}
				placeholder="Default: ~/.gemini/oauth_creds.json">
				<span style={{ fontWeight: 500 }}>OAuth Credentials Path (optional)</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Path to the OAuth credentials file. Leave empty to use the default location (~/.gemini/oauth_creds.json).
			</p>

			{apiConfiguration?.geminiCliProjectId && (
				<>
					<VSCodeTextField
						value={apiConfiguration.geminiCliProjectId}
						style={{ width: "100%", marginTop: 3 }}
						type="text"
						disabled>
						<span style={{ fontWeight: 500 }}>Discovered Project ID</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						This project ID was automatically discovered from your OAuth credentials.
					</p>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 5,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This provider uses OAuth authentication from the Gemini CLI tool. If you haven't authenticated yet, please run{" "}
				<code
					style={{
						backgroundColor: "var(--vscode-textCodeBlock-background)",
						padding: "2px 4px",
						borderRadius: "3px",
					}}>
					gemini auth
				</code>{" "}
				in your terminal first.{" "}
				<VSCodeLink
					href="https://github.com/google/generative-ai-python/tree/main/gemini-cli"
					style={{ display: "inline", fontSize: "inherit" }}>
					Learn more about Gemini CLI
				</VSCodeLink>
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: 5,
					color: "var(--vscode-charts-green)",
					fontWeight: 500,
				}}>
				✓ Free tier access with gemini-2.5-flash model
			</p>
		</div>
	)
}

export default memo(GeminiCliProvider)
