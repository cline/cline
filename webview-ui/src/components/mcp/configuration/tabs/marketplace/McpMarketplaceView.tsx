import { EmptyRequest } from "@shared/proto/cline/common"
import {
	VSCodeButton,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeProgressRing,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import McpMarketplaceCard from "./McpMarketplaceCard"
import McpSubmitCard from "./McpSubmitCard"

const McpMarketplaceView = () => {
	const { mcpServers, mcpMarketplaceCatalog, setMcpMarketplaceCatalog, remoteConfigSettings } = useExtensionState()

	const showMarketplace = remoteConfigSettings?.mcpMarketplaceEnabled !== false
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"newest" | "stars" | "name" | "downloadCount">("newest")

	const items = mcpMarketplaceCatalog?.items || []

	const categories = useMemo(() => {
		const uniqueCategories = new Set(items.map((item) => item.category))
		return Array.from(uniqueCategories).sort()
	}, [items])

	const filteredItems = useMemo(() => {
		return items
			.filter((item) => {
				const matchesSearch =
					searchQuery === "" ||
					item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
					item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
					item.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
				const matchesCategory = !selectedCategory || item.category === selectedCategory
				return matchesSearch && matchesCategory
			})
			.sort((a, b) => {
				switch (sortBy) {
					case "downloadCount":
						return b.downloadCount - a.downloadCount
					case "stars":
						return b.githubStars - a.githubStars
					case "name":
						return a.name.localeCompare(b.name)
					case "newest":
						return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
					default:
						return 0
				}
			})
	}, [items, searchQuery, selectedCategory, sortBy])

	useEffect(() => {
		// Fetch marketplace catalog on initial load
		fetchMarketplace()
	}, [])

	useEffect(() => {
		// Update loading state when catalog arrives
		if (mcpMarketplaceCatalog?.items) {
			setIsLoading(false)
			setIsRefreshing(false)
			setError(null)
		}
	}, [mcpMarketplaceCatalog])

	const fetchMarketplace = (forceRefresh: boolean = false) => {
		if (forceRefresh) {
			setIsRefreshing(true)
		} else {
			setIsLoading(true)
		}
		setError(null)

		if (showMarketplace) {
			McpServiceClient.refreshMcpMarketplace(EmptyRequest.create({}))
				.then((response) => {
					setMcpMarketplaceCatalog(response)
				})
				.catch((error) => {
					console.error("Error refreshing MCP marketplace:", error)
					setError("Failed to load marketplace data")
					setIsLoading(false)
					setIsRefreshing(false)
				})
		}
	}

	if (isLoading || isRefreshing) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "100%",
					padding: "20px",
				}}>
				<VSCodeProgressRing />
			</div>
		)
	}

	if (error) {
		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
					height: "100%",
					padding: "20px",
					gap: "12px",
				}}>
				<div style={{ color: "var(--vscode-errorForeground)" }}>{error}</div>
				<VSCodeButton appearance="secondary" onClick={() => fetchMarketplace(true)}>
					<span className="codicon codicon-refresh" style={{ marginRight: "6px" }} />
					Retry
				</VSCodeButton>
			</div>
		)
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
			}}>
			<div style={{ padding: "20px 20px 5px", display: "flex", flexDirection: "column", gap: "16px" }}>
				{/* Search row */}
				<VSCodeTextField
					onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
					placeholder="Search MCPs..."
					style={{ width: "100%" }}
					value={searchQuery}>
					<div
						className="codicon codicon-search"
						slot="start"
						style={{
							fontSize: 13,
							opacity: 0.8,
						}}
					/>
					{searchQuery && (
						<div
							aria-label="Clear search"
							className="codicon codicon-close"
							onClick={() => setSearchQuery("")}
							slot="end"
							style={{
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								height: "100%",
								cursor: "pointer",
							}}
						/>
					)}
				</VSCodeTextField>

				{/* Filter row */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
					}}>
					<span
						style={{
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							textTransform: "uppercase",
							fontWeight: 500,
							flexShrink: 0,
						}}>
						Filter:
					</span>
					<div
						style={{
							position: "relative",
							zIndex: 2,
							flex: 1,
						}}>
						<VSCodeDropdown
							onChange={(e) => setSelectedCategory((e.target as HTMLSelectElement).value || null)}
							style={{
								width: "100%",
							}}
							value={selectedCategory || ""}>
							<VSCodeOption value="">All Categories</VSCodeOption>
							{categories.map((category) => (
								<VSCodeOption key={category} value={category}>
									{category}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				</div>

				{/* Sort row */}
				<div
					style={{
						display: "flex",
						gap: "8px",
					}}>
					<span
						style={{
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							textTransform: "uppercase",
							fontWeight: 500,
							marginTop: "3px",
						}}>
						Sort:
					</span>
					<VSCodeRadioGroup
						onChange={(e) => setSortBy((e.target as HTMLInputElement).value as typeof sortBy)}
						style={{
							display: "flex",
							flexWrap: "wrap",
							marginTop: "-2.5px",
						}}
						value={sortBy}>
						<VSCodeRadio value="downloadCount">Most Installs</VSCodeRadio>
						<VSCodeRadio value="newest">Newest</VSCodeRadio>
						<VSCodeRadio value="stars">GitHub Stars</VSCodeRadio>
						<VSCodeRadio value="name">Name</VSCodeRadio>
					</VSCodeRadioGroup>
				</div>
			</div>

			<style>
				{`
				.mcp-search-input,
				.mcp-select {
				box-sizing: border-box;
				}
				.mcp-search-input {
				min-width: 140px;
				}
				.mcp-search-input:focus,
				.mcp-select:focus {
				border-color: var(--vscode-focusBorder) !important;
				}
				.mcp-search-input:hover,
				.mcp-select:hover {
				opacity: 0.9;
				}
			`}
			</style>

			{/* Remote config banner */}
			{remoteConfigSettings?.allowedMCPServers && (
				<div className="flex items-center gap-2 px-5 py-3 mx-5 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
					<i className="codicon codicon-lock text-sm" />
					<span className="text-[13px]">Your organization has pre-configured the available MCP servers</span>
				</div>
			)}

			<div style={{ display: "flex", flexDirection: "column" }}>
				{filteredItems.length === 0 ? (
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							height: "100%",
							padding: "20px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{searchQuery || selectedCategory
							? "No matching MCP servers found"
							: "No MCP servers found in the marketplace"}
					</div>
				) : (
					filteredItems.map((item) => (
						<McpMarketplaceCard installedServers={mcpServers} item={item} key={item.mcpId} setError={setError} />
					))
				)}
				<McpSubmitCard />
			</div>
		</div>
	)
}

export default McpMarketplaceView
