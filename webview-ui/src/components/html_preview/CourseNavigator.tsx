/**
 * CourseNavigator — sidebar list of all modules in the active course.
 *
 * Rendered as the content of a "Course" AccordionSection in the left sidebar
 * (only when a course is detected for the active item).
 *
 * Phase A (free roam): every module is clickable, no prerequisite locking.
 * The current module is highlighted with a cyan accent bar.
 *
 * Phase B will add ✓ for completed modules, ⊘ for locked-by-prerequisites,
 * and a small completion percentage at the top.
 */

import React, { useState } from "react"
import type { CourseManifest } from "./useCourse"

interface CourseNavigatorProps {
	course: CourseManifest
	currentModuleId: string | null
	onNavigate: (moduleId: string) => void
}

const ACCENT = "#00DDFF"

export const CourseNavigator: React.FC<CourseNavigatorProps> = ({ course, currentModuleId, onNavigate }) => {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0" }}>
			{course.modules.map((m, idx) => (
				<ModuleRow
					index={idx + 1}
					isCurrent={m.id === currentModuleId}
					key={m.id}
					module={m}
					onClick={() => onNavigate(m.id)}
				/>
			))}
			{course.abstract && (
				<div
					style={{
						marginTop: 8,
						padding: "6px 10px",
						borderTop: "1px solid var(--vscode-panel-border, rgba(125,211,252,0.18))",
						fontSize: 10,
						color: "var(--vscode-descriptionForeground, #999)",
						fontStyle: "italic",
						lineHeight: 1.5,
					}}>
					{course.abstract}
				</div>
			)}
		</div>
	)
}

const ModuleRow: React.FC<{
	index: number
	module: { id: string; title: string; estimatedMinutes?: number }
	isCurrent: boolean
	onClick: () => void
}> = ({ index, module, isCurrent, onClick }) => {
	const [hovered, setHovered] = useState(false)
	return (
		<button
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "5px 10px 5px 8px",
				background: isCurrent ? "rgba(0,221,255,0.10)" : hovered ? "rgba(255,255,255,0.04)" : "transparent",
				border: "none",
				borderLeft: `2px solid ${isCurrent ? ACCENT : "transparent"}`,
				color: isCurrent ? ACCENT : "var(--vscode-foreground, #ddd)",
				cursor: "pointer",
				textAlign: "left",
				fontFamily: "Nunito, system-ui, sans-serif",
				fontSize: 11,
				fontWeight: isCurrent ? 600 : 400,
				transition: "background 0.1s",
				width: "100%",
				minHeight: 24,
			}}
			title={module.title}
			type="button">
			<span
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 18,
					height: 18,
					borderRadius: 9,
					background: isCurrent ? ACCENT : "rgba(125,211,252,0.12)",
					color: isCurrent ? "#0a0a15" : "var(--vscode-descriptionForeground, #999)",
					fontSize: 9,
					fontWeight: 700,
					flexShrink: 0,
					fontFamily: "Poppins, system-ui, sans-serif",
				}}>
				{index}
			</span>
			<span
				style={{
					flex: 1,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}>
				{module.title}
			</span>
			{module.estimatedMinutes !== undefined && module.estimatedMinutes > 0 && (
				<span
					style={{
						fontSize: 9,
						color: "var(--vscode-descriptionForeground, #888)",
						opacity: 0.7,
						flexShrink: 0,
					}}>
					{module.estimatedMinutes}m
				</span>
			)}
		</button>
	)
}
