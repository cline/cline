import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { CSSProperties, useCallback, useEffect, useState, useRef } from "react"
import styled from "styled-components"
import { McpMarketplaceItem, McpServer } from "../../../../../src/shared/mcp"
import { vscode } from "../../../utils/vscode"
import { useEvent } from "react-use"

interface McpMarketplaceCardProps {
	item: McpMarketplaceItem
	installedServers: McpServer[]
}

const McpMarketplaceCard = ({ item, installedServers }: McpMarketplaceCardProps) => {
	const isInstalled = installedServers.some((server) => server.name === item.mcpId)
	const [isDownloading, setIsDownloading] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const githubLinkRef = useRef<HTMLDivElement>(null)

	const handleMessage = useCallback((event: MessageEvent) => {
		const message = event.data
		switch (message.type) {
			case "mcpDownloadDetails":
				setIsDownloading(false)
				break
			case "relinquishControl":
				setIsLoading(false)
				break
		}
	}, [])

	useEvent("message", handleMessage)

	return (
		<>
			<style>
				{`
					.mcp-card {
						cursor: pointer;
					}
					.mcp-card:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					vscode-link::part(control) {
						text-decoration: none !important;
						border: none !important;
					}
					vscode-link:hover::part(control) {
						color: var(--link-active-foreground);
						text-decoration: none !important;
						border: none !important;
					}
				`}
			</style>
			<div
				className="mcp-card"
				onClick={(e) => {
					if (githubLinkRef.current?.contains(e.target as Node)) {
						return
					}

					console.log("Card clicked:", item.mcpId)
					setIsLoading(true)
					vscode.postMessage({
						type: "openMcpMarketplaceServerDetails",
						mcpId: item.mcpId,
					})
				}}
				style={{
					padding: "16px 20px",
					display: "flex",
					flexDirection: "column",
					gap: 16,
					cursor: isLoading ? "wait" : "pointer",
				}}>
				{/* Main container with logo and content */}
				<div style={{ display: "flex", gap: "16px" }}>
					{/* Logo */}
					{item.logoUrl && (
						<img
							src={item.logoUrl}
							alt={`${item.name} logo`}
							style={{
								width: 42,
								height: 42,
								borderRadius: 4,
							}}
						/>
					)}

					{/* Content section */}
					<div
						style={{
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							justifyContent: "space-between",
						}}>
						{/* First row: name and install button */}
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "16px",
							}}>
							<h3
								style={{
									margin: 0,
									fontSize: "13px",
									fontWeight: 600,
								}}>
								{item.name}
							</h3>
							<div
								onClick={(e) => {
									e.stopPropagation() // Prevent card click when clicking install
									if (!isInstalled && !isDownloading) {
										setIsDownloading(true)
										vscode.postMessage({
											type: "downloadMcp",
											mcpId: item.mcpId,
										})
									}
								}}
								style={{}}>
								<StyledInstallButton disabled={isInstalled || isDownloading} $isInstalled={isInstalled}>
									{isInstalled ? "Installed" : isDownloading ? "Installing..." : "Install"}
								</StyledInstallButton>
							</div>
						</div>

						{/* Second row: metadata */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								flexWrap: "wrap",
								minWidth: 0,
							}}>
							<VSCodeLink
								href={item.githubUrl}
								title="View on GitHub"
								style={{
									display: "flex",
									alignItems: "center",
									color: "var(--vscode-foreground)",
									minWidth: 0,
									opacity: 0.5,
									textDecoration: "none",
									border: "none !important",
								}}
								className="github-link"
								onMouseEnter={(e) => {
									e.currentTarget.style.opacity = "0.8"
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.opacity = "0.5"
								}}>
								<div style={{ display: "flex", gap: "4px", alignItems: "center" }} ref={githubLinkRef}>
									<span className="codicon codicon-github" style={{ fontSize: "14px" }} />
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											wordBreak: "break-all",
											minWidth: 0,
										}}>
										{item.author}
									</span>
								</div>
							</VSCodeLink>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
								}}>
								<span className="codicon codicon-star-full" />
								<span style={{ wordBreak: "break-all" }}>{item.githubStars?.toLocaleString() ?? 0}</span>
							</div>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
								}}>
								<span className="codicon codicon-cloud-download" />
								<span style={{ wordBreak: "break-all" }}>{item.downloadCount?.toLocaleString() ?? 0}</span>
							</div>
							{item.requiresApiKey && (
								<span className="codicon codicon-key" title="Requires API key" style={{ flexShrink: 0 }} />
							)}
							{item.isRecommended && (
								<span className="codicon codicon-verified" title="Recommended" style={{ flexShrink: 0 }} />
							)}
						</div>
					</div>
				</div>

				{/* Description and tags */}
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					<p style={{ fontSize: "13px", margin: 0 }}>{item.description}</p>
					<div
						style={{
							display: "flex",
							gap: "6px",
							flexWrap: "nowrap",
							overflow: "hidden",
							position: "relative",
						}}>
						<span
							style={{
								fontSize: "10px",
								padding: "1px 4px",
								borderRadius: "3px",
								border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 50%, transparent)",
								color: "var(--vscode-descriptionForeground)",
								whiteSpace: "nowrap",
							}}>
							{item.category}
						</span>
						{item.tags.map((tag, index) => (
							<span
								key={tag}
								style={{
									fontSize: "10px",
									padding: "1px 4px",
									borderRadius: "3px",
									border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 50%, transparent)",
									color: "var(--vscode-descriptionForeground)",
									whiteSpace: "nowrap",
									display: "inline-flex",
								}}>
								{tag}
								{index === item.tags.length - 1 ? "" : ""}
							</span>
						))}
						<div
							style={{
								position: "absolute",
								right: 0,
								top: 0,
								bottom: 0,
								width: "32px",
								background: "linear-gradient(to right, transparent, var(--vscode-sideBar-background))",
								pointerEvents: "none",
							}}
						/>
					</div>
				</div>
			</div>
		</>
	)
}

const StyledInstallButton = styled.button<{ $isInstalled?: boolean }>`
	font-size: 12px;
	font-weight: 500;
	padding: 2px 6px;
	border-radius: 2px;
	border: none;
	cursor: pointer;
	background: ${(props) =>
		props.$isInstalled ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)"};
	color: var(--vscode-button-foreground);

	&:hover:not(:disabled) {
		background: ${(props) =>
			props.$isInstalled ? "var(--vscode-button-secondaryHoverBackground)" : "var(--vscode-button-hoverBackground)"};
	}

	&:active:not(:disabled) {
		background: ${(props) =>
			props.$isInstalled ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)"};
		opacity: 0.7;
	}

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}
`

export default McpMarketplaceCard
