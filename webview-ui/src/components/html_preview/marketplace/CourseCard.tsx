import { MarketplaceStarRequest } from "@shared/proto/cline/common"
import type { CourseCatalogItem } from "@shared/proto/cline/html_preview"
import { InstallCourseRequest } from "@shared/proto/cline/html_preview"
import { useState } from "react"
import { HtmlPreviewServiceClient } from "@/services/grpc-client"

interface CourseCardProps {
	course: CourseCatalogItem
	setError: (error: string | null) => void
	onInstalled?: (courseId: string) => void
	onRecognitionChange?: (courseId: string, starred: boolean, aiHydroStars: number) => void
}

const cyan = "var(--vscode-textLink-foreground, #06b6d4)"

const TRUST_COLORS: Record<string, string> = {
	official: "#7dd3fc",
	reviewed: "#86efac",
	community: "#facc15",
	local: "#c4b5fd",
}

function trustText(v: string): string {
	return { official: "Official", reviewed: "Reviewed", community: "Community", local: "Local" }[v] ?? v
}

function formatCount(n: number): string {
	if (n >= 1000) {
		return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
	}
	return String(n)
}

function githubProfileUrl(github?: string): string {
	const h = String(github ?? "")
		.trim()
		.replace(/^@/, "")
	return h ? `https://github.com/${h}` : ""
}

function orcidProfileUrl(orcid?: string): string {
	const v = String(orcid ?? "").trim()
	return v ? (v.startsWith("http") ? v : `https://orcid.org/${v}`) : ""
}

function contributorProfileUrl(c: CourseCatalogItem["contributors"][number]): string {
	return (
		c.profileUrl ||
		c.url ||
		c.website ||
		c.linkedin ||
		c.googleScholar ||
		githubProfileUrl(c.github) ||
		orcidProfileUrl(c.orcid)
	)
}

function ProgressRing({ completed, total }: { completed: number; total: number }) {
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0
	const r = 16
	const c = 2 * Math.PI * r
	const dash = (pct / 100) * c
	return (
		<div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
			<svg height="40" viewBox="0 0 40 40" width="40">
				<circle cx="20" cy="20" fill="none" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
				<circle
					cx="20"
					cy="20"
					fill="none"
					r={r}
					stroke={pct === 100 ? "#34d399" : cyan}
					strokeDasharray={`${dash} ${c}`}
					strokeLinecap="round"
					strokeWidth="3"
					transform="rotate(-90 20 20)"
				/>
			</svg>
			<span
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: 9,
					fontWeight: 600,
					color: pct === 100 ? "#34d399" : "var(--vscode-foreground)",
				}}>
				{pct}%
			</span>
		</div>
	)
}

