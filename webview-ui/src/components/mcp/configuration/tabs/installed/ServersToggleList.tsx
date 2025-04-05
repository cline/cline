import { McpServer } from "@shared/mcp"
import ServerRow from "./server-row/ServerRow"

const ServersToggleList = ({ servers }: { servers: McpServer[] }) => {
	return servers.length > 0 ? (
		<div className="flex flex-col gap-2.5">
			{servers.map((server) => (
				<ServerRow key={server.name} server={server} />
			))}
		</div>
	) : (
		<div className="flex flex-col items-center gap-3 my-5 text-[var(--vscode-descriptionForeground)]">
			No MCP servers installed
		</div>
	)
}

export default ServersToggleList
