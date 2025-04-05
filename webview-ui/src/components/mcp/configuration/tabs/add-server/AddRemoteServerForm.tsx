import { useCallback, useRef, useState } from "react"
import { vscode } from "@/utils/vscode"
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEvent } from "react-use"
import { LINKS } from "@/constants"
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
			<div className="text-[var(--vscode-foreground)] mb-2">
				Add a remote MCP server by providing a name and its URL endpoint. Learn more{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					here.
				</VSCodeLink>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="mb-2">
					<VSCodeTextField
						value={serverName}
						onChange={(e) => {
							setServerName((e.target as HTMLInputElement).value)
							setError("")
						}}
						disabled={isSubmitting}
						className="w-full"
						placeholder="mcp-server">
						Server Name
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						value={serverUrl}
						onChange={(e) => {
							setServerUrl((e.target as HTMLInputElement).value)
							setError("")
						}}
						disabled={isSubmitting}
						placeholder="https://example.com/mcp-server"
						className="w-full mr-4">
						Server URL
					</VSCodeTextField>
				</div>

				{error && <div className="mb-3 text-[var(--vscode-errorForeground)]">{error}</div>}

				<div className="flex items-center mt-3 w-full">
					<VSCodeButton type="submit" disabled={isSubmitting} className="w-full">
						{isSubmitting ? "Adding..." : "Add Server"}
					</VSCodeButton>

					{showConnectingMessage && (
						<div className="ml-3 text-[var(--vscode-notificationsInfoIcon-foreground)] text-sm">
							Connecting to server... This may take a few seconds.
						</div>
					)}
				</div>

				<VSCodeButton
					appearance="secondary"
					style={{ width: "100%", marginBottom: "5px", marginTop: 15 }}
					onClick={() => {
						vscode.postMessage({ type: "openMcpSettings" })
					}}>
					Edit Configuration
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
