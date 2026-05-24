/**
 * AccordionSection — a stackable collapsible section for sidebar panels.
 *
 * Designed to be stacked vertically (Files / Modules / Skills / Comments)
 * in the redesigned HtmlPreviewPanel sidebar. Each section persists its
 * open state in localStorage keyed by `persistKey`.
 *
 * Visual contract:
 *   ┌─────────────────────────────────────┐
 *   │ ⌃ [icon] Title           [badge]    │  ← header (click to toggle)
 *   ├─────────────────────────────────────┤
 *   │ <children>                          │  ← body (hidden when collapsed)
 *   └─────────────────────────────────────┘
 *
 * The chevron rotates 90° when expanded.
 */

import React, { useCallback, useEffect, useState } from "react"

interface AccordionSectionProps {
	title: string
	/** Codicon name without `codicon-` prefix, e.g. "files" */
	icon?: string
	/** Optional badge (e.g. count, status pill) shown after the title */
	badge?: React.ReactNode
	/** localStorage key for persisting open state; if omitted, state is in-memory only */
	persistKey?: string
	defaultOpen?: boolean
	/** Optional inline action element rendered in the header (right side, before badge) */
	headerAction?: React.ReactNode
	children: React.ReactNode
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({
	title,
	icon,
	badge,
	persistKey,
	defaultOpen = false,
	headerAction,
	children,
}) => {
	const storageKey = persistKey ? `aihydro.accordion.${persistKey}` : null

	const [open, setOpen] = useState<boolean>(() => {
		if (!storageKey) return defaultOpen
		try {
			const stored = localStorage.getItem(storageKey)
			if (stored === "true") return true
			if (stored === "false") return false
		} catch {
			/* ignore */
		}
		return defaultOpen
	})

	useEffect(() => {
		if (!storageKey) return
		try {
			localStorage.setItem(storageKey, String(open))
		} catch {
			/* ignore */
		}
	}, [open, storageKey])

	const toggle = useCallback(() => setOpen((v) => !v), [])

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				borderBottom: "1px solid var(--vscode-panel-border, rgba(125,211,252,0.12))",
			}}>
			{/* Header */}
			<button
				aria-expanded={open}
				onClick={toggle}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "6px 10px",
					background: "transparent",
					border: "none",
					color: "var(--vscode-foreground, #cccccc)",
					cursor: "pointer",
					fontFamily: "var(--vscode-font-family, system-ui)",
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: "0.05em",
					textTransform: "uppercase",
					textAlign: "left",
					width: "100%",
				}}
				type="button">
				<span
					className="codicon codicon-chevron-right"
					style={{
						fontSize: 12,
						transition: "transform 0.15s ease",
						transform: open ? "rotate(90deg)" : "rotate(0deg)",
						opacity: 0.7,
					}}
				/>
				{icon && <span className={`codicon codicon-${icon}`} style={{ fontSize: 13, opacity: 0.85 }} />}
				<span style={{ flex: 1 }}>{title}</span>
				{headerAction && (
					<span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center" }}>
						{headerAction}
					</span>
				)}
				{badge && (
					<span
						style={{
							fontSize: 10,
							padding: "1px 6px",
							borderRadius: 10,
							background: "var(--vscode-badge-background, rgba(0,221,255,0.18))",
							color: "var(--vscode-badge-foreground, #7dd3fc)",
							fontWeight: 600,
							letterSpacing: "normal",
							textTransform: "none",
						}}>
						{badge}
					</span>
				)}
			</button>

			{/* Body — collapsed via max-height for smooth animation */}
			<div
				style={{
					maxHeight: open ? "70vh" : 0,
					overflow: open ? "auto" : "hidden",
					transition: "max-height 0.2s ease",
					opacity: open ? 1 : 0,
				}}>
				{open && <div style={{ padding: "4px 0 8px" }}>{children}</div>}
			</div>
		</div>
	)
}
