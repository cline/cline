import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
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
	approveReadFile: boolean
	setApproveReadFile: React.Dispatch<React.SetStateAction<boolean>>
	approveListFilesTopLevel: boolean
	setApproveListFilesTopLevel: React.Dispatch<React.SetStateAction<boolean>>
	approveListFilesRecursively: boolean
	setApproveListFilesRecursively: React.Dispatch<React.SetStateAction<boolean>>
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
	approveReadFile,
	setApproveReadFile,
	approveListFilesTopLevel,
	setApproveListFilesTopLevel,
	approveListFilesRecursively,
	setApproveListFilesRecursively,
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
			vscode.postMessage({ type: "approveReadFile", value: approveReadFile })
			vscode.postMessage({ type: "approveListFilesTopLevel", value: approveListFilesTopLevel })
			vscode.postMessage({ type: "approveListFilesRecursively", value: approveListFilesRecursively })
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
	}, [apiConfiguration])

	useEffect(() => {
		setMaxRequestsErrorMessage(undefined)
	}, [maxRequestsPerTask])

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
					paddingRight: 17,
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

				<div style={{ marginTop: 15 }}>
					<h4 style={{ marginBottom: 10 }}>File Operation Approvals</h4>
					<VSCodeCheckbox
						checked={approveReadFile}
						onChange={() => setApproveReadFile(!approveReadFile)}
					>
						Approve read_file operations
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={approveListFilesTopLevel}
						onChange={() => setApproveListFilesTopLevel(!approveListFilesTopLevel)}
					>
						Approve list_files_top_level operations
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={approveListFilesRecursively}
						onChange={() => setApproveListFilesRecursively(!approveListFilesRecursively)}
					>
						Approve list_files_recursively operations
					</VSCodeCheckbox>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						When unchecked, the corresponding tool runs without user approval.
					</p>
				</div>
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