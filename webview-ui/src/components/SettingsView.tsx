import { ApiConfiguration } from "@shared/api"
import { VSCodeButton, VSCodeDivider, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { validateApiConfiguration, validateMaxRequestsPerTask } from "../utils/validate"
import { vscode } from "../utils/vscode"
import ApiOptions from "./ApiOptions"

type SettingsViewProps = {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
	maxRequestsPerTask: string
	setMaxRequestsPerTask: React.Dispatch<React.SetStateAction<string>>
	onDone: () => void
}

const SettingsView = ({
	apiConfiguration,
	setApiConfiguration,
	maxRequestsPerTask,
	setMaxRequestsPerTask,
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
		<div style={{ margin: "0 auto", paddingTop: "10px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Settings</h3>
				<VSCodeButton onClick={handleSubmit}>Done</VSCodeButton>
			</div>

			<div style={{ marginBottom: 5 }}>
				<ApiOptions apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
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

			<div style={{ marginBottom: "20px" }}>
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
					If Claude Dev reaches this limit, it will pause and ask for your permission before making additional
					requests.
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

			<VSCodeDivider />

			<div
				style={{
					marginTop: "20px",
					textAlign: "center",
					color: "var(--vscode-descriptionForeground)",
					fontSize: "12px",
					lineHeight: "1.2",
				}}>
				<p style={{ wordWrap: "break-word" }}>
					If you have any questions or feedback, feel free to open an issue at{" "}
					<VSCodeLink href="https://github.com/saoudrizwan/claude-dev" style={{ display: "inline" }}>
						https://github.com/saoudrizwan/claude-dev
					</VSCodeLink>
				</p>
				<p style={{ fontStyle: "italic" }}>v1.0.99</p>
			</div>
		</div>
	)
}

export default SettingsView
