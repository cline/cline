import { LINKS } from "@/constants"
import { McpServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

type AddLocalServerFormProps = {
	onServerAdded: () => void
}

const AddLocalServerForm = ({ onServerAdded }: AddLocalServerFormProps) => {
	return (
		<FormContainer>
			<div className="text-[var(--vscode-foreground)]">
				Add a local MCP server by configuring it in <code>cline_mcp_settings.json</code>. You'll need to specify the
				server name, command, arguments, and any required environment variables in the JSON configuration. Learn more
				<VSCodeLink href={LINKS.DOCUMENTATION.LOCAL_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					here.
				</VSCodeLink>
			</div>

			<VSCodeButton
				appearance="primary"
				style={{ width: "100%", marginBottom: "5px", marginTop: 8 }}
				onClick={() => {
					McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
						console.error("Error opening MCP settings:", error)
					})
				}}>
				Open cline_mcp_settings.json
			</VSCodeButton>
		</FormContainer>
	)
}

const FormContainer = styled.div`
	padding: 16px 20px;
	display: flex;
	flex-direction: column;
	gap: 8px;
`

export default AddLocalServerForm
