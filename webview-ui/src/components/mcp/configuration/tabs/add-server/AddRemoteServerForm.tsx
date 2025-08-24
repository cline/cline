import { EmptyRequest } from "@shared/proto/cline/common"
import { AddRemoteMcpServerRequest, McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton, VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { LINKS } from "@/constants"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [transportType, setTransportType] = useState<"streamableHttp" | "sse">("streamableHttp")
	const [authHeader, setAuthHeader] = useState("")
	const [timeoutSeconds, setTimeoutSeconds] = useState<string>("")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const [showConnectingMessage, setShowConnectingMessage] = useState(false)
	const { setMcpServers } = useExtensionState()

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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
		} catch (_err) {
			setError("Invalid URL format")
			return
		}

		setError("")
		setIsSubmitting(true)
		setShowConnectingMessage(true)

		try {
			const headers = authHeader.trim() ? { Authorization: authHeader.trim() } : undefined
			const timeout = timeoutSeconds.trim() ? Number(timeoutSeconds.trim()) : undefined

			const servers: McpServers = await McpServiceClient.addRemoteMcpServer(
				AddRemoteMcpServerRequest.create({
					serverName: serverName.trim(),
					serverUrl: serverUrl.trim(),
					transportType,
					headers,
					timeout,
				}),
			)

			setIsSubmitting(false)

			const mcpServers = convertProtoMcpServersToMcpServers(servers.mcpServers)
			setMcpServers(mcpServers)

			setServerName("")
			setServerUrl("")
			setAuthHeader("")
			setTimeoutSeconds("")
			setTransportType("streamableHttp")
			onServerAdded()
			setShowConnectingMessage(false)
		} catch (error) {
			setIsSubmitting(false)
			setError(error instanceof Error ? error.message : "Failed to add server")
			setShowConnectingMessage(false)
		}
	}

	return (
		<div className="p-4 px-5">
			<div className="text-[var(--vscode-foreground)] mb-2">
				Add a remote MCP server by providing a name, transport, and URL endpoint. Learn more{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					here.
				</VSCodeLink>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="mb-2">
					<VSCodeTextField
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerName((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="mcp-server"
						value={serverName}>
						Server Name
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<label className="block mb-1 text-[var(--vscode-foreground)]">Transport</label>
					<VSCodeDropdown
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							const val = (e.target as HTMLSelectElement).value as "streamableHttp" | "sse"
							setTransportType(val)
							setError("")
						}}
						value={transportType}>
						<VSCodeOption value="streamableHttp">Streamable HTTP (recommended)</VSCodeOption>
						<VSCodeOption value="sse">SSE</VSCodeOption>
					</VSCodeDropdown>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						className="w-full mr-4"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerUrl((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="https://example.com/mcp-server"
						value={serverUrl}>
						Server URL
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							setAuthHeader((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="Bearer <token>"
						value={authHeader}>
						Authorization Header (optional)
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							setTimeoutSeconds((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder="60"
						value={timeoutSeconds}>
						Timeout (seconds, optional)
					</VSCodeTextField>
				</div>

				{error && <div className="mb-3 text-[var(--vscode-errorForeground)]">{error}</div>}

				<div className="flex items-center mt-3 w-full">
					<VSCodeButton className="w-full" disabled={isSubmitting} type="submit">
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
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px", marginTop: 15 }}>
					Edit Configuration
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
