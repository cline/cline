import { VSCodeButton, VSCodeLink, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { ApiConfiguration } from "../../../src/shared/api"
import { validateApiConfiguration, validateMaxRequestsPerTask } from "../utils/validate"
import { vscode } from "../utils/vscode"
import ApiOptions from "./ApiOptions"

type SettingsViewProps = {
	version: string
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
	maxRequestsPerTask: string
	setMaxRequestsPerTask: React.Dispatch<React.SetStateAction<string>>
	customInstructions: string
	setCustomInstructions: React.Dispatch<React.SetStateAction<string>>
	onDone: () => void
}

const SettingsView = ({
	version,
	apiConfiguration,
	setApiConfiguration,
	maxRequestsPerTask,
	setMaxRequestsPerTask,
	customInstructions,
	setCustomInstructions,
	onDone,
}: SettingsViewProps) => {
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [maxRequestsErrorMessage, setMaxRequestsErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = () => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const maxRequestsValidationResult = validateMaxRequestsPerTask(maxRequestsPerTask)

		setApiErrorMessage(apiValidationResult)
		setMaxRequestsErrorMessage(maxRequestsValidationResult)

		if (!apiValidationResult && !maxRequestsValidationResult) {
			vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			vscode.postMessage({ type: "maxRequestsPerTask", text: maxRequestsPerTask })
			vscode.postMessage({ type: "customInstructions", text: customInstructions })
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
	}, [apiConfiguration])

	useEffect(() => {
		setMaxRequestsErrorMessage(undefined)
	}, [maxRequestsPerTask])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. so trying to use useEffect with a dependency array of only one value for example will use any other variables' old values. In most cases you don't want this, and should opt to use react-use hooks.
	
	useEffect(() => {
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])

	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "10px 0px 0px 20px",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
					paddingRight: 18,
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Settings</h3>
				<VSCodeButton onClick={handleSubmit}>Done</VSCodeButton>
			</div>
			<div
				style={{ flexGrow: 1, overflowY: "scroll", paddingRight: 8, display: "flex", flexDirection: "column" }}>
				<div style={{ marginBottom: 5 }}>
					<ApiOptions
						apiConfiguration={apiConfiguration}
						setApiConfiguration={setApiConfiguration}
						showModelOptions={true}
					/>
					{apiErrorMessage && (
						<p
							style={{
								margin: "-5px 0 12px 0",
								fontSize: "12px",
								color: "var(--vscode-errorForeground)",
							}}>
							{apiErrorMessage}
						</p>
					)}
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeTextArea
						value={customInstructions}
						style={{ width: "100%" }}
						rows={4}
						placeholder={
							'e.g. "Run unit tests at the end", "Use TypeScript with async/await", "Speak in Spanish"'
						}
						onInput={(e: any) => setCustomInstructions(e.target?.value || "")}>
						<span style={{ fontWeight: "500" }}>Custom Instructions</span>
					</VSCodeTextArea>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						These instructions are added to the end of the system prompt sent with every request.
					</p>
				</div>

				<div>
					<VSCodeTextField
						value={maxRequestsPerTask}
						style={{ width: "100%" }}
						placeholder="20"
						onInput={(e: any) => setMaxRequestsPerTask(e.target?.value)}>
						<span style={{ fontWeight: "500" }}>Maximum # Requests Per Task</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						If Claude Dev reaches this limit, it will pause and ask for your permission before making
						additional requests.
					</p>
					{maxRequestsErrorMessage && (
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-errorForeground)",
							}}>
							{maxRequestsErrorMessage}
						</p>
					)}
				</div>

				<div
					style={{
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "12px",
						lineHeight: "1.2",
						marginTop: "auto",
						padding: "10px 8px 15px 0px",
					}}>
					<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
						If you have any questions or feedback, feel free to open an issue at{" "}
						<VSCodeLink href="https://github.com/saoudrizwan/claude-dev" style={{ display: "inline" }}>
							https://github.com/saoudrizwan/claude-dev
						</VSCodeLink>
					</p>
					<p style={{ fontStyle: "italic", margin: "10px 0 0 0", padding: 0 }}>v{version}</p>
				</div>
			</div>
		</div>
	)
}

export default SettingsView
