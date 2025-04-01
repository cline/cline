import { useCallback, useEffect, useRef, useState } from "react"
import { vscode } from "../../../utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEvent } from "react-use"

const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const [showConnectingMessage, setShowConnectingMessage] = useState(false)

	// Store submitted values to check if the server was added
	const submittedValues = useRef<{ name: string } | null>(null)

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data

			if (
				message.type === "addRemoteServerResult" &&
				isSubmitting &&
				submittedValues.current &&
				message.addRemoteServerResult?.serverName === submittedValues.current.name
			) {
				if (message.addRemoteServerResult.success) {
					// Handle success
					setIsSubmitting(false)
					setServerName("")
					setServerUrl("")
					submittedValues.current = null
					onServerAdded()
					setShowConnectingMessage(false)
				} else {
					// Handle error
					setIsSubmitting(false)
					setError(message.addRemoteServerResult.error || "Failed to add server")
					setShowConnectingMessage(false)
				}
			}
		},
		[isSubmitting, onServerAdded],
	)

	useEvent("message", handleMessage)

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!serverName.trim()) {
			setError("Server name is required")
			return
		}

		if (!serverUrl.trim()) {
			setError("Server URL is required")
			return
		}

		try {
			new URL(serverUrl)
		} catch (err) {
			setError("Invalid URL format")
			return
		}

		setError("")

		submittedValues.current = { name: serverName.trim() }

		setIsSubmitting(true)
		setShowConnectingMessage(true)
		vscode.postMessage({
			type: "addRemoteServer",
			serverName: serverName.trim(),
			serverUrl: serverUrl.trim(),
		})
	}

	return (
		<div className="p-4 px-5">
			<div className="text-[var(--vscode-foreground)] text-sm mb-4 mt-1 max-w-lg">
				Add a remote MCP server by providing a name and its URL endpoint.
			</div>

			<form onSubmit={handleSubmit}>
				{error && (
					<div className="text-[var(--vscode-testing-iconFailed)] mb-3 p-2 rounded bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)]">
						{error}
					</div>
				)}

				<div className="mb-4 mr-4">
					<label className="block mb-1">Server Name</label>
					<input
						type="text"
						value={serverName}
						onChange={(e) => {
							setServerName(e.target.value)
							setError("")
						}}
						disabled={isSubmitting}
						className="w-full max-w-md mr-4 p-2 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
					/>
				</div>

				<div className="mb-4 mr-4">
					<label className="block mb-1">Server URL</label>
					<input
						type="text"
						value={serverUrl}
						onChange={(e) => {
							setServerUrl(e.target.value)
							setError("")
						}}
						disabled={isSubmitting}
						placeholder="https://example.com/mcp-sse"
						className="w-full max-w-md mr-4 p-2 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
					/>
				</div>

				<div className="flex items-center mt-3">
					<VSCodeButton type="submit" disabled={isSubmitting}>
						{isSubmitting ? "Adding..." : "Add Server"}
					</VSCodeButton>

					{showConnectingMessage && (
						<div className="ml-3 text-[var(--vscode-notificationsInfoIcon-foreground)] text-sm">
							Connecting to server... This may take a few seconds.
						</div>
					)}
				</div>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
