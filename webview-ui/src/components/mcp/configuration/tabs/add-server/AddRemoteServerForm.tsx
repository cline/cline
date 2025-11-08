import { EmptyRequest } from "@shared/proto/cline/common"
import { AddRemoteMcpServerRequest, McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { LINKS } from "@/constants"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const { t } = useTranslation()
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const [showConnectingMessage, setShowConnectingMessage] = useState(false)
	const { setMcpServers } = useExtensionState()

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!serverName.trim()) {
			setError(t("mcp.add_remote.server_name_required", "Server name is required"))
			return
		}

		if (!serverUrl.trim()) {
			setError(t("mcp.add_remote.server_url_required", "Server URL is required"))
			return
		}

		try {
			new URL(serverUrl)
		} catch (_err) {
			setError(t("mcp.add_remote.invalid_url_format", "Invalid URL format"))
			return
		}

		setError("")
		setIsSubmitting(true)
		setShowConnectingMessage(true)

		try {
			const servers: McpServers = await McpServiceClient.addRemoteMcpServer(
				AddRemoteMcpServerRequest.create({
					serverName: serverName.trim(),
					serverUrl: serverUrl.trim(),
				}),
			)

			setIsSubmitting(false)

			const mcpServers = convertProtoMcpServersToMcpServers(servers.mcpServers)
			setMcpServers(mcpServers)

			setServerName("")
			setServerUrl("")
			onServerAdded()
			setShowConnectingMessage(false)
		} catch (error) {
			setIsSubmitting(false)
			setError(error instanceof Error ? error.message : t("mcp.add_remote.failed_to_add_server", "Failed to add server"))
			setShowConnectingMessage(false)
		}
	}

	return (
		<div className="p-4 px-5">
			<div className="text-(--vscode-foreground) mb-2">
				{t("mcp.add_remote.description", "Add a remote MCP server by providing a name and its URL endpoint. Learn more")}{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					{t("mcp.add_remote.learn_more", "here.")}
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
						{t("mcp.add_remote.server_name", "Server Name")}
					</VSCodeTextField>
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
						{t("mcp.add_remote.server_url", "Server URL")}
					</VSCodeTextField>
				</div>

				{error && <div className="mb-3 text-(--vscode-errorForeground)">{error}</div>}

				<div className="flex items-center mt-3 w-full">
					<VSCodeButton className="w-full" disabled={isSubmitting} type="submit">
						{isSubmitting ? t("mcp.add_remote.adding", "Adding...") : t("mcp.add_remote.add_server", "Add Server")}
					</VSCodeButton>

					{showConnectingMessage && (
						<div className="ml-3 text-(--vscode-notificationsInfoIcon-foreground) text-sm">
							{t("mcp.add_remote.connecting", "Connecting to server... This may take a few seconds.")}
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
					{t("mcp.add_remote.edit_configuration", "Edit Configuration")}
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
