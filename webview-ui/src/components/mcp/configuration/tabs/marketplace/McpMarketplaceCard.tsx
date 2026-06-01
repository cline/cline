import { McpMarketplaceItem, McpServer } from "@shared/mcp"
import { MarketplaceStarRequest, StringRequest } from "@shared/proto/cline/common"
import { useEffect, useMemo, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

interface McpMarketplaceCardProps {
	item: McpMarketplaceItem
	installedServers: McpServer[]
	setError: (error: string | null) => void
	onRecognitionChange?: (mcpId: string, starred: boolean, aiHydroStars: number) => void
}

const McpMarketplaceCard = ({ item, installedServers, setError, onRecognitionChange }: McpMarketplaceCardProps) => {
	const isInstalled = installedServers.some((server) => server.name === item.mcpId)
	const [isDownloading, setIsDownloading] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [isStarring, setIsStarring] = useState(false)
	const [starred, setStarred] = useState(item.starredByClient)
	const [aiHydroInstalls, setAiHydroInstalls] = useState(item.aiHydroInstalls || 0)
	const [aiHydroStars, setAiHydroStars] = useState(item.aiHydroStars)
	const { onRelinquishControl } = useExtensionState()

	useEffect(() => {
		return onRelinquishControl(() => {
			setIsLoading(false)
		})
	}, [onRelinquishControl])

	const githubAuthorUrl = useMemo(() => {
		if (item.authorUrl) {
			return item.authorUrl
		}
		const url = new URL(item.githubUrl)
		const pathParts = url.pathname.split("/")
		if (pathParts.length >= 2) {
			return `${url.origin}/${pathParts[1]}`
		}
		return item.githubUrl
	}, [item.authorUrl, item.githubUrl])

	const handleStar = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (isStarring) {
			return
		}
		const nextStarred = !starred
		setIsStarring(true)
		setError(null)
		try {
			const response = await McpServiceClient.starMcp(
				MarketplaceStarRequest.create({
					marketplace: "mcp",
					itemId: item.mcpId,
					starred: nextStarred,
				}),
			)
			if (response.error) {
				setError(response.error)
				return
			}
			setStarred(response.starred)
			setAiHydroStars(response.aiHydroStars)
			onRecognitionChange?.(item.mcpId, response.starred, response.aiHydroStars)
		} catch (error) {
			setError(error instanceof Error ? error.message : "AI-Hydro star update failed")
		} finally {
			setIsStarring(false)
		}
	}

	return (
		<>
			<style>
				{`
					.mcp-card {
						cursor: pointer;
						outline: none !important;
					}
					.mcp-card:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.mcp-card:focus {
						outline: none !important;
					}
				`}
			</style>
			<a
				className="mcp-card"
				href={item.githubUrl}
				style={{
					padding: "14px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 12,
					cursor: isLoading ? "wait" : "pointer",
					textDecoration: "none",
					color: "inherit",
				}}>
				{/* Main container with logo and content */}
				<div style={{ display: "flex", gap: "12px" }}>
					{/* Logo */}
					{item.logoUrl && (
						<img
							alt={`${item.name} logo`}
							src={item.logoUrl}
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
							<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
								<h3
									style={{
										margin: 0,
										fontSize: "13px",
										fontWeight: 600,
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}>
									{item.name}
								</h3>
							</div>
							<div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
								<button
									aria-label={starred ? "Remove your AI-Hydro star" : "Star this MCP server in AI-Hydro"}
									disabled={isStarring}
									onClick={handleStar}
									style={{
										background: starred ? "rgba(250, 204, 21, 0.16)" : "transparent",
										border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.16))",
										borderRadius: 4,
										color: starred ? "#facc15" : "var(--vscode-descriptionForeground)",
										cursor: isStarring ? "wait" : "pointer",
										fontSize: 13,
										lineHeight: 1,
										padding: "4px 7px",
									}}
									title={starred ? "Remove your AI-Hydro star" : "Star this MCP server in AI-Hydro"}
									type="button">
									{starred ? "★" : "☆"}
								</button>
								<div
									onClick={async (e) => {
										e.preventDefault() // Prevent card click when clicking install
										e.stopPropagation() // Stop event from bubbling up to parent link
										if (!isInstalled && !isDownloading) {
											setIsDownloading(true)
											try {
												const response = await McpServiceClient.downloadMcp(
													StringRequest.create({ value: item.mcpId }),
												)
												if (response.error) {
													console.error("MCP download failed:", response.error)
													setError(response.error)
												} else {
													console.log("MCP download successful:", response)
													// Clear any previous errors on success
													setError(null)
													setAiHydroInstalls((current) => current + 1)
												}
											} catch (error) {
												console.error("Failed to download MCP:", error)
											} finally {
												setIsDownloading(false)
											}
										}
									}}
									style={{}}>
									<StyledInstallButton $isInstalled={isInstalled} disabled={isInstalled || isDownloading}>
										{isInstalled ? "Installed" : isDownloading ? "Installing..." : "Install"}
									</StyledInstallButton>
								</div>
							</div>
						</div>

						{/* Second row: metadata */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								flexWrap: "wrap",
								minWidth: 0,
								rowGap: 0,
							}}>
							<span
								style={{
									display: "flex",
									alignItems: "center",
									color: "var(--vscode-foreground)",
									gap: "4px",
									minWidth: 0,
									opacity: 0.7,
								}}>
								<span className="codicon codicon-organization" style={{ fontSize: "14px" }} />
								<span
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										wordBreak: "break-all",
										minWidth: 0,
									}}>
									by {item.author}
								</span>
							</span>
							<a
								href={githubAuthorUrl}
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									window.open(githubAuthorUrl, "_blank", "noopener,noreferrer")
								}}
								rel="noopener noreferrer"
								style={{
									color: "var(--vscode-textLink-foreground, #06b6d4)",
									flexShrink: 0,
									fontSize: "11px",
									textDecoration: "none",
								}}
								target="_blank">
								Profile ↗
							</a>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
								}}
								title="AI-Hydro installs">
								<span className="codicon codicon-cloud-download" />
								<span style={{ wordBreak: "break-all" }}>
									{aiHydroInstalls.toLocaleString()} AI-Hydro installs
								</span>
							</div>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "4px",
									minWidth: 0,
									flexShrink: 0,
									color: starred ? "#facc15" : "var(--vscode-descriptionForeground)",
								}}
								title="AI-Hydro user stars">
								<span style={{ lineHeight: 1 }}>{starred ? "★" : "☆"}</span>
								<span style={{ wordBreak: "break-all" }}>{aiHydroStars.toLocaleString()} AI-Hydro stars</span>
							</div>
							{item.githubStars > 0 && (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "4px",
										minWidth: 0,
										flexShrink: 0,
									}}
									title="GitHub stars">
									<span className="codicon codicon-star-full" />
									<span style={{ wordBreak: "break-all" }}>
										{item.githubStars.toLocaleString()} GitHub stars
									</span>
								</div>
							)}
							{item.downloadCount > 0 && (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "4px",
										minWidth: 0,
										flexShrink: 0,
									}}
									title="Catalog-maintained download count">
									<span className="codicon codicon-archive" />
									<span style={{ wordBreak: "break-all" }}>
										{item.downloadCount.toLocaleString()} catalog downloads
									</span>
								</div>
							)}
							{item.requiresApiKey && (
								<span className="codicon codicon-key" style={{ flexShrink: 0 }} title="Requires API key" />
							)}
						</div>
					</div>
				</div>

				{/* Description and tags */}
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<p style={{ fontSize: "13px", margin: 0 }}>{item.description}</p>
					<div
						onScroll={(e) => {
							const target = e.currentTarget
							const gradient = target.querySelector(".tags-gradient") as HTMLElement
							if (gradient) {
								gradient.style.visibility = target.scrollLeft > 0 ? "hidden" : "visible"
							}
						}}
						style={{
							display: "flex",
							gap: "6px",
							flexWrap: "nowrap",
							overflowX: "auto",
							scrollbarWidth: "none",
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
							className="tags-gradient"
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
				{item.citationUrl && (
					<a
						href={item.citationUrl}
						onClick={(e) => e.stopPropagation()}
						rel="noopener noreferrer"
						style={{
							fontSize: "10px",
							color: "var(--vscode-textLink-foreground, #06b6d4)",
							textDecoration: "none",
							width: "fit-content",
						}}
						target="_blank">
						Cite ↗
					</a>
				)}
			</a>
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
