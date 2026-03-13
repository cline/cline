import type { PromptsCatalog } from "@shared/prompts"
import { ApplyPromptRequest, RemovePromptRequest } from "@shared/proto/cline/prompts"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { useEffect, useMemo, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { PromptsServiceClient } from "@/services/grpc-client"
import PromptsSubmitCard from "./PromptsSubmitCard"

type PromptsLibraryTabProps = {
	catalog: PromptsCatalog
}

const PromptsLibraryTab = ({ catalog }: PromptsLibraryTabProps) => {
	const [searchTerm, setSearchTerm] = useState("")
	const [typeFilter, setTypeFilter] = useState<"all" | "rule" | "workflow" | "hook" | "skill">("all")
	const [categoryFilter, setCategoryFilter] = useState("all")
	const [applyingPromptId, setApplyingPromptId] = useState<string | null>(null)
	const [removingPromptId, setRemovingPromptId] = useState<string | null>(null)
	const [appliedPrompts, setAppliedPrompts] = useState<Set<string>>(new Set())
	const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set())
	const [toastMessage, setToastMessage] = useState<{
		message: string
		type: "success" | "error"
	} | null>(null)

	// Extract unique categories from catalog
	const categories = useMemo(() => {
		const cats = new Set<string>()
		catalog.items.forEach((item) => {
			if (item.category) {
				cats.add(item.category)
			}
		})
		return Array.from(cats).sort()
	}, [catalog.items])

	// Set up Fuse.js for fuzzy search
	const fuse = useMemo(() => {
		return new Fuse(catalog.items, {
			keys: ["name", "description", "author", "category", "tags"],
			threshold: 0.4,
			shouldSort: true,
			isCaseSensitive: false,
		})
	}, [catalog.items])

	// Filter and search prompts
	const filteredPrompts = useMemo(() => {
		let results = catalog.items

		// Apply type filter
		if (typeFilter !== "all") {
			results = results.filter((item) => item.type === typeFilter)
		}

		// Apply category filter
		if (categoryFilter !== "all") {
			results = results.filter((item) => item.category === categoryFilter)
		}

		// Apply search
		if (searchTerm) {
			const searchResults = fuse.search(searchTerm)
			const searchIds = new Set(searchResults.map((r) => r.item.promptId))
			results = results.filter((item) => searchIds.has(item.promptId))
		}

		return results
	}, [catalog.items, typeFilter, categoryFilter, searchTerm, fuse])

	// Show toast notification
	const showToast = (message: string, type: "success" | "error") => {
		setToastMessage({ message, type })
	}

	const promptTypeToProto = (type: string): number => {
		switch (type) {
			case "rule":
				return 1
			case "workflow":
				return 2
			case "hook":
				return 3
			case "skill":
				return 4
			default:
				return 1
		}
	}

	const promptTypeToDirectory = (type: string): string => {
		switch (type) {
			case "rule":
				return ".clinerules"
			case "workflow":
				return ".clinerules/workflows"
			case "hook":
				return ".clinerules/hooks"
			case "skill":
				return ".clinerules/skills"
			default:
				return ".clinerules"
		}
	}

	const handleApplyPrompt = async (compositeId: string, promptId: string, type: string, content: string, name: string) => {
		setApplyingPromptId(compositeId)
		try {
			const request = ApplyPromptRequest.create({
				promptId,
				type: promptTypeToProto(type),
				content,
				name,
			})

			const result = await PromptsServiceClient.applyPrompt(request)

			if (result.value) {
				setAppliedPrompts((prev) => new Set(prev).add(`${type}:${promptId}`))
				showToast(`✓ "${name}" added to ${promptTypeToDirectory(type)}/`, "success")
			} else {
				showToast(`✗ Failed to apply "${name}"`, "error")
			}
		} catch (error) {
			console.error("Error applying prompt:", error)
			showToast(`✗ Error applying prompt: ${error}`, "error")
		} finally {
			setApplyingPromptId(null)
		}
	}

	const handleRemovePrompt = async (compositeId: string, promptId: string, type: string, name: string) => {
		setRemovingPromptId(compositeId)
		try {
			const request = RemovePromptRequest.create({
				promptId,
				type: promptTypeToProto(type),
				name,
			})

			const result = await PromptsServiceClient.removePrompt(request)

			if (result.value) {
				setAppliedPrompts((prev) => {
					const newSet = new Set(prev)
					newSet.delete(`${type}:${promptId}`)
					return newSet
				})
				showToast(`✓ "${name}" removed`, "success")
			} else {
				showToast(`✗ Failed to remove "${name}"`, "error")
			}
		} catch (error) {
			console.error("Error removing prompt:", error)
			showToast(`✗ Error removing prompt: ${error}`, "error")
		} finally {
			setRemovingPromptId(null)
		}
	}

	const handleToggle = (
		compositeId: string,
		promptId: string,
		type: string,
		content: string,
		name: string,
		isCurrentlyApplied: boolean,
	) => {
		if (isCurrentlyApplied) {
			handleRemovePrompt(compositeId, promptId, type, name)
		} else {
			handleApplyPrompt(compositeId, promptId, type, content, name)
		}
	}

	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString)
			const month = String(date.getMonth() + 1).padStart(2, "0")
			const day = String(date.getDate()).padStart(2, "0")
			const year = date.getFullYear()
			return `${month}.${day}.${year}`
		} catch {
			return dateString
		}
	}

	// Auto-hide toast after 5 seconds
	useEffect(() => {
		if (toastMessage) {
			const timer = setTimeout(() => setToastMessage(null), 5000)
			return () => clearTimeout(timer)
		}
	}, [toastMessage])

	// Fetch applied prompts on mount
	useEffect(() => {
		const fetchAppliedPrompts = async () => {
			try {
				const result = await PromptsServiceClient.getAppliedPrompts({})
				if (result.values) {
					setAppliedPrompts(new Set(result.values))
				}
			} catch (error) {
				console.error("Error fetching applied prompts:", error)
			}
		}
		fetchAppliedPrompts()
	}, [])

	if (!catalog.items || catalog.items.length === 0) {
		// If lastUpdated is set, the fetch completed but returned no items (error or empty repo)
		if (catalog.lastUpdated) {
			return (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						justifyContent: "center",
						alignItems: "center",
						padding: "40px 20px",
						color: "var(--vscode-descriptionForeground)",
						textAlign: "center",
						gap: "8px",
					}}>
					<span className="codicon codicon-warning" style={{ fontSize: "24px" }} />
					<p style={{ margin: 0 }}>Unable to load prompts catalog.</p>
					<p style={{ margin: 0, fontSize: "12px" }}>
						This may be due to GitHub API rate limiting. Please try again later.
					</p>
				</div>
			)
		}
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					padding: "40px 20px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				<VSCodeProgressRing />
			</div>
		)
	}

	return (
		<div style={{ padding: "20px", position: "relative" }}>
			{/* Toast Notification */}
			{toastMessage && (
				<div
					style={{
						position: "fixed",
						top: "20px",
						right: "20px",
						padding: "12px 20px",
						borderRadius: "4px",
						backgroundColor:
							toastMessage.type === "success"
								? "var(--vscode-terminal-ansiGreen)"
								: "var(--vscode-errorForeground)",
						color: "var(--vscode-editor-background)",
						boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
						zIndex: 9999,
						maxWidth: "400px",
						fontSize: "13px",
						fontWeight: 500,
					}}>
					{toastMessage.message}
				</div>
			)}

			<div style={{ marginBottom: "0" }}>
				<h4 style={{ margin: "0 0 8px 0" }}>Community Prompts Library</h4>
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 16px 0" }}>
					{catalog.items.length} prompts available from the community
				</p>

				{/* Search Input */}
				<VSCodeTextField
					onInput={(e: any) => setSearchTerm(e.target?.value || "")}
					placeholder="Search prompts..."
					style={{ width: "100%", marginBottom: "12px" }}
					value={searchTerm}>
					<span
						className="codicon codicon-search"
						slot="start"
						style={{
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							height: "100%",
							fontSize: "14px",
							color: "var(--vscode-descriptionForeground)",
						}}
					/>
					{searchTerm && (
						<div
							className="input-icon-button codicon codicon-close"
							onClick={() => setSearchTerm("")}
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

				{/* Filters */}
				<div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
					<div style={{ flex: 1 }}>
						<label htmlFor="type-filter" style={{ fontSize: "12px", marginBottom: "4px", display: "block" }}>
							Type
						</label>
						<VSCodeDropdown
							id="type-filter"
							onChange={(e: any) => setTypeFilter(e.target.value)}
							style={{ width: "100%" }}
							value={typeFilter}>
							<VSCodeOption value="all">All Types</VSCodeOption>
							<VSCodeOption value="rule">Rules</VSCodeOption>
							<VSCodeOption value="workflow">Workflows</VSCodeOption>
							<VSCodeOption value="hook">Hooks</VSCodeOption>
							<VSCodeOption value="skill">Skills</VSCodeOption>
						</VSCodeDropdown>
					</div>

					<div style={{ flex: 1 }}>
						<label htmlFor="category-filter" style={{ fontSize: "12px", marginBottom: "4px", display: "block" }}>
							Category
						</label>
						<VSCodeDropdown
							id="category-filter"
							onChange={(e: any) => setCategoryFilter(e.target.value)}
							style={{ width: "100%" }}
							value={categoryFilter}>
							<VSCodeOption value="all">All Categories</VSCodeOption>
							{categories.map((cat) => (
								<VSCodeOption key={cat} value={cat}>
									{cat}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				</div>
			</div>

			{/* Dashed Separator */}
			<div
				style={{
					borderTop: "1px dashed var(--vscode-panel-border)",
					marginBottom: "20px",
				}}
			/>

			{/* Prompt List */}
			{filteredPrompts.length === 0 ? (
				<div
					style={{
						padding: "40px 20px",
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
					}}>
					<p>No prompts found matching your filters.</p>
					<VSCodeButton
						appearance="secondary"
						onClick={() => {
							setSearchTerm("")
							setTypeFilter("all")
							setCategoryFilter("all")
						}}
						style={{ marginTop: "12px" }}>
						Clear Filters
					</VSCodeButton>
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					{filteredPrompts.map((prompt) => {
						const compositeId = `${prompt.type}:${prompt.promptId}`
						const isApplied = appliedPrompts.has(compositeId)
						const isProcessing = applyingPromptId === compositeId || removingPromptId === compositeId
						const isExpanded = expandedPromptIds.has(compositeId)

						return (
							<div
								key={compositeId}
								style={{
									padding: "16px",
									border: "1px solid var(--vscode-panel-border)",
									borderRadius: "6px",
									transition: "background-color 0.2s, border-color 0.2s",
									backgroundColor: isApplied ? "var(--vscode-list-hoverBackground)" : "transparent",
								}}>
								{/* Header: Name + Toggle */}
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										gap: "12px",
										marginBottom: "4px",
									}}>
									<h5 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{prompt.name}</h5>
									<Switch
										checked={isApplied}
										disabled={isProcessing}
										onClick={() =>
											handleToggle(
												compositeId,
												prompt.promptId,
												prompt.type,
												prompt.content,
												prompt.name,
												isApplied,
											)
										}
										size="lg"
									/>
								</div>

								{/* Category with icon */}
								{prompt.category && (
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "4px",
											marginBottom: "10px",
											fontSize: "12px",
											color: "var(--vscode-descriptionForeground)",
										}}>
										<span className="codicon codicon-git-pull-request" style={{ fontSize: "12px" }} />
										{prompt.category}
									</div>
								)}

								{/* Description */}
								<p
									style={{
										margin: "0 0 12px 0",
										fontSize: "13px",
										color: "var(--vscode-foreground)",
										lineHeight: "1.4",
									}}>
									{prompt.description}
								</p>

								{/* Footer: Type badge + Expand chevron */}
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
									}}>
									<span
										style={{
											fontSize: "11px",
											padding: "2px 8px",
											borderRadius: "3px",
											border: "1px solid var(--vscode-descriptionForeground)",
											color: "var(--vscode-descriptionForeground)",
										}}>
										{prompt.type.charAt(0).toUpperCase() + prompt.type.slice(1)}
									</span>
									<button
										onClick={() =>
											setExpandedPromptIds((prev) => {
												const next = new Set(prev)
												if (next.has(compositeId)) {
													next.delete(compositeId)
												} else {
													next.add(compositeId)
												}
												return next
											})
										}
										style={{
											background: "none",
											border: "none",
											cursor: "pointer",
											padding: "2px 4px",
											color: "var(--vscode-foreground)",
											display: "flex",
											alignItems: "center",
										}}
										title={isExpanded ? "Collapse details" : "Expand details"}>
										<span
											className={`codicon ${isExpanded ? "codicon-chevron-up" : "codicon-chevron-down"}`}
											style={{ fontSize: "14px" }}
										/>
									</button>
								</div>

								{/* Expandable Metadata Section */}
								{isExpanded && (
									<div
										style={{
											marginTop: "12px",
											border: "1px solid var(--vscode-descriptionForeground)",
											borderRadius: "4px",
											overflow: "hidden",
										}}>
										<table
											style={{
												width: "100%",
												borderCollapse: "collapse",
												fontSize: "12px",
											}}>
											<tbody>
												<tr>
													<td
														style={{
															padding: "8px 12px",
															color: "var(--vscode-descriptionForeground)",
														}}>
														Published by
													</td>
													<td
														style={{
															padding: "8px 12px",
															textAlign: "right",
															fontWeight: 600,
														}}>
														{prompt.author || "—"}
													</td>
												</tr>
												<tr>
													<td
														style={{
															padding: "8px 12px",
															color: "var(--vscode-descriptionForeground)",
														}}>
														Last updated
													</td>
													<td
														style={{
															padding: "8px 12px",
															textAlign: "right",
															fontWeight: 600,
														}}>
														{prompt.updatedAt ? formatDate(prompt.updatedAt) : "—"}
													</td>
												</tr>
												<tr>
													<td
														style={{
															padding: "8px 12px",
															color: "var(--vscode-descriptionForeground)",
														}}>
														Version
													</td>
													<td
														style={{
															padding: "8px 12px",
															textAlign: "right",
															fontWeight: 600,
														}}>
														{prompt.version || "—"}
													</td>
												</tr>
											</tbody>
										</table>
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			{/* Submit Prompts Card */}
			<PromptsSubmitCard />
		</div>
	)
}

export default PromptsLibraryTab
