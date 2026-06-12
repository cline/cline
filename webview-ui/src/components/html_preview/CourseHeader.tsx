/**
 * CourseHeader — strip that renders ABOVE HtmlPreviewToolbar when the active
 * module belongs to a course (i.e. a `course.json` was found in a parent folder).
 *
 * Phase A: identity, position bar, prev/next.
 * Phase B: completion-% progress bar (replaces position bar), Mark Complete /
 *          Mark Incomplete button, prerequisite-aware navigation, course menu
 *          with Reset Progress.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │ 📚 Course Title · authors · v1.0 · ⏱ 6h          3/5 done (60%)  ⋮   │
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 60% complete         │
 *   │ ◀ Prev  │  Module 2 of 5: Loading streamflow  │ ✓ Mark complete  Next ▶│
 *   └────────────────────────────────────────────────────────────────────────┘
 */

import React, { useState } from "react"
import type { CourseManifest } from "./useCourse"
import type { CourseProgressHook } from "./useCourseProgress"

interface CourseHeaderProps {
	course: CourseManifest
	currentModuleId: string | null
	progress: CourseProgressHook
	onNavigate: (moduleId: string) => void
}

const ACCENT = "#00DDFF"
const ACCENT_DIM = "rgba(0,221,255,0.35)"
const GREEN = "#4ade80"

