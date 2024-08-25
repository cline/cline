import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { ApiConfiguration } from "../../../src/shared/api"
import { validateApiConfiguration } from "../utils/validate"
import { vscode } from "../utils/vscode"
import ApiOptions from "./ApiOptions"
import { getKoduSignInUrl } from "../../../src/shared/kodu"

interface WelcomeViewProps {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
	vscodeUriScheme?: string
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ apiConfiguration, setApiConfiguration, vscodeUriScheme }) => {
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, padding: "0 20px" }}>
			<h2>Hi, I'm Claude Dev</h2>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in{" "}
				<VSCodeLink
					href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
					style={{ display: "inline" }}>
					Claude 3.5 Sonnet's agentic coding capabilities
				</VSCodeLink>{" "}
				and access to tools that let me create & edit files, explore complex projects, and execute terminal
				commands (with your permission, of course).
			</p>

			<b>To get started, this extension needs an API provider for Claude 3.5 Sonnet.</b>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
					color: "var(--vscode-editor-foreground)",
					padding: "6px 8px",
					borderRadius: "3px",
					margin: "8px 0px",
					fontSize: "12px",
				}}>
				<i
					className="codicon codicon-info"
					style={{
						marginRight: "6px",
						fontSize: "16px",
						color: "var(--vscode-infoIcon-foreground)",
					}}></i>
				<span>
					Explore Claude's capabilities with $10 free credits from{" "}
					<VSCodeLink href={getKoduSignInUrl(vscodeUriScheme)} style={{ display: "inline" }}>
						Kodu
					</VSCodeLink>
				</span>
			</div>

			<div style={{ marginTop: "10px" }}>
				<ApiOptions
					apiConfiguration={apiConfiguration}
					setApiConfiguration={setApiConfiguration}
					showModelOptions={false}
					vscodeUriScheme={vscodeUriScheme}
				/>
				{apiConfiguration?.apiProvider !== "kodu" && (
					<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
						Let's go!
					</VSCodeButton>
				)}
			</div>
		</div>
	)
}

export default WelcomeView
