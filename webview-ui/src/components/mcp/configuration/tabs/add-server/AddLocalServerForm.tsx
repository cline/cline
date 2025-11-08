import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import styled from "styled-components"
import { LINKS } from "@/constants"
import { McpServiceClient } from "@/services/grpc-client"

type AddLocalServerFormProps = {
	onServerAdded: () => void
}

const AddLocalServerForm = ({}: AddLocalServerFormProps) => {
	const { t } = useTranslation()

	return (
		<FormContainer>
			<div className="text-(--vscode-foreground)">
				{t(
					"mcp.add_local.description",
					"Add a local MCP server by configuring it in {{fileName}}. You'll need to specify the server name, command, arguments, and any required environment variables in the JSON configuration. Learn more",
					{ fileName: "cline_mcp_settings.json" },
				)}
				<VSCodeLink href={LINKS.DOCUMENTATION.LOCAL_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					{t("mcp.add_local.learn_more", "here.")}
				</VSCodeLink>
			</div>

			<VSCodeButton
				appearance="primary"
				onClick={() => {
					McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
						console.error("Error opening MCP settings:", error)
					})
				}}
				style={{ width: "100%", marginBottom: "5px", marginTop: 8 }}>
				{t("mcp.add_local.open_settings", "Open cline_mcp_settings.json")}
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
