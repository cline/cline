import { McpResource, McpResourceTemplate } from "@roo/shared/mcp"

type McpResourceRowProps = {
	item: McpResource | McpResourceTemplate
}

const McpResourceRow = ({ item }: McpResourceRowProps) => {
	const hasUri = "uri" in item
	const uri = hasUri ? item.uri : item.uriTemplate

	return (
		<div key={uri} className="py-[3px]">
			<div className="flex items-center mb-1">
				<span className={`codicon codicon-symbol-file mr-[6px]`} />
				<span className="font-medium break-all">{uri}</span>
			</div>
			<div className="text-xs opacity-80 my-1">
				{item.name && item.description
					? `${item.name}: ${item.description}`
					: !item.name && item.description
						? item.description
						: !item.description && item.name
							? item.name
							: "No description"}
			</div>
			<div className="text-xs">
				<span className="opacity-80">Returns </span>
				<code className="text-vscode-textPreformat-foreground bg-vscode-textPreformat-background px-1 py-[1px] rounded-[3px]">
					{item.mimeType || "Unknown"}
				</code>
			</div>
		</div>
	)
}

export default McpResourceRow
