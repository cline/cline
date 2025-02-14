import { useEffect, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { McpMarketplaceItem, McpServer } from "../../../../../src/shared/mcp"
import { vscode } from "../../../utils/vscode"

interface McpMarketplaceCardProps {
	item: McpMarketplaceItem
	installedServers: McpServer[]
}

const McpMarketplaceCard = ({ item, installedServers }: McpMarketplaceCardProps) => {
	const isInstalled = installedServers.some((server) => {
		try {
			const config = JSON.parse(server.config)
			const serverConfig = config.mcpServers[server.name]
			// Extract GitHub URL from args if it's an npm package
			const githubUrl = serverConfig.args?.find((arg: string) => arg.includes("github.com"))
			return githubUrl?.includes(item.mcpId) || githubUrl?.includes(item.githubUrl)
		} catch {
			return false
		}
	})
	const [isDownloading, setIsDownloading] = useState(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcpDownloadDetails") {
				setIsDownloading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return (
		<div
			style={{
				background: "var(--vscode-textCodeBlock-background)",
				borderRadius: "4px",
				padding: "16px",
				display: "flex",
				flexDirection: "column",
				gap: "12px",
			}}>
			<div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
				{item.logoUrl && (
					<img
						src={item.logoUrl}
						alt={`${item.name} logo`}
						style={{
							width: "48px",
							height: "48px",
							borderRadius: "4px",
						}}
					/>
				)}
				<div style={{ flex: 1 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
						<div>
							<h3 style={{ margin: 0, fontSize: "16px" }}>{item.name}</h3>
							<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>by {item.author}</div>
						</div>
						<VSCodeButton
							appearance={isInstalled ? "secondary" : "primary"}
							disabled={isInstalled || isDownloading}
							onClick={() => {
								if (!isInstalled && !isDownloading) {
									setIsDownloading(true)
									vscode.postMessage({
										type: "downloadMcp",
										mcpId: item.mcpId,
									})
								}
							}}>
							<span
								className={`codicon codicon-${isInstalled ? "check" : isDownloading ? "sync codicon-modifier-spin" : "cloud-download"}`}
								style={{ marginRight: "6px" }}
							/>
							{isInstalled ? "Installed" : isDownloading ? "Downloading..." : "Download"}
						</VSCodeButton>
					</div>
					<p style={{ margin: "8px 0", fontSize: "13px" }}>{item.description}</p>
					<div
						style={{
							display: "flex",
							gap: "16px",
							fontSize: "12px",
							color: "var(--vscode-descriptionForeground)",
							alignItems: "center",
						}}>
						<VSCodeButton
							appearance="icon"
							onClick={() => vscode.postMessage({ type: "openFile", text: item.githubUrl })}
							title="View on GitHub">
							<span className="codicon codicon-github" />
						</VSCodeButton>
						<div style={{ display: "flex", alignItems: "center", gap: "4px", marginRight: "8px" }}>
							<span className="codicon codicon-star-full" />
							{item.githubStars?.toLocaleString() ?? 0}
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<span className="codicon codicon-cloud-download" />
							{item.downloadCount?.toLocaleString() ?? 0}
						</div>
						{item.requiresApiKey && (
							<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<span className="codicon codicon-key" title="Requires API key" />
							</div>
						)}
						{item.isRecommended && (
							<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<span className="codicon codicon-verified" title="Recommended" />
							</div>
						)}
					</div>
					<div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
						<span
							style={{
								fontSize: "11px",
								padding: "2px 6px",
								borderRadius: "4px",
								background: "var(--vscode-charts-blue)",
								color: "var(--vscode-foreground)",
							}}>
							{item.category}
						</span>
						{item.tags.map((tag) => (
							<span
								key={tag}
								style={{
									fontSize: "11px",
									padding: "2px 6px",
									borderRadius: "4px",
									background: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}>
								{tag}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}

export default McpMarketplaceCard
