import type { PromptsCatalog } from "@shared/prompts"
import { ApplyPromptRequest, RemovePromptRequest } from "@shared/proto/cline/prompts"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { useEffect, useMemo, useState } from "react"
import { PromptsServiceClient } from "@/services/grpc-client"

type PromptsLibraryTabProps = {
	catalog: PromptsCatalog
}

const PromptsLibraryTab = ({ catalog }: PromptsLibraryTabProps) => {
	const [searchTerm, setSearchTerm] = useState("")
	const [typeFilter, setTypeFilter] = useState<"all" | "rule" | "workflow">("all")
	const [categoryFilter, setCategoryFilter] = useState("all")
	const [applyingPromptId, setApplyingPromptId] = useState<string | null>(null)
	const [removingPromptId, setRemovingPromptId] = useState<string | null>(null)
	const [appliedPrompts, setAppliedPrompts] = useState<Set<string>>(new Set())
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
		setTimeout(() => setToastMessage(null), 5000)
	}

	const handleApplyPrompt = async (promptId: string, type: string, content: string, name: string) => {
		setApplyingPromptId(promptId)
		try {
			const request = ApplyPromptRequest.create({
				promptId,
				type: type === "rule" ? 1 : 2,
				content,
				name,
			})

			const result = await PromptsServiceClient.applyPrompt(request)

			if (result.value) {
				setAppliedPrompts((prev) => new Set(prev).add(promptId))
				const directory = type === "rule" ? ".clinerules" : "workflows"
				showToast(`✓ "${name}" added to ${directory}/`, "success")
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

	const handleRemovePrompt = async (promptId: string, type: string, name: string) => {
		setRemovingPromptId(promptId)
		try {
			const request = RemovePromptRequest.create({
				promptId,
				type: type === "rule" ? 1 : 2,
				name,
			})

			const result = await PromptsServiceClient.removePrompt(request)

			if (result.value) {
				setAppliedPrompts((prev) => {
					const newSet = new Set(prev)
					newSet.delete(promptId)
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

	// Auto-hide toast after 5 seconds
	useEffect(() => {
		if (toastMessage) {
			const timer = setTimeout(() => setToastMessage(null), 5000)
			return () => clearTimeout(timer)
		}
	}, [toastMessage])

	if (!catalog.items || catalog.items.length === 0) {
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

			<div style={{ marginBottom: "20px" }}>
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

				{/* Results count */}
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 12px 0" }}>
					Showing {filteredPrompts.length} of {catalog.items.length} prompts
				</p>
			</div>

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
						const isApplied = appliedPrompts.has(prompt.promptId)
						const isProcessing = applyingPromptId === prompt.promptId || removingPromptId === prompt.promptId

						return (
							<div
								key={prompt.promptId}
								onMouseEnter={(e) => {
									if (!isApplied) {
										e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)"
									}
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor = isApplied ? "rgba(0, 255, 0, 0.05)" : "transparent"
								}}
								style={{
									padding: "12px",
									border: isApplied
										? "1px solid var(--vscode-terminal-ansiGreen)"
										: "1px solid var(--vscode-panel-border)",
									borderRadius: "4px",
									transition: "all 0.2s",
									backgroundColor: isApplied ? "rgba(0, 255, 0, 0.05)" : "transparent",
								}}>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "start",
										gap: "12px",
									}}>
									<div style={{ flex: 1, minWidth: 0, overflow: "hidden", wordWrap: "break-word" }}>
										<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
											<h5 style={{ margin: 0, fontSize: "14px" }}>{prompt.name}</h5>
											{isApplied && (
												<span
													style={{
														fontSize: "16px",
														color: "var(--vscode-terminal-ansiGreen)",
													}}>
													✓
												</span>
											)}
										</div>
										<p
											style={{
												margin: "0 0 8px 0",
												fontSize: "12px",
												color: "var(--vscode-descriptionForeground)",
											}}>
											{prompt.description}
										</p>
										<div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
											<span
												style={{
													fontSize: "11px",
													padding: "2px 6px",
													borderRadius: "3px",
													backgroundColor: "var(--vscode-badge-background)",
													color: "var(--vscode-badge-foreground)",
												}}>
												{prompt.type}
											</span>
											{prompt.category && (
												<span
													style={{
														fontSize: "11px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													{prompt.category}
												</span>
											)}
											{prompt.author && (
												<span
													style={{
														fontSize: "11px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													by {prompt.author}
												</span>
											)}
										</div>
									</div>

									{/* Apply/Remove Button */}
									{isApplied ? (
										<VSCodeButton
											appearance="secondary"
											disabled={isProcessing}
											onClick={() => handleRemovePrompt(prompt.promptId, prompt.type, prompt.name)}
											style={{ flexShrink: 0 }}>
											{removingPromptId === prompt.promptId ? "Removing..." : "Remove"}
										</VSCodeButton>
									) : (
										<VSCodeButton
											appearance="primary"
											disabled={isProcessing}
											onClick={() =>
												handleApplyPrompt(prompt.promptId, prompt.type, prompt.content, prompt.name)
											}
											style={{ flexShrink: 0 }}>
											{applyingPromptId === prompt.promptId ? "Applying..." : "Apply"}
										</VSCodeButton>
									)}
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

export default PromptsLibraryTab
