import { useEffect, useMemo, useState } from "react"
import {
	VSCodeButton,
	VSCodeProgressRing,
	VSCodeRadioGroup,
	VSCodeRadio,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import { McpMarketplaceItem } from "@shared/mcp"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import McpMarketplaceCard from "./McpMarketplaceCard"
import McpSubmitCard from "./McpSubmitCard"
const McpMarketplaceView = () => {
	const { mcpServers, mcpMarketplaceCatalog } = useExtensionState()
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"newest" | "stars" | "name" | "downloadCount">("downloadCount")

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
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcpDownloadDetails") {
				if (message.error) {
					setError(message.error)
				}
			}
		}

		window.addEventListener("message", handleMessage)

		// Fetch marketplace catalog on initial load
		fetchMarketplace()

		return () => {
			window.removeEventListener("message", handleMessage)
		}
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
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
			}}>
			<div style={{ padding: "20px 20px 5px", display: "flex", flexDirection: "column", gap: "16px" }}>
				{/* Search row */}
				<VSCodeTextField
					style={{ width: "100%" }}
					placeholder="Search MCPs..."
					value={searchQuery}
					onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}>
					<div
						slot="start"
						className="codicon codicon-search"
						style={{
							fontSize: 13,
							opacity: 0.8,
						}}
					/>
					{searchQuery && (
						<div
							className="codicon codicon-close"
							aria-label="Clear search"
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
							style={{
								width: "100%",
							}}
							value={selectedCategory || ""}
							onChange={(e) => setSelectedCategory((e.target as HTMLSelectElement).value || null)}>
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
						style={{
							display: "flex",
							flexWrap: "wrap",
							marginTop: "-2.5px",
						}}
						value={sortBy}
						onChange={(e) => setSortBy((e.target as HTMLInputElement).value as typeof sortBy)}>
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
					filteredItems.map((item) => <McpMarketplaceCard key={item.mcpId} item={item} installedServers={mcpServers} />)
				)}
				<McpSubmitCard />
			</div>
		</div>
	)
}

export default McpMarketplaceView
