import { EmptyRequest } from "@shared/proto/cline/common"
import type { SkillCatalog } from "@shared/proto/cline/skills"
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
import { SkillsServiceClient } from "@/services/grpc-client"
import SkillCard from "./SkillCard"
import SkillSubmitCard from "./SkillSubmitCard"

type SortOption = "featured" | "stars" | "downloads" | "newest" | "name"

const DOMAINS = ["frequency-analysis", "baseflow", "modelling", "interpretation", "general"] as const

const SkillsMarketplaceTab = () => {
	const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedDomain, setSelectedDomain] = useState<string>("")
	const [sortBy, setSortBy] = useState<SortOption>("featured")

	const items = catalog?.items ?? []

	const filteredItems = useMemo(() => {
		return items
			.filter((item) => {
				const q = searchQuery.toLowerCase()
				const matchesSearch =
					q === "" ||
					item.name.toLowerCase().includes(q) ||
					item.description.toLowerCase().includes(q) ||
					item.tags.some((tag) => tag.toLowerCase().includes(q))
				const matchesDomain = !selectedDomain || item.domain === selectedDomain
				return matchesSearch && matchesDomain
			})
			.sort((a, b) => {
				switch (sortBy) {
					case "featured":
						if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1
						return b.githubStars - a.githubStars
					case "stars":
						return b.githubStars - a.githubStars
					case "downloads":
						return b.downloadCount - a.downloadCount
					case "name":
						return a.name.localeCompare(b.name)
					case "newest":
						return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
					default:
						return 0
				}
			})
	}, [items, searchQuery, selectedDomain, sortBy])

	useEffect(() => {
		fetchMarketplace()
	}, [])

	const fetchMarketplace = () => {
		setIsLoading(true)
		setError(null)
		SkillsServiceClient.refreshSkillsMarketplace(EmptyRequest.create({}))
			.then((response) => {
				setCatalog(response)
				setIsLoading(false)
			})
			.catch((err) => {
				console.error("Error refreshing skills marketplace:", err)
				setError("Failed to load skills marketplace")
				setIsLoading(false)
			})
	}

	if (isLoading) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "100%",
					padding: 20,
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
					padding: 20,
					gap: 12,
				}}>
				<div style={{ color: "var(--vscode-errorForeground)" }}>{error}</div>
				<VSCodeButton appearance="secondary" onClick={fetchMarketplace}>
					<span className="codicon codicon-refresh" style={{ marginRight: 6 }} />
					Retry
				</VSCodeButton>
			</div>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
			<div style={{ padding: "20px 20px 5px", display: "flex", flexDirection: "column", gap: 16 }}>
				{/* Search */}
				<VSCodeTextField
					onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
					placeholder="Search skills..."
					style={{ width: "100%" }}
					value={searchQuery}>
					<div className="codicon codicon-search" slot="start" style={{ fontSize: 13, opacity: 0.8 }} />
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

				{/* Domain filter */}
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
							textTransform: "uppercase",
							fontWeight: 500,
							flexShrink: 0,
						}}>
						Domain:
					</span>
					<div style={{ position: "relative", zIndex: 2, flex: 1 }}>
						<VSCodeDropdown
							onChange={(e) => setSelectedDomain((e.target as HTMLSelectElement).value)}
							style={{ width: "100%" }}
							value={selectedDomain}>
							<VSCodeOption value="">All Domains</VSCodeOption>
							{DOMAINS.map((d) => (
								<VSCodeOption key={d} value={d}>
									{d}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				</div>

				{/* Sort */}
				<div style={{ display: "flex", gap: 8 }}>
					<span
						style={{
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
							textTransform: "uppercase",
							fontWeight: 500,
							marginTop: 3,
						}}>
						Sort:
					</span>
					<VSCodeRadioGroup
						onChange={(e) => setSortBy((e.target as HTMLInputElement).value as SortOption)}
						style={{ display: "flex", flexWrap: "wrap", marginTop: "-2.5px" }}
						value={sortBy}>
						<VSCodeRadio value="featured">Featured</VSCodeRadio>
						<VSCodeRadio value="stars">Stars</VSCodeRadio>
						<VSCodeRadio value="downloads">Downloads</VSCodeRadio>
						<VSCodeRadio value="newest">Newest</VSCodeRadio>
						<VSCodeRadio value="name">Name</VSCodeRadio>
					</VSCodeRadioGroup>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column" }}>
				{filteredItems.length === 0 ? (
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							padding: 20,
							color: "var(--vscode-descriptionForeground)",
						}}>
						{searchQuery || selectedDomain ? "No matching skills found" : "No skills found in the marketplace"}
					</div>
				) : (
					filteredItems.map((item) => <SkillCard item={item} key={item.skillId} setError={setError} />)
				)}
				<SkillSubmitCard />
			</div>
		</div>
	)
}

export default SkillsMarketplaceTab
