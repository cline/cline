import type { ClineAskUseMcpServer } from "@shared/ExtensionMessage"
import PlanModeAccessCheckbox from "@/components/mcp/configuration/tabs/installed/server-row/PlanModeAccessCheckbox"

const DocsLink = () => (
	<a
		className="text-(--vscode-textLink-foreground) underline hover:no-underline"
		href="https://docs.cline.bot/core-workflows/plan-and-act#mcp-tools-in-plan-mode"
		rel="noopener noreferrer"
		target="_blank">
		Learn more
	</a>
)

/**
 * Explains an MCP tool call that Plan mode treated differently from Act mode:
 * why the user is asked, with the way to stop being asked when there is one,
 * or why the call ran without asking.
 */
const McpPlanModeNotice = ({ useMcpServer }: { useMcpServer: ClineAskUseMcpServer }) => {
	if (useMcpServer.planMode === "ask" && useMcpServer.toolName) {
		return (
			<div className="mt-2 flex flex-col gap-1 text-xs" data-testid="plan-mode-ask" onClick={(e) => e.stopPropagation()}>
				<div className="text-description">
					Plan mode asks because the server does not mark this tool read-only. <DocsLink />
				</div>
				<PlanModeAccessCheckbox serverName={useMcpServer.serverName} toolName={useMcpServer.toolName}>
					Always allow in Plan mode
				</PlanModeAccessCheckbox>
				<PlanModeAccessCheckbox serverName={useMcpServer.serverName}>
					Always allow all tools from {useMcpServer.serverName} in Plan mode
				</PlanModeAccessCheckbox>
			</div>
		)
	}
	if (useMcpServer.planMode === "ask_unlisted") {
		return (
			<div className="mt-2 text-xs text-description" data-testid="plan-mode-ask-unlisted">
				Plan mode asks because the server no longer lists this tool. <DocsLink />
			</div>
		)
	}
	if (useMcpServer.planMode === "read_only") {
		return (
			<div className="mt-2 text-xs text-description" data-testid="plan-mode-read-only-note">
				Auto-approved in Plan mode because the server marks this tool read-only. <DocsLink />
			</div>
		)
	}
	return null
}

export default McpPlanModeNotice
