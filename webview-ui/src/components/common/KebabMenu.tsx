/**
 * KebabMenu — overflow menu for toolbar actions used less than ~5% of the time.
 *
 * Uses @floating-ui/react for positioning (already a project dependency).
 * Renders a Codicon kebab-vertical button by default; pass a custom trigger if needed.
 *
 * Why this exists:
 *   The HtmlPreviewToolbar had ~15 buttons crammed in one row. Low-frequency
 *   utilities (probe, copy path, reload, open in editor/browser, diagnostics,
 *   close, restart kernel) live here so the main row only shows the 5-8 actions
 *   used in 80% of sessions.
 *
 * Usage:
 *   <KebabMenu items={[
 *     { label: "Reload", icon: "refresh", onClick: handleReload },
 *     { label: "Open in browser", icon: "link-external", onClick: handleOpen },
 *     { label: "Remove", icon: "close", onClick: handleClose, danger: true },
 *   ]} />
 */

import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export interface KebabMenuItem {
	/** Visible label */
	label: string
	/** Codicon name without the `codicon-` prefix, e.g. "refresh" */
	icon?: string
	onClick: () => void
	disabled?: boolean
	/** Render with destructive styling (red) */
	danger?: boolean
	/** Show a divider above this item */
	divider?: boolean
	/** Show a check mark to indicate an active toggle state */
	active?: boolean
}

interface KebabMenuProps {
	items: KebabMenuItem[]
	/** Override the trigger button content (default: kebab-vertical icon) */
	trigger?: React.ReactNode
	title?: string
}

export const KebabMenu: React.FC<KebabMenuProps> = ({ items, trigger, title }) => {
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)

	const { refs, floatingStyles } = useFloating({
		placement: "bottom-end",
		whileElementsMounted: autoUpdate,
		middleware: [offset(4), flip(), shift({ padding: 8 })],
	})

	// Close on outside click / ESC
	useEffect(() => {
		if (!open) {
			return
		}
		const onDocClick = (e: MouseEvent) => {
			const target = e.target as Node
			if (triggerRef.current?.contains(target)) {
				return
			}
			if ((refs.floating.current as HTMLElement | null)?.contains(target)) {
				return
			}
			setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", onDocClick)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("mousedown", onDocClick)
			document.removeEventListener("keydown", onKey)
		}
	}, [open, refs.floating])

	const setRefs = useCallback(
		(node: HTMLButtonElement | null) => {
			triggerRef.current = node
			refs.setReference(node)
		},
		[refs],
	)

	const handleItem = (item: KebabMenuItem) => {
		if (item.disabled) {
			return
		}
		setOpen(false)
		item.onClick()
	}

	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={() => setOpen((v) => !v)}
				ref={setRefs}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 26,
					height: 26,
					padding: 0,
					flexShrink: 0,
					background: open ? "var(--vscode-toolbar-activeBackground, rgba(125,211,252,0.12))" : "transparent",
					border: "none",
					borderRadius: 4,
					color: "var(--vscode-foreground, #ddd)",
					cursor: "pointer",
				}}
				title={title ?? "More actions"}
				type="button">
				{trigger ?? <span className="codicon codicon-kebab-vertical" style={{ fontSize: 14 }} />}
			</button>
			{open &&
				createPortal(
					<div
						ref={refs.setFloating}
						role="menu"
						style={{
							...floatingStyles,
							zIndex: 1000,
							minWidth: 220,
							background: "var(--vscode-menu-background, #252526)",
							border: "1px solid var(--vscode-menu-border, rgba(125,211,252,0.18))",
							borderRadius: 6,
							boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
							padding: "4px 0",
							fontFamily: "var(--vscode-font-family, system-ui)",
							fontSize: 13,
						}}>
						{items.map((item, idx) => (
							<div key={`${item.label}-${idx}`}>
								{item.divider && (
									<div
										style={{
											height: 1,
											margin: "4px 0",
											background: "var(--vscode-menu-separatorBackground, rgba(125,211,252,0.12))",
										}}
									/>
								)}
								<button
									disabled={item.disabled}
									onClick={() => handleItem(item)}
									onMouseEnter={(e) => {
										if (!item.disabled) {
											;(e.currentTarget as HTMLElement).style.background =
												"var(--vscode-menu-selectionBackground, rgba(0,221,255,0.12))"
										}
									}}
									onMouseLeave={(e) => {
										;(e.currentTarget as HTMLElement).style.background = "transparent"
									}}
									role="menuitem"
									style={{
										display: "flex",
										alignItems: "center",
										gap: 10,
										width: "100%",
										padding: "6px 12px",
										border: "none",
										background: "transparent",
										color: item.danger
											? "var(--vscode-errorForeground, #f48771)"
											: "var(--vscode-menu-foreground, #cccccc)",
										cursor: item.disabled ? "not-allowed" : "pointer",
										opacity: item.disabled ? 0.5 : 1,
										textAlign: "left",
										fontFamily: "inherit",
										fontSize: "inherit",
									}}>
									{item.icon ? (
										<span
											className={`codicon codicon-${item.icon}`}
											style={{ fontSize: 14, width: 16, opacity: 0.9 }}
										/>
									) : (
										<span style={{ width: 16 }} />
									)}
									<span style={{ flex: 1 }}>{item.label}</span>
									{item.active && (
										<span className="codicon codicon-check" style={{ fontSize: 12, opacity: 0.7 }} />
									)}
								</button>
							</div>
						))}
					</div>,
					document.body,
				)}
		</>
	)
}