const CourseCard = ({ course, setError, onInstalled, onRecognitionChange }: CourseCardProps) => {
	const [expanded, setExpanded] = useState(false)
	const [isInstalling, setIsInstalling] = useState(false)
	const [installed, setInstalled] = useState(course.isInstalled)
	const [updateAvailable, setUpdateAvailable] = useState(course.updateAvailable)
	const [isStarring, setIsStarring] = useState(false)
	const [starred, setStarred] = useState(course.starredByClient)
	const [aiHydroInstalls, setAiHydroInstalls] = useState(course.aiHydroInstalls || 0)
	const [aiHydroStars, setAiHydroStars] = useState(course.aiHydroStars || 0)

	const total = course.modules.length
	const completed = course.modulesCompleted

	const handleInstall = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		// Allow click when not installed, or when an update is available (re-install).
		if (isInstalling || (installed && !updateAvailable)) return
		setIsInstalling(true)
		setError(null)
		try {
			const resp = await HtmlPreviewServiceClient.installCourse(
				InstallCourseRequest.create({ courseId: course.courseId, manifestUrl: course.manifestUrl }),
			)
			if (resp.success) {
				const wasUpdate = installed && updateAvailable
				setInstalled(true)
				setUpdateAvailable(false)
				if (!wasUpdate) {
					setAiHydroInstalls((current) => current + 1)
				}
				onInstalled?.(course.courseId)
			} else {
				setError(resp.error ?? "Course install failed")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Course install failed")
		} finally {
			setIsInstalling(false)
		}
	}

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
			const resp = await HtmlPreviewServiceClient.starModule(
				MarketplaceStarRequest.create({
					marketplace: "courses",
					itemId: course.courseId,
					starred: nextStarred,
				}),
			)
			if (resp.error) {
				setError(resp.error)
				return
			}
			setStarred(resp.starred)
			setAiHydroStars(resp.aiHydroStars)
			onRecognitionChange?.(course.courseId, resp.starred, resp.aiHydroStars)
		} catch (err) {
			setError(err instanceof Error ? err.message : "AI-Hydro star update failed")
		} finally {
			setIsStarring(false)
		}
	}

	const initial = (course.title || "?")[0]?.toUpperCase() ?? "?"

	return (
		<div
			style={{
				borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.1))",
				background: "var(--vscode-editor-background)",
			}}>
			{/* Header — click to expand syllabus */}
			<div
				onClick={() => setExpanded((v) => !v)}
				role="button"
				style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer" }}
				tabIndex={0}>
				<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
					<div
						style={{
							width: 44,
							height: 44,
							borderRadius: 6,
							flexShrink: 0,
							background: "linear-gradient(135deg, #00A3FF 0%, #00DDFF 100%)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 20,
							fontWeight: 700,
							color: "#0a1626",
						}}>
						{initial}
					</div>

					<div style={{ flex: 1, minWidth: 0 }}>
						<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
							<span style={{ fontSize: 13, fontWeight: 600, color: "var(--vscode-foreground)" }}>
								{course.title}
							</span>
							<span
								style={{
									fontSize: 10,
									fontWeight: 600,
									padding: "2px 7px",
									borderRadius: 10,
									background: "rgba(0,184,212,0.14)",
									color: cyan,
								}}>
								Course · {total} modules
							</span>
							{course.trustLevel && (
								<span
									style={{
										fontSize: 10,
										fontWeight: 600,
										padding: "2px 7px",
										borderRadius: 10,
										background: `${TRUST_COLORS[course.trustLevel] ?? "#facc15"}22`,
										color: TRUST_COLORS[course.trustLevel] ?? "#facc15",
										display: "inline-flex",
										alignItems: "center",
										gap: 3,
									}}
									title={`Trust level: ${trustText(course.trustLevel)}`}>
									<span className="codicon codicon-verified-filled" style={{ fontSize: 10 }} />
									{trustText(course.trustLevel)}
								</span>
							)}
						</div>
						<div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", marginTop: 2 }}>
							{course.contributors.length > 0 ? (
								<span>
									by{" "}
									{course.contributors.map((c, i) => {
										const url = contributorProfileUrl(c)
										const label = c.name || c.github || "Contributor"
										return (
											<span key={`${label}-${i}`}>
												{i > 0 && ", "}
												{url ? (
													<a
														href={url}
														onClick={(e) => e.stopPropagation()}
														rel="noopener noreferrer"
														style={{ color: cyan, textDecoration: "none" }}
														target="_blank">
														{label}
													</a>
												) : (
													<span>{label}</span>
												)}
											</span>
										)
									})}
								</span>
							) : (
								course.author && <span>by {course.author}</span>
							)}
							{course.authorAffiliation && <span> · {course.authorAffiliation}</span>}
							{course.estimatedHours > 0 && <span> · ~{course.estimatedHours}h</span>}
						</div>
					</div>

					<div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
						{(installed || completed > 0) && <ProgressRing completed={completed} total={total} />}
						<button
							aria-label={starred ? "Remove your AI-Hydro star" : "Star this course in AI-Hydro"}
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
							title={starred ? "Remove your AI-Hydro star" : "Star this course in AI-Hydro"}
							type="button">
							{starred ? "★" : "☆"}
						</button>
						<button
							disabled={isInstalling || (installed && !updateAvailable)}
							onClick={handleInstall}
							style={{
								padding: "5px 12px",
								fontSize: 11,
								fontWeight: 600,
								background:
									installed && updateAvailable
										? "rgba(224, 168, 0, 0.18)"
										: installed
											? "rgba(40,167,69,0.12)"
											: isInstalling
												? "rgba(0,0,0,0.12)"
												: "var(--vscode-button-background, #0e639c)",
								color:
									installed && updateAvailable
										? "#e0a800"
										: installed
											? "#28a745"
											: isInstalling
												? "var(--vscode-descriptionForeground)"
												: "var(--vscode-button-foreground, #fff)",
								border:
									installed && updateAvailable
										? "1px solid rgba(224,168,0,0.5)"
										: installed
											? "1px solid rgba(40,167,69,0.4)"
											: "none",
								borderRadius: 4,
								cursor: isInstalling || (installed && !updateAvailable) ? "default" : "pointer",
							}}
							title={
								installed && updateAvailable
									? `Update available (installed v${course.installedVersion})`
									: undefined
							}
							type="button">
							{isInstalling
								? installed && updateAvailable
									? "Updating…"
									: "Installing…"
								: installed && updateAvailable
									? "↻ Update course"
									: installed
										? "✓ Installed"
										: "Install course"}
						</button>
					</div>
				</div>

				{course.abstract && (
					<p
						style={{
							margin: 0,
							fontSize: 12,
							color: "var(--vscode-foreground)",
							opacity: 0.8,
							lineHeight: 1.5,
							display: "-webkit-box",
							WebkitLineClamp: expanded ? 99 : 2,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}>
						{course.abstract}
					</p>
				)}

				{/* Stats row: AI-Hydro recognition */}
				<div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: "var(--vscode-descriptionForeground)",
						}}
						title="AI-Hydro installs">
						<span className="codicon codicon-cloud-download" style={{ fontSize: 12 }} />
						<span>{formatCount(aiHydroInstalls)} AI-Hydro installs</span>
					</span>
					<span
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: starred ? "#facc15" : "var(--vscode-descriptionForeground)",
						}}
						title="AI-Hydro user stars">
						<span style={{ fontSize: 12, lineHeight: 1 }}>{starred ? "★" : "☆"}</span>
						<span>{formatCount(aiHydroStars)} AI-Hydro stars</span>
					</span>
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
					<span style={{ fontSize: 10, color: cyan }}>
						<span className={`codicon codicon-chevron-${expanded ? "down" : "right"}`} style={{ fontSize: 11 }} />
						{expanded ? "Hide syllabus" : "View syllabus"}
					</span>
					{course.githubUrl && (
						<a
							href={course.githubUrl}
							onClick={(e) => e.stopPropagation()}
							rel="noopener noreferrer"
							style={{ marginLeft: "auto", fontSize: 10, color: cyan, textDecoration: "none" }}
							target="_blank">
							GitHub ↗
						</a>
					)}
				</div>
			</div>

			{/* Syllabus — ordered module list with completion + lock state */}
			{expanded && (
				<ol
					style={{
						listStyle: "none",
						margin: 0,
						padding: "0 16px 14px 16px",
						display: "flex",
						flexDirection: "column",
						gap: 4,
					}}>
					{course.modules.map((m, idx) => {
						const isDone = idx < completed
						return (
							<li
								key={m.moduleId}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "8px 10px",
									borderRadius: 6,
									background: "var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04))",
								}}>
								<span
									style={{
										width: 22,
										height: 22,
										borderRadius: "50%",
										flexShrink: 0,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: 11,
										fontWeight: 600,
										background: isDone ? "rgba(52,211,153,0.18)" : "rgba(0,184,212,0.12)",
										color: isDone ? "#34d399" : cyan,
									}}>
									{isDone ? "✓" : idx + 1}
								</span>
								<div style={{ flex: 1, minWidth: 0 }}>
									<div
										style={{
											fontSize: 12,
											fontWeight: 500,
											color: "var(--vscode-foreground)",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}>
										{m.title}
									</div>
									{m.estimatedMinutes > 0 && (
										<div style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)" }}>
											{m.estimatedMinutes} min
										</div>
									)}
								</div>
								{m.isInstalled && (
									<span
										className="codicon codicon-check"
										style={{ fontSize: 12, color: "#28a745" }}
										title="Installed"
									/>
								)}
							</li>
						)
					})}
				</ol>
			)}

			{/* License + Citation — surfaced in the expanded view (parity with the Gallery) */}
			{expanded && (course.license || course.citation || course.citationUrl) && (
				<div
					style={{
						padding: "0 16px 14px 16px",
						display: "flex",
						flexDirection: "column",
						gap: 6,
						fontSize: 11,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{course.license && (
						<div>
							<span style={{ fontWeight: 600 }}>License: </span>
							{course.license}
						</div>
					)}
					{(course.citation || course.citationUrl) && (
						<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
							<span style={{ fontWeight: 600 }}>Citation:</span>
							{course.citation && (
								<span style={{ lineHeight: 1.4, color: "var(--vscode-foreground)", opacity: 0.85 }}>
									{course.citation}
								</span>
							)}
							{course.citationUrl && (
								<a
									href={course.citationUrl}
									onClick={(e) => e.stopPropagation()}
									rel="noopener noreferrer"
									style={{ color: cyan, textDecoration: "none" }}
									target="_blank">
									Cite ↗
								</a>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default CourseCard
