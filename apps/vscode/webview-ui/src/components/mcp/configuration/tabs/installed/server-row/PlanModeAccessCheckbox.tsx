import { SetPlanModeAccessRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { type FormEvent, type ReactNode, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

type PlanModeAccessCheckboxProps = {
	serverName: string
	/** The tool to allow. Omit it to allow every tool of the server. */
	toolName?: string
	children: ReactNode
}

/**
 * Allows an MCP tool, or a whole server, in Plan mode. Without it Plan mode
 * hides tools the server declares as modifying and asks before tools with no
 * read-only hint. The saved value is read back from the server list, so the
 * MCP tab and an open approval card always agree.
 */
const PlanModeAccessCheckbox = ({ serverName, toolName, children }: PlanModeAccessCheckboxProps) => {
	const { mcpServers, setMcpServers } = useExtensionState()
	const server = mcpServers.find((entry) => entry.name === serverName)
	const wholeServerAllowed = server?.allowAllInPlanMode === true
	const checked =
		wholeServerAllowed ||
		(toolName !== undefined && server?.tools?.find((tool) => tool.name === toolName)?.allowInPlanMode === true)

	// The toolkit checkbox also fires its change event when `checked` is set
	// from here, for instance on every tool once the whole server is allowed.
	// Only a change that differs from the saved value is the user's.
	const savedValue = useRef(checked)
	savedValue.current = checked
	// The box is locked until a save is answered, so each change is made against the saved value.
	const [saving, setSaving] = useState(false)

	const handleChange = (event: Event | FormEvent<HTMLElement>) => {
		const allowed = (event.target as HTMLInputElement).checked
		if (saving || allowed === savedValue.current) {
			return
		}
		setSaving(true)
		McpServiceClient.setPlanModeAccess(
			SetPlanModeAccessRequest.create({
				serverName,
				toolNames: toolName === undefined ? [] : [toolName],
				allowed,
				wholeServer: toolName === undefined,
			}),
		)
			.then((response) => setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers)))
			.catch((error) => console.error("Error changing Plan mode access", error))
			.finally(() => setSaving(false))
	}

	return (
		<VSCodeCheckbox
			checked={checked}
			data-testid={toolName === undefined ? "plan-mode-access-server" : "plan-mode-access-tool"}
			// A tool cannot be taken out of a server-wide allow.
			disabled={saving || (toolName !== undefined && wholeServerAllowed)}
			onChange={handleChange}
			style={{ fontSize: "11px" }}
			title="Use in Plan mode under the same approval rules as in Act mode.">
			{children}
		</VSCodeCheckbox>
	)
}

export default PlanModeAccessCheckbox
