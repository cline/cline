import { McpResource, McpResourceTemplate } from "../../../../src/shared/mcp"

type McpResourceRowProps = {
	item: McpResource | McpResourceTemplate
}

const McpResourceRow = ({ item }: McpResourceRowProps) => {
	const isTemplate = "uriTemplate" in item
	const uri = isTemplate ? item.uriTemplate : item.uri

	return (
		<div
			key={uri}
			style={{
				padding: "8px 0",
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					marginBottom: "4px",
				}}>
				<span
					className={`codicon codicon-symbol-${isTemplate ? "template" : "file"}`}
					style={{ marginRight: "6px" }}
				/>
				<span style={{ fontWeight: 500, wordBreak: "break-all" }}>{uri}</span>
			</div>
			<div
				style={{
					fontSize: "12px",
					opacity: 0.8,
					margin: "4px 0",
				}}>
				{item.name && item.description
					? `${item.name}: ${item.description}`
					: !item.name && item.description
						? item.description
						: !item.description && item.name
							? item.name
							: "No description"}
			</div>
			<div
				style={{
					fontSize: "12px",
				}}>
				<span style={{ opacity: 0.8 }}>Returns </span>
				<code
					style={{
						color: "var(--vscode-textPreformat-foreground)",
						background: "var(--vscode-textPreformat-background)",
						padding: "1px 4px",
						borderRadius: "3px",
					}}>
					{item.mimeType || "Unknown"}
				</code>
			</div>
		</div>
	)
}

export default McpResourceRow
