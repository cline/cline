import { EmptyRequest } from "@shared/proto/cline/common"
import type { CourseCatalog, LearningModuleCatalog } from "@shared/proto/cline/html_preview"
import { InstallCourseRequest } from "@shared/proto/cline/html_preview"
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
import CourseCard from "./CourseCard"
import LearningModuleCard from "./LearningModuleCard"
import LearningModuleSubmitCard from "./LearningModuleSubmitCard"

type HubTab = "courses" | "modules" | "learning"

const cyan = "var(--vscode-textLink-foreground, #06b6d4)"

const ModulesMarketplaceView = () => {
	const [activeTab, setActiveTab] = useState<HubTab>("courses")
	const [catalog, setCatalog] = useState<LearningModuleCatalog | null>(null)
	const [courses, setCourses] = useState<CourseCatalog | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
	const [sortBy, setSortBy] = useState<"featured" | "popular" | "downloads" | "newest" | "name" | "level">("featured")

	const items = catalog?.items || []
	const courseItems = courses?.items || []

	// Map module_id → course title so the Modules tab can show a "Part of:" chip.
	const moduleCourseMap = useMemo(() => {
		const map = new Map<string, string>()
		for (const c of courseItems) {
			for (const m of c.modules) {
				map.set(m.moduleId, c.title)
			}
		}
		return map
	}, [courseItems])

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
						if (a.isFeatured !== b.isFeatured) {
							return a.isFeatured ? -1 : 1
						}
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

	// "My Learning" = courses the user has installed or started.
	const myCourses = useMemo(() => courseItems.filter((c) => c.isInstalled || c.modulesCompleted > 0), [courseItems])

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

		Promise.all([
			HtmlPreviewServiceClient.refreshModulesMarketplace(EmptyRequest.create({})),
			HtmlPreviewServiceClient.refreshCoursesMarketplace(EmptyRequest.create({})).catch(() => null),
		])
			.then(([modulesResp, coursesResp]) => {
				setCatalog(modulesResp)
				setCourses(coursesResp)
				setIsLoading(false)
				setIsRefreshing(false)
			})
			.catch((err) => {
				console.error("Error refreshing marketplace:", err)
				setError("Failed to load marketplace data")
				setIsLoading(false)
				setIsRefreshing(false)
			})
	}

	const updateRecognition = (moduleId: string, starred: boolean, aiHydroStars: number) => {
		setCatalog((current) => {
			if (!current) {
				return current
			}
			return {
				...current,
				items: current.items.map((item) =>
					item.moduleId === moduleId ? { ...item, starredByClient: starred, aiHydroStars } : item,
				),
			}
		})
	}

	const handleCourseInstalled = () => fetchMarketplace(true)

	const handleContinueCourse = async (courseId: string, manifestUrl: string) => {
		setError(null)
		try {
			await HtmlPreviewServiceClient.installCourse(InstallCourseRequest.create({ courseId, manifestUrl }))
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to open course")
		}
	}

	if (isLoading || isRefreshing) {
		return (
			<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", padding: "20px" }}>
				<VSCodeProgressRing />
			</div>
		)
	}

	if (error && !catalog) {
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

	const TabButton = ({ id, label, count }: { id: HubTab; label: string; count?: number }) => (
		<button
			onClick={() => setActiveTab(id)}
			style={{
				appearance: "none",
				background: "transparent",
				border: "none",
				borderBottom: activeTab === id ? `2px solid ${cyan}` : "2px solid transparent",
				color: activeTab === id ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
				cursor: "pointer",
				fontSize: 12,
				fontWeight: activeTab === id ? 600 : 500,
				padding: "10px 14px",
			}}
			type="button">
			{label}
			{typeof count === "number" && count > 0 && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{count}</span>}
		</button>
	)

	return (
		<div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
			{/* Tab bar */}
			<div
				style={{
					display: "flex",
					borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.1))",
					position: "sticky",
					top: 0,
					background: "var(--vscode-editor-background)",
					zIndex: 3,
				}}>
				<TabButton count={courseItems.length} id="courses" label="Courses" />
				<TabButton count={items.length} id="modules" label="Modules" />
				<TabButton count={myCourses.length} id="learning" label="My Learning" />
			</div>

			{error && <div style={{ padding: "8px 20px", color: "var(--vscode-errorForeground)", fontSize: 12 }}>{error}</div>}

			{/* ---------- COURSES TAB ---------- */}
			{activeTab === "courses" && (
				<div style={{ display: "flex", flexDirection: "column" }}>
					{courseItems.length === 0 ? (
						<div style={{ padding: 20, color: "var(--vscode-descriptionForeground)", textAlign: "center" }}>
							No courses found in the marketplace
						</div>
					) : (
						courseItems.map((course) => (
							<CourseCard
								course={course}
								key={course.courseId}
								onInstalled={handleCourseInstalled}
								setError={setError}
							/>
						))
					)}
				</div>
			)}

			{/* ---------- MODULES TAB ---------- */}
			{activeTab === "modules" && (
				<>
					<div style={{ padding: "16px 20px 5px", display: "flex", flexDirection: "column", gap: "16px" }}>
						<VSCodeTextField
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
							placeholder="Search modules..."
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

						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
								style={{ display: "flex", flexWrap: "wrap", marginTop: "-2.5px" }}
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
							<div style={{ padding: 20, color: "var(--vscode-descriptionForeground)", textAlign: "center" }}>
								{searchQuery || selectedTopic
									? "No matching modules found"
									: "No learning modules found in the marketplace"}
							</div>
						) : (
							filteredItems.map((item) => (
								<LearningModuleCard
									courseTitle={item.courseTitle || moduleCourseMap.get(item.moduleId)}
									item={item}
									key={item.moduleId}
									onRecognitionChange={updateRecognition}
									setError={setError}
								/>
							))
						)}
						<LearningModuleSubmitCard />
					</div>
				</>
			)}

			{/* ---------- MY LEARNING TAB ---------- */}
			{activeTab === "learning" && (
				<div style={{ display: "flex", flexDirection: "column" }}>
					{myCourses.length === 0 ? (
						<div style={{ padding: 24, color: "var(--vscode-descriptionForeground)", textAlign: "center" }}>
							<div style={{ fontSize: 13, marginBottom: 6 }}>You haven't started any courses yet.</div>
							<button
								onClick={() => setActiveTab("courses")}
								style={{
									appearance: "none",
									background: "transparent",
									border: "none",
									color: cyan,
									cursor: "pointer",
									fontSize: 12,
								}}
								type="button">
								Browse courses →
							</button>
						</div>
					) : (
						myCourses.map((course) => {
							const total = course.modules.length
							const pct = total > 0 ? Math.round((course.modulesCompleted / total) * 100) : 0
							const done = pct === 100
							return (
								<div
									key={course.courseId}
									style={{
										padding: "14px 16px",
										display: "flex",
										flexDirection: "column",
										gap: 10,
										borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.1))",
									}}>
									<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
										<span
											style={{ fontSize: 13, fontWeight: 600, color: "var(--vscode-foreground)", flex: 1 }}>
											{course.title}
										</span>
										<span
											style={{
												fontSize: 11,
												color: done ? "#34d399" : "var(--vscode-descriptionForeground)",
											}}>
											{course.modulesCompleted}/{total} done
										</span>
									</div>
									<div
										style={{
											height: 6,
											borderRadius: 3,
											background: "rgba(255,255,255,0.1)",
											overflow: "hidden",
										}}>
										<div
											style={{
												width: `${pct}%`,
												height: "100%",
												background: done ? "#34d399" : "linear-gradient(90deg,#00A3FF,#00DDFF)",
											}}
										/>
									</div>
									<button
										onClick={() => handleContinueCourse(course.courseId, course.manifestUrl)}
										style={{
											alignSelf: "flex-start",
											padding: "5px 12px",
											fontSize: 11,
											fontWeight: 600,
											background: "var(--vscode-button-background, #0e639c)",
											color: "var(--vscode-button-foreground, #fff)",
											border: "none",
											borderRadius: 4,
											cursor: "pointer",
										}}
										type="button">
										{done ? "Review course" : "Continue learning"}
									</button>
								</div>
							)
						})
					)}
				</div>
			)}
		</div>
	)
}

export default ModulesMarketplaceView
