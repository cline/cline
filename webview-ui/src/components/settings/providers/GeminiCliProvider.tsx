/**
 * Gemini CLI Provider Component
 *
 * This component integrates with Google's Gemini CLI tool for OAuth authentication.
 *
 * Attribution: This implementation is inspired by and uses concepts from the Google Gemini CLI,
 * which is licensed under the Apache License 2.0.
 * Original project: https://github.com/google-gemini/gemini-cli
 *
 * Copyright 2025 Google LLC
 * Licensed under the Apache License, Version 2.0
 */

import { ApiConfiguration, geminiCliModels } from "@shared/api"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

interface GeminiCliProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

const GeminiCliProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: GeminiCliProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)
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
				This provider uses OAuth authentication from the Gemini CLI tool and does not require API keys. If you haven't
				authenticated yet, please run{" "}
				<code
					style={{
						backgroundColor: "var(--vscode-textCodeBlock-background)",
						padding: "2px 4px",
						borderRadius: "3px",
					}}>
					gemini
				</code>{" "}
				in your terminal first.
				<br />
				<VSCodeLink
					href="https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quickstart"
					style={{ display: "inline", fontSize: "inherit" }}>
					Gemini CLI Setup Instructions
				</VSCodeLink>
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={geminiCliModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}

			<div
				style={{
					backgroundColor: "var(--vscode-editorWarning-background, rgba(255, 191, 0, 0.1))",
					padding: "8px",
					borderRadius: "4px",
					border: "1px solid var(--vscode-editorWarning-border, rgba(255, 191, 0, 0.3))",
					marginTop: "8px",
					marginBottom: "16px",
				}}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						marginBottom: "4px",
					}}>
					<i
						className="codicon codicon-info"
						style={{
							marginRight: "6px",
							fontSize: "14px",
							color: "#FFA500",
						}}></i>
					<span
						style={{
							fontWeight: "bold",
							color: "#FFA500",
							fontSize: "12px",
						}}>
						Important Requirements
					</span>
				</div>
				<p
					style={{
						margin: 0,
						fontSize: "11px",
						lineHeight: "1.4",
						color: "var(--vscode-foreground)",
					}}>
					• First, you need to install the <strong>Gemini CLI tool</strong>
					<br />• Then, run <strong>gemini</strong> in your terminal and make sure you{" "}
					<strong>Log in with Google</strong>
					<br />• Only works with <strong>personal Google accounts</strong> (not Google Workspace accounts)
					<br />
					• Does not use API keys - authentication is handled via OAuth
					<br />• Requires the Gemini CLI tool to be installed and authenticated first
				</p>
			</div>

			<p
				style={{
					fontSize: "12px",
					marginTop: 5,
					color: "var(--vscode-charts-green)",
					fontWeight: 500,
				}}>
				✓ Free tier access via OAuth authentication
			</p>
		</div>
	)
}

export default memo(GeminiCliProvider)
