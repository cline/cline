/**
 * EditModeToolbar — floats below the HTML Preview toolbar.
 *
 * Shown only when Edit Mode is active (toggled via the `editModeActive` prop).
 * Sends an `aihydro-edit-mode` postMessage into the iframe so the editor
 * adapter (aihydro-bridge/editor-adapter.ts) can react.
 *
 * Phase 4 — prose-only edit mode + comment-and-send-to-agent flow.
 */

import React from "react"

interface EditModeToolbarProps {
	editModeActive: boolean
	onToggle: (active: boolean) => void
	iframeRef: React.RefObject<HTMLIFrameElement | null>
}

export const EditModeToolbar: React.FC<EditModeToolbarProps> = ({ editModeActive, onToggle, iframeRef }) => {
	const handleToggle = () => {
		const next = !editModeActive
		onToggle(next)
		// Tell the iframe editor adapter about the new state
		const win = iframeRef.current?.contentWindow
		if (win) {
			win.postMessage({ type: "aihydro-edit-mode", enabled: next }, "*")
		}
	}

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "6px 12px",
				background: editModeActive ? "rgba(0,221,255,0.08)" : "transparent",
				borderTop: "1px solid rgba(125,211,252,0.12)",
				borderBottom: editModeActive ? "1px solid rgba(0,221,255,0.2)" : "none",
				flexShrink: 0,
			}}>
			{/* Edit Mode toggle button */}
			<button
				onClick={handleToggle}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					padding: "5px 12px",
					borderRadius: "8px",
					border: "1px solid " + (editModeActive ? "rgba(0,221,255,0.6)" : "rgba(125,211,252,0.25)"),
					background: editModeActive
						? "linear-gradient(135deg, rgba(0,163,255,0.2), rgba(0,221,255,0.15))"
						: "transparent",
					color: editModeActive ? "#00DDFF" : "#94a3b8",
					cursor: "pointer",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: "12px",
					fontWeight: editModeActive ? 600 : 400,
					transition: "all 0.15s",
				}}
				title={editModeActive ? "Exit Edit Mode" : "Enter Edit Mode — edit prose, add comments"}>
				<span style={{ fontSize: "14px" }}>✏️</span>
				{editModeActive ? "Exit Edit Mode" : "Edit Mode"}
			</button>

			{editModeActive && (
				<>
					{/* Scope indicator */}
					<span
						style={{
							fontSize: "11px",
							color: "#94a3b8",
							fontFamily: "Nunito, system-ui, sans-serif",
						}}>
						Prose sections editable · Select text to add a comment
					</span>

					{/* Separator */}
					<div
						style={{
							flex: 1,
						}}
					/>

					{/* Help chip */}
					<span
						style={{
							fontSize: "10px",
							padding: "3px 8px",
							borderRadius: "20px",
							background: "rgba(251,191,36,0.12)",
							color: "#fbbf24",
							border: "1px solid rgba(251,191,36,0.25)",
							fontFamily: "Nunito, system-ui, sans-serif",
						}}>
						Agent reviews all changes before applying
					</span>
				</>
			)}
		</div>
	)
}
