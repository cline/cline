import { useEffect, useMemo, useState } from "react"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { McpMarketplaceItem } from "../../../../../src/shared/mcp"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"
import McpMarketplaceCard from "./McpMarketplaceCard"

const searchInputStyles = {
	width: "100%",
	padding: "4px 8px 4px 28px",
	background: "var(--vscode-input-background)",
	border: "1px solid var(--vscode-input-border)",
	color: "var(--vscode-input-foreground)",
	borderRadius: "2px",
	outline: "none",
	transition: "border-color 0.1s ease-in-out, opacity 0.1s ease-in-out",
}

const selectStyles = {
	padding: "4px 8px",
	background: "var(--vscode-dropdown-background)",
	border: "1px solid var(--vscode-dropdown-border)",
	color: "var(--vscode-dropdown-foreground)",
	borderRadius: "2px",
	outline: "none",
	transition: "border-color 0.1s ease-in-out, opacity 0.1s ease-in-out",
}

const McpMarketplaceView = () => {
	const { mcpServers } = useExtensionState()
	const [items, setItems] = useState<McpMarketplaceItem[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"downloadCount" | "stars" | "name">("downloadCount")

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
					default:
						return 0
				}
			})
	}, [items, searchQuery, selectedCategory, sortBy])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcpMarketplaceCatalog") {
				if (message.error) {
					setError(message.error)
				} else {
					setItems(message.mcpMarketplaceCatalog?.items || [])
					setError(null)
				}
				setIsLoading(false)
				setIsRefreshing(false)
			} else if (message.type === "mcpDownloadDetails") {
				if (message.error) {
					setError(message.error)
				}
			}
		}

		window.addEventListener("message", handleMessage)

		// Fetch marketplace catalog
		fetchMarketplace()

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const fetchMarketplace = (forceRefresh: boolean = false) => {
		if (forceRefresh) {
			setIsRefreshing(true)
		} else {
			setIsLoading(true)
		}
		setError(null)
		vscode.postMessage({ type: "fetchMcpMarketplace", bool: forceRefresh })
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
		<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "16px",
					gap: "16px",
				}}>
				<div style={{ display: "flex", gap: "8px", alignItems: "center", flex: 1 }}>
					<div style={{ position: "relative", flex: 1 }}>
						<input
							type="text"
							placeholder="Search MCPs..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="mcp-search-input"
							style={searchInputStyles}
						/>
						<span
							className="codicon codicon-search"
							style={{
								position: "absolute",
								left: "8px",
								top: "50%",
								transform: "translateY(-50%)",
								color: "var(--vscode-input-placeholderForeground)",
							}}
						/>
					</div>
					<select
						value={selectedCategory || ""}
						onChange={(e) => setSelectedCategory(e.target.value || null)}
						className="mcp-select"
						style={selectStyles}>
						<option value="">All Categories</option>
						{categories.map((category) => (
							<option key={category} value={category}>
								{category}
							</option>
						))}
					</select>
					<select
						value={sortBy}
						onChange={(e) => setSortBy(e.target.value as "downloadCount" | "stars" | "name")}
						className="mcp-select"
						style={selectStyles}>
						<option value="downloadCount">Sort by Downloads</option>
						<option value="stars">Sort by Stars</option>
						<option value="name">Sort by Name</option>
					</select>
				</div>
				<VSCodeButton appearance="secondary" onClick={() => fetchMarketplace(true)} disabled={isRefreshing}>
					<span className="codicon codicon-refresh" style={{ marginRight: "6px" }} />
					Refresh
				</VSCodeButton>
			</div>
			<style>
				{`
					.mcp-search-input:focus {
						border-color: var(--vscode-focusBorder) !important;
					}
					.mcp-search-input:hover {
						opacity: 0.9;
					}
					.mcp-select:focus {
						border-color: var(--vscode-focusBorder) !important;
					}
					.mcp-select:hover {
						opacity: 0.9;
					}
				`}
			</style>
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
				filteredItems.map((item) => <McpMarketplaceCard key={item.mcpId} item={item} installedServers={mcpServers} />)
			)}
		</div>
	)
}

export default McpMarketplaceView
