import { EmptyRequest } from "@shared/proto/cline/common"
import type { LearningModuleCatalog } from "@shared/proto/cline/html_preview"
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
import { HtmlPreviewServiceClient } from "@/services/grpc-client"
import LearningModuleCard from "./LearningModuleCard"
import LearningModuleSubmitCard from "./LearningModuleSubmitCard"

const ModulesMarketplaceView = () => {
	const [catalog, setCatalog] = useState<LearningModuleCatalog | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"featured" | "popular" | "downloads" | "newest" | "name" | "level">("featured")

	const items = catalog?.items || []

	const topics = useMemo(() => {
		const uniqueTopics = new Set(items.map((item) => item.topic).filter(Boolean))
		return Array.from(uniqueTopics).sort()
	}, [items])

	const filteredItems = useMemo(() => {
		return items
			.filter((item) => {
				const matchesSearch =
					searchQuery === "" ||
					item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
					item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
					item.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
				const matchesTopic = !selectedTopic || item.topic === selectedTopic
				return matchesSearch && matchesTopic
			})
			.sort((a, b) => {
				switch (sortBy) {
					case "featured": {
						if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1
						return b.aiHydroStars - a.aiHydroStars || b.aiHydroInstalls - a.aiHydroInstalls
					}
					case "popular":
						return b.aiHydroStars - a.aiHydroStars
					case "downloads":
						return b.aiHydroInstalls - a.aiHydroInstalls
					case "name":
						return a.title.localeCompare(b.title)
					case "level": {
						const levelOrder: Record<string, number> = { intro: 0, beginner: 1, intermediate: 2, advanced: 3 }
						return (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99)
					}
					case "newest":
						return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
					default:
						return 0
				}
			})
	}, [items, searchQuery, selectedTopic, sortBy])

	useEffect(() => {
		fetchMarketplace()
	}, [])

	const fetchMarketplace = (forceRefresh: boolean = false) => {
		if (forceRefresh) {
			setIsRefreshing(true)
		} else {
			setIsLoading(true)
		}
		setError(null)

		HtmlPreviewServiceClient.refreshModulesMarketplace(EmptyRequest.create({}))
			.then((response) => {
				setCatalog(response)
				setIsLoading(false)
				setIsRefreshing(false)
			})
			.catch((err) => {
				console.error("Error refreshing modules marketplace:", err)
				setError("Failed to load modules marketplace data")
				setIsLoading(false)
				setIsRefreshing(false)
			})
	}

	const updateRecognition = (moduleId: string, starred: boolean, aiHydroStars: number) => {
		setCatalog((current) => {
			if (!current) return current
			return {
				...current,
				items: current.items.map((item) =>
					item.moduleId === moduleId ? { ...item, starredByClient: starred, aiHydroStars } : item,
				),
			}
		})
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
					placeholder="Search modules..."
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
						Topic:
					</span>
					<div style={{ position: "relative", zIndex: 2, flex: 1 }}>
						<VSCodeDropdown
							onChange={(e) => setSelectedTopic((e.target as HTMLSelectElement).value || null)}
							style={{ width: "100%" }}
							value={selectedTopic || ""}>
							<VSCodeOption value="">All Topics</VSCodeOption>
							{topics.map((topic) => (
								<VSCodeOption key={topic} value={topic}>
									{topic}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				</div>

				{/* Sort row */}
				<div style={{ display: "flex", gap: "8px" }}>
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
						<VSCodeRadio value="featured">Featured</VSCodeRadio>
						<VSCodeRadio value="popular">AI-Hydro Stars</VSCodeRadio>
						<VSCodeRadio value="downloads">AI-Hydro Installs</VSCodeRadio>
						<VSCodeRadio value="newest">Newest</VSCodeRadio>
						<VSCodeRadio value="name">Name</VSCodeRadio>
						<VSCodeRadio value="level">Level</VSCodeRadio>
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
							height: "100%",
							padding: "20px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{searchQuery || selectedTopic
							? "No matching modules found"
							: "No learning modules found in the marketplace"}
					</div>
				) : (
					filteredItems.map((item) => (
						<LearningModuleCard
							item={item}
							key={item.moduleId}
							onRecognitionChange={updateRecognition}
							setError={setError}
						/>
					))
				)}
				<LearningModuleSubmitCard />
			</div>
		</div>
	)
}

export default ModulesMarketplaceView
