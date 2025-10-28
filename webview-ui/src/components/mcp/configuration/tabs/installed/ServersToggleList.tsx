import { McpServer } from "@shared/mcp"
import ServerRow from "./server-row/ServerRow"

const ServersToggleList = ({
	servers,
	isExpandable,
	hasTrashIcon,
	listGap = "medium",
}: {
	servers: McpServer[]
	isExpandable: boolean
	hasTrashIcon: boolean
	listGap?: "small" | "medium" | "large"
}) => {
	const gapClasses = {
		small: "gap-0",
		medium: "gap-2.5",
		large: "gap-5",
	}

	const gapClass = gapClasses[listGap]

	return servers.length > 0 ? (
		<div className={`flex flex-col ${gapClass}`}>
			{servers.map((server) => (
				<ServerRow hasTrashIcon={hasTrashIcon} isExpandable={isExpandable} key={server.name} server={server} />
			))}
		</div>
	) : (
		<div className="flex flex-col items-center gap-3 my-5 text-(--vscode-descriptionForeground)">
			No MCP servers installed
		</div>
	)
}

export default ServersToggleList