export const CourseHeader: React.FC<CourseHeaderProps> = ({ course, currentModuleId, progress, onNavigate }) => {
	const total = course.modules.length
	const idx = currentModuleId ? course.modules.findIndex((m) => m.id === currentModuleId) : -1
	const currentIdx = idx
	const prev = currentIdx > 0 ? course.modules[currentIdx - 1] : null
	const next = currentIdx >= 0 && currentIdx < total - 1 ? course.modules[currentIdx + 1] : null
	const currentModule = currentIdx >= 0 ? course.modules[currentIdx] : null

	// Count only IDs that exist in the current course to avoid stale entries inflating the tally.
	const completedCount = course.modules.filter((m) => !!progress.progress.completed[m.id]).length
	const completionPct = progress.completionPct
	const isCurrentCompleted = currentModule ? progress.isCompleted(currentModule.id) : false

	const authorsLine = (course.authors ?? [])
		.map((a) => a.name)
		.filter(Boolean)
		.join(", ")

	const [menuOpen, setMenuOpen] = useState(false)
	const [confirmReset, setConfirmReset] = useState(false)
	const [isMarkingComplete, setIsMarkingComplete] = useState(false)

	const handleMarkComplete = async () => {
		if (!currentModule || isMarkingComplete) {
			return
		}
		if (isCurrentCompleted) {
			await progress.markUncomplete(currentModule.id)
		} else {
			setIsMarkingComplete(true)
			await progress.markComplete(currentModule.id)
			// Auto-advance after a tick so the user sees the ✓ before navigating.
			// Keep the spinner up across the delay so the click has visible feedback.
			if (next && progress.canAccess(next)) {
				window.setTimeout(() => {
					onNavigate(next.id)
					setIsMarkingComplete(false)
				}, 350)
			} else {
				setIsMarkingComplete(false)
			}
		}
	}

	const handleReset = async () => {
		await progress.reset()
		setConfirmReset(false)
		setMenuOpen(false)
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				background: "linear-gradient(180deg, rgba(0,221,255,0.10), rgba(0,163,255,0.04))",
				borderBottom: `1px solid ${ACCENT_DIM}`,
				flexShrink: 0,
				fontFamily: "Poppins, system-ui, sans-serif",
				position: "relative",
			}}>
			{/* ── Row 1: course identity ────────────────────────────────────── */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "6px 10px 6px 12px",
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
				<div style={{ flex: 1 }} />
				{/* Progress count */}
				<span
					style={{
						fontSize: 10,
						color: completedCount > 0 ? GREEN : "var(--vscode-descriptionForeground, #888)",
						fontWeight: 600,
					}}
					title={`${completedCount} of ${total} modules completed`}>
					{completedCount}/{total} done
				</span>
				{/* Kebab menu */}
				<button
					aria-label="Course options"
					onClick={() => setMenuOpen((v) => !v)}
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 22,
						height: 22,
						borderRadius: 4,
						background: menuOpen ? "rgba(255,255,255,0.08)" : "transparent",
						border: "none",
						color: "var(--vscode-foreground, #ddd)",
						cursor: "pointer",
						flexShrink: 0,
					}}
					title="Course options"
					type="button">
					<span className="codicon codicon-kebab-vertical" style={{ fontSize: 14 }} />
				</button>
			</div>

			{/* ── Kebab menu popover ─────────────────────────────────────────── */}
			{menuOpen && (
				<>
					{/* backdrop */}
					<div
						onClick={() => {
							setMenuOpen(false)
							setConfirmReset(false)
						}}
						style={{
							position: "fixed",
							inset: 0,
							zIndex: 1000,
						}}
					/>
					<div
						style={{
							position: "absolute",
							top: 32,
							right: 8,
							zIndex: 1001,
							background: "var(--vscode-menu-background, #252526)",
							border: "1px solid var(--vscode-menu-border, rgba(255,255,255,0.15))",
							borderRadius: 6,
							boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
							padding: 4,
							minWidth: 200,
							fontSize: 12,
						}}>
						{!confirmReset ? (
							<>
								<MenuItem
									danger
									disabled={completedCount === 0}
									icon="trash"
									label={
										completedCount === 0
											? "No progress to reset"
											: `Reset progress (${completedCount} completed)`
									}
									onClick={() => setConfirmReset(true)}
								/>
								<MenuDivider />
								<MenuItem
									disabled
									icon="info"
									label={`${course.modules.length} modules · ${course.estimatedHours ?? "?"} h estimated`}
									onClick={() => {}}
								/>
							</>
						) : (
							<div style={{ padding: "6px 8px" }}>
								<div style={{ fontSize: 11, marginBottom: 8, color: "var(--vscode-foreground)" }}>
									Wipe progress for <strong>{course.title}</strong>? This cannot be undone.
								</div>
								<div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
									<button
										onClick={() => setConfirmReset(false)}
										style={{
											padding: "3px 9px",
											fontSize: 11,
											background: "transparent",
											color: "var(--vscode-foreground)",
											border: "1px solid rgba(255,255,255,0.15)",
											borderRadius: 4,
											cursor: "pointer",
										}}
										type="button">
										Cancel
									</button>
									<button
										onClick={handleReset}
										style={{
											padding: "3px 9px",
											fontSize: 11,
											background: "var(--vscode-errorForeground, #f48771)",
											color: "#fff",
											border: "none",
											borderRadius: 4,
											cursor: "pointer",
											fontWeight: 600,
										}}
										type="button">
										Reset
									</button>
								</div>
							</div>
						)}
					</div>
				</>
			)}

			{/* ── Completion progress bar (Phase B) ──────────────────────────── */}
			<div
				style={{
					height: 3,
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
						width: `${completionPct}%`,
						background:
							completionPct === 100
								? `linear-gradient(90deg, ${GREEN}, #22c55e)`
								: `linear-gradient(90deg, #00A3FF, ${ACCENT})`,
						transition: "width 0.35s ease",
						boxShadow: completionPct > 0 ? `0 0 8px ${completionPct === 100 ? GREEN : ACCENT}` : "none",
					}}
				/>
			</div>

			{/* ── Row 2: navigation ─────────────────────────────────────────── */}
			{currentIdx >= 0 && currentModule && (
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
						{isCurrentCompleted && (
							<span className="codicon codicon-check" style={{ color: GREEN, marginRight: 6, fontSize: 12 }} />
						)}
						Module <strong>{currentIdx + 1}</strong> of <strong>{total}</strong>
						<span style={{ marginLeft: 8, opacity: 0.85 }}>· {currentModule.title}</span>
					</div>
					<button
						disabled={isMarkingComplete}
						onClick={handleMarkComplete}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							padding: "3px 11px",
							height: 22,
							background: isCurrentCompleted ? "rgba(74,222,128,0.18)" : "rgba(0,221,255,0.12)",
							border: `1px solid ${isCurrentCompleted ? "rgba(74,222,128,0.4)" : ACCENT_DIM}`,
							borderRadius: 4,
							color: isCurrentCompleted ? GREEN : ACCENT,
							cursor: isMarkingComplete ? "default" : "pointer",
							fontSize: 11,
							fontWeight: 600,
							fontFamily: "Poppins, system-ui, sans-serif",
							flexShrink: 0,
							transition: "all 0.12s",
						}}
						title={
							isCurrentCompleted
								? "Mark this module as incomplete"
								: next
									? "Mark complete & continue to next module"
									: "Mark complete (last module)"
						}
						type="button">
						<span
							className={`codicon codicon-${isMarkingComplete ? "loading codicon-modifier-spin" : isCurrentCompleted ? "check-all" : "check"}`}
							style={{ fontSize: 12 }}
						/>
						{isMarkingComplete ? "Saving…" : isCurrentCompleted ? "Completed" : "Mark complete"}
					</button>
					<NavBtn
						blocked={next ? !progress.canAccess(next) : false}
						blockedReason={
							next
								? progress
										.missingPrerequisites(next)
										.map((id) => course.modules.find((m) => m.id === id)?.title ?? id)
										.join(", ")
								: ""
						}
						direction="next"
						label="Next"
						onClick={() => next && progress.canAccess(next) && onNavigate(next.id)}
						target={next}
					/>
				</div>
			)}
		</div>
	)
}

