import type { CourseCatalogItem } from "@shared/proto/cline/html_preview"
import { InstallCourseRequest } from "@shared/proto/cline/html_preview"
import { useState } from "react"
import { HtmlPreviewServiceClient } from "@/services/grpc-client"

interface CourseCardProps {
	course: CourseCatalogItem
	setError: (error: string | null) => void
	onInstalled?: (courseId: string) => void
}

const cyan = "var(--vscode-textLink-foreground, #06b6d4)"

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

const CourseCard = ({ course, setError, onInstalled }: CourseCardProps) => {
	const [expanded, setExpanded] = useState(false)
	const [isInstalling, setIsInstalling] = useState(false)
	const [installed, setInstalled] = useState(course.isInstalled)

	const total = course.modules.length
	const completed = course.modulesCompleted

	const handleInstall = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (isInstalling || installed) return
		setIsInstalling(true)
		setError(null)
		try {
			const resp = await HtmlPreviewServiceClient.installCourse(
				InstallCourseRequest.create({ courseId: course.courseId, manifestUrl: course.manifestUrl }),
			)
			if (resp.success) {
				setInstalled(true)
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
						</div>
						<div style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", marginTop: 2 }}>
							{course.author && <span>by {course.author}</span>}
							{course.authorAffiliation && <span> · {course.authorAffiliation}</span>}
							{course.estimatedHours > 0 && <span> · ~{course.estimatedHours}h</span>}
						</div>
					</div>

					<div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
						{(installed || completed > 0) && <ProgressRing completed={completed} total={total} />}
						<button
							disabled={isInstalling || installed}
							onClick={handleInstall}
							style={{
								padding: "5px 12px",
								fontSize: 11,
								fontWeight: 600,
								background: installed
									? "rgba(40,167,69,0.12)"
									: isInstalling
										? "rgba(0,0,0,0.12)"
										: "var(--vscode-button-background, #0e639c)",
								color: installed
									? "#28a745"
									: isInstalling
										? "var(--vscode-descriptionForeground)"
										: "var(--vscode-button-foreground, #fff)",
								border: installed ? "1px solid rgba(40,167,69,0.4)" : "none",
								borderRadius: 4,
								cursor: installed || isInstalling ? "default" : "pointer",
							}}
							type="button">
							{installed ? "✓ Installed" : isInstalling ? "Installing…" : "Install course"}
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
		</div>
	)
}

export default CourseCard
