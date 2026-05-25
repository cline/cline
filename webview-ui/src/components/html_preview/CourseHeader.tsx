/**
 * CourseHeader — strip that renders ABOVE HtmlPreviewToolbar when the active
 * module belongs to a course (i.e. a `course.json` was found in a parent folder).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ 📚 Deep Learning for CAMELS · M. Galib · v1.0 · ⏱ 6h               │
 *   │ ────────────────────────────────────────────────────── 40% complete │
 *   │ ◀ Prev  │  Module 2 of 5: Loading streamflow  │  Next ▶            │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * The progress bar in Phase A is a position indicator (current/total), not a
 * completion indicator — that lands in Phase B with persisted progress state.
 */

import React from "react"
import type { CourseManifest } from "./useCourse"

interface CourseHeaderProps {
	course: CourseManifest
	currentModuleId: string | null
	onNavigate: (moduleId: string) => void
}

const ACCENT = "#00DDFF"
const ACCENT_DIM = "rgba(0,221,255,0.35)"

export const CourseHeader: React.FC<CourseHeaderProps> = ({ course, currentModuleId, onNavigate }) => {
	const total = course.modules.length
	const idx = currentModuleId ? course.modules.findIndex((m) => m.id === currentModuleId) : -1
	const currentIdx = idx >= 0 ? idx : -1
	const prev = currentIdx > 0 ? course.modules[currentIdx - 1] : null
	const next = currentIdx >= 0 && currentIdx < total - 1 ? course.modules[currentIdx + 1] : null
	const currentModule = currentIdx >= 0 ? course.modules[currentIdx] : null

	const positionPct = total > 0 && currentIdx >= 0 ? Math.round(((currentIdx + 1) / total) * 100) : 0

	const authorsLine = (course.authors ?? [])
		.map((a) => a.name)
		.filter(Boolean)
		.join(", ")

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				background: "linear-gradient(180deg, rgba(0,221,255,0.10), rgba(0,163,255,0.04))",
				borderBottom: `1px solid ${ACCENT_DIM}`,
				flexShrink: 0,
				fontFamily: "Poppins, system-ui, sans-serif",
			}}>
			{/* ── Row 1: course identity ────────────────────────────────────── */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "6px 12px",
					fontSize: 12,
					color: "var(--vscode-foreground, #ddd)",
					minHeight: 28,
				}}>
				<span style={{ fontSize: 15 }} title="Course">
					📚
				</span>
				<strong style={{ color: ACCENT, fontWeight: 700, letterSpacing: 0.2 }}>{course.title}</strong>
				{authorsLine && (
					<span style={{ opacity: 0.7, fontSize: 11 }}>
						· <span style={{ color: "var(--vscode-descriptionForeground, #999)" }}>{authorsLine}</span>
					</span>
				)}
				{course.version && <span style={{ opacity: 0.6, fontSize: 11 }}>· v{course.version}</span>}
				{course.estimatedHours !== undefined && (
					<span style={{ opacity: 0.6, fontSize: 11 }}>· ⏱ {course.estimatedHours}h</span>
				)}
				{course.license && (
					<span style={{ opacity: 0.5, fontSize: 10, marginLeft: 4 }} title="License">
						{course.license}
					</span>
				)}
				<div style={{ flex: 1 }} />
				<span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground, #888)" }}>
					{course.modules.length} module{course.modules.length === 1 ? "" : "s"}
				</span>
			</div>

			{/* ── Progress bar ───────────────────────────────────────────────── */}
			{currentIdx >= 0 && (
				<div
					style={{
						height: 2,
						background: "rgba(125,211,252,0.10)",
						position: "relative",
						margin: "0 12px",
					}}>
					<div
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							height: "100%",
							width: `${positionPct}%`,
							background: `linear-gradient(90deg, #00A3FF, ${ACCENT})`,
							transition: "width 0.25s ease",
						}}
					/>
				</div>
			)}

			{/* ── Row 2: navigation ─────────────────────────────────────────── */}
			{currentIdx >= 0 && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "5px 12px",
						fontSize: 11,
						minHeight: 30,
					}}>
					<NavBtn direction="prev" label="Prev" onClick={() => prev && onNavigate(prev.id)} target={prev} />
					<div
						style={{
							flex: 1,
							textAlign: "center",
							color: "var(--vscode-foreground, #ddd)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}>
						Module <strong>{currentIdx + 1}</strong> of <strong>{total}</strong>
						{currentModule && <span style={{ marginLeft: 8, opacity: 0.85 }}>· {currentModule.title}</span>}
					</div>
					<NavBtn direction="next" label="Next" onClick={() => next && onNavigate(next.id)} target={next} />
				</div>
			)}
		</div>
	)
}

const NavBtn: React.FC<{
	direction: "prev" | "next"
	label: string
	target: { id: string; title: string } | null
	onClick: () => void
}> = ({ direction, label, target, onClick }) => {
	const enabled = !!target
	return (
		<button
			disabled={!enabled}
			onClick={onClick}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "3px 10px",
				height: 22,
				background: enabled ? "rgba(0,221,255,0.10)" : "transparent",
				border: `1px solid ${enabled ? ACCENT_DIM : "rgba(125,211,252,0.10)"}`,
				borderRadius: 4,
				color: enabled ? ACCENT : "var(--vscode-descriptionForeground, #666)",
				cursor: enabled ? "pointer" : "not-allowed",
				opacity: enabled ? 1 : 0.4,
				fontSize: 11,
				fontWeight: 600,
				fontFamily: "Poppins, system-ui, sans-serif",
				flexShrink: 0,
				transition: "all 0.12s",
			}}
			title={
				enabled && target
					? `${direction === "prev" ? "Previous" : "Next"}: ${target.title}`
					: `No ${direction === "prev" ? "previous" : "next"} module`
			}
			type="button">
			{direction === "prev" && <span className="codicon codicon-arrow-left" style={{ fontSize: 11 }} />}
			{label}
			{direction === "next" && <span className="codicon codicon-arrow-right" style={{ fontSize: 11 }} />}
		</button>
	)
}