// ─── Submenu helpers ───────────────────────────────────────────────────────

const MenuItem: React.FC<{
	icon: string
	label: string
	onClick: () => void
	disabled?: boolean
	danger?: boolean
}> = ({ icon, label, onClick, disabled = false, danger = false }) => {
	const [hovered, setHovered] = useState(false)
	return (
		<button
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				width: "100%",
				padding: "5px 10px",
				background: hovered && !disabled ? "rgba(255,255,255,0.06)" : "transparent",
				border: "none",
				color: disabled
					? "var(--vscode-disabledForeground, #555)"
					: danger
						? "var(--vscode-errorForeground, #f48771)"
						: "var(--vscode-foreground, #ddd)",
				cursor: disabled ? "default" : "pointer",
				fontSize: 11,
				fontFamily: "Nunito, system-ui, sans-serif",
				textAlign: "left",
				borderRadius: 4,
			}}
			type="button">
			<span className={`codicon codicon-${icon}`} style={{ fontSize: 12 }} />
			{label}
		</button>
	)
}

const MenuDivider = () => <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "3px 4px" }} />

const NavBtn: React.FC<{
	direction: "prev" | "next"
	label: string
	target: { id: string; title: string } | null
	onClick: () => void
	blocked?: boolean
	blockedReason?: string
}> = ({ direction, label, target, onClick, blocked = false, blockedReason = "" }) => {
	const enabled = !!target && !blocked
	const title = !target
		? `No ${direction === "prev" ? "previous" : "next"} module`
		: blocked
			? `Locked — complete prerequisite${blockedReason.includes(",") ? "s" : ""} first: ${blockedReason}`
			: `${direction === "prev" ? "Previous" : "Next"}: ${target.title}`
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
				opacity: enabled ? 1 : blocked ? 0.5 : 0.4,
				fontSize: 11,
				fontWeight: 600,
				fontFamily: "Poppins, system-ui, sans-serif",
				flexShrink: 0,
				transition: "all 0.12s",
			}}
			title={title}
			type="button">
			{direction === "prev" && <span className="codicon codicon-arrow-left" style={{ fontSize: 11 }} />}
			{blocked && <span className="codicon codicon-lock" style={{ fontSize: 11 }} />}
			{label}
			{direction === "next" && !blocked && <span className="codicon codicon-arrow-right" style={{ fontSize: 11 }} />}
		</button>
	)
}
