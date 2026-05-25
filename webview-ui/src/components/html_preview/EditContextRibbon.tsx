/**
 * EditContextRibbon — context-aware secondary ribbon that appears
 * ONLY when Edit Mode is active. Replaces the always-on EditModeToolbar.
 *
 * Layout (left → right):
 *   [B I U]  [H1 H2 H3]  [• ≡]  [🔗]   │   💬 N pending   │   💾 Save   ▶ Send N changes to agent   ✕
 *
 * Format buttons post `editor-command` messages into the iframe (handled by
 * editor-adapter.ts via document.execCommand for zero-dependency portability).
 * The save button persists prose edits to disk (enabled when hasPendingTextEdits).
 * The send button fires when at least one comment/edit is pending; clicking it
 * emits a single `user.batch_changes` event and opens the agent chat.
 */

import React, { useState } from "react"

interface EditContextRibbonProps {
	iframeRef: React.RefObject<HTMLIFrameElement | null>
	pendingCount: number
	onSendBatch: () => void
	onExit: () => void
	/** Called when user clicks the Save button — persists prose edits to disk */
	onSave: () => Promise<boolean>
	/** True when contenteditable prose edits have been made but not yet saved */
	hasPendingTextEdits: boolean
	/** True while a save is in progress (disables the Save button) */
	isSaving?: boolean
}

const BORDER = "var(--vscode-panel-border, rgba(125,211,252,0.18))"

// ─── Format button ────────────────────────────────────────────────────────────
const FormatBtn: React.FC<{
	icon: string
	command: string
	title: string
	iframeRef: React.RefObject<HTMLIFrameElement | null>
	value?: string
}> = ({ icon, command, title, iframeRef, value }) => {
	const [hovered, setHovered] = useState(false)
	const handleClick = () => {
		const win = iframeRef.current?.contentWindow
		if (!win) return
		win.postMessage({ type: "aihydro-editor-command", command, value }, "*")
	}
	return (
		<button
			onClick={handleClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: 26,
				height: 22,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 0,
				background: hovered ? "rgba(0,221,255,0.10)" : "transparent",
				border: `1px solid ${hovered ? "rgba(0,221,255,0.35)" : "transparent"}`,
				borderRadius: 4,
				color: "var(--vscode-foreground, #ddd)",
				cursor: "pointer",
				flexShrink: 0,
				fontFamily: "Poppins, system-ui, sans-serif",
				fontSize: 11,
				fontWeight: 600,
			}}
			title={title}
			type="button">
			<span className={`codicon codicon-${icon}`} style={{ fontSize: 13 }} />
		</button>
	)
}

const FormatGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: 1,
			padding: "0 2px",
			background: "rgba(255,255,255,0.03)",
			border: `1px solid ${BORDER}`,
			borderRadius: 5,
		}}>
		{children}
	</div>
)

const GroupDivider = () => <span style={{ width: 1, height: 16, background: BORDER, flexShrink: 0, margin: "0 4px" }} />

export const EditContextRibbon: React.FC<EditContextRibbonProps> = ({
	iframeRef,
	pendingCount,
	onSendBatch,
	onExit,
	onSave,
	hasPendingTextEdits,
	isSaving = false,
}) => {
	const canSend = pendingCount > 0
	const canSave = hasPendingTextEdits && !isSaving

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "5px 10px",
				background: "linear-gradient(180deg, rgba(0,221,255,0.08), rgba(0,163,255,0.04))",
				borderBottom: `1px solid rgba(0,221,255,0.25)`,
				flexShrink: 0,
				minHeight: 34,
				boxSizing: "border-box",
			}}>
			{/* Inline styling group */}
			<FormatGroup>
				<FormatBtn command="bold" icon="bold" iframeRef={iframeRef} title="Bold (Cmd/Ctrl+B)" />
				<FormatBtn command="italic" icon="italic" iframeRef={iframeRef} title="Italic (Cmd/Ctrl+I)" />
				<FormatBtn command="underline" icon="text-size" iframeRef={iframeRef} title="Underline (Cmd/Ctrl+U)" />
			</FormatGroup>

			{/* Heading group */}
			<FormatGroup>
				<FormatBtn command="formatBlock" icon="symbol-key" iframeRef={iframeRef} title="Heading 2" value="h2" />
				<FormatBtn command="formatBlock" icon="symbol-string" iframeRef={iframeRef} title="Heading 3" value="h3" />
				<FormatBtn command="formatBlock" icon="symbol-text" iframeRef={iframeRef} title="Paragraph" value="p" />
			</FormatGroup>

			{/* List group */}
			<FormatGroup>
				<FormatBtn command="insertUnorderedList" icon="list-unordered" iframeRef={iframeRef} title="Bulleted list" />
				<FormatBtn command="insertOrderedList" icon="list-ordered" iframeRef={iframeRef} title="Numbered list" />
			</FormatGroup>

			{/* Link */}
			<FormatBtn command="aihydro-link" icon="link" iframeRef={iframeRef} title="Insert/edit link" />

			{/* Pending counter */}
			<GroupDivider />
			<span
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
					fontSize: 11,
					color: pendingCount > 0 ? "#00DDFF" : "var(--vscode-descriptionForeground, #888)",
					fontFamily: "Nunito, system-ui, sans-serif",
				}}>
				<span className="codicon codicon-comment-discussion" style={{ fontSize: 13 }} />
				{pendingCount === 0 ? "Select text or click a component to comment" : `${pendingCount} pending`}
			</span>

			{/* Spacer */}
			<div style={{ flex: 1 }} />

			{/* Save prose edits to disk */}
			<button
				disabled={!canSave}
				onClick={() => void onSave()}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
					padding: "4px 11px",
					height: 26,
					borderRadius: 6,
					border: `1px solid ${canSave ? "rgba(0,221,255,0.4)" : "rgba(125,211,252,0.12)"}`,
					background: canSave ? "rgba(0,221,255,0.10)" : "transparent",
					color: canSave ? "#00DDFF" : "var(--vscode-descriptionForeground, #666)",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 11,
					fontWeight: 600,
					cursor: canSave ? "pointer" : "not-allowed",
					opacity: canSave ? 1 : 0.5,
					transition: "all 0.15s",
					flexShrink: 0,
				}}
				title={isSaving ? "Saving…" : hasPendingTextEdits ? "Save prose edits to disk" : "No unsaved prose edits"}
				type="button">
				<span className="codicon codicon-save" style={{ fontSize: 12 }} />
				{isSaving ? "Saving…" : "Save"}
			</button>

			{/* Send batch to agent */}
			<button
				disabled={!canSend}
				onClick={onSendBatch}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					padding: "5px 12px",
					height: 26,
					borderRadius: 13,
					border: "none",
					background: canSend
						? "linear-gradient(135deg, #00A3FF, #00DDFF)"
						: "var(--vscode-button-secondaryBackground, rgba(125,211,252,0.12))",
					color: canSend ? "#0a0a15" : "var(--vscode-descriptionForeground, #888)",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 11,
					fontWeight: 700,
					cursor: canSend ? "pointer" : "not-allowed",
					opacity: canSend ? 1 : 0.6,
					transition: "all 0.15s",
					flexShrink: 0,
				}}
				title={canSend ? "Send all pending changes to the agent in one batch" : "Make a change or add a comment first"}
				type="button">
				<span className="codicon codicon-send" style={{ fontSize: 12 }} />
				{canSend ? `Send ${pendingCount} change${pendingCount === 1 ? "" : "s"} to agent` : "Nothing to send"}
			</button>

			{/* Exit edit mode */}
			<button
				onClick={onExit}
				onMouseEnter={(e) => {
					;(e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"
				}}
				onMouseLeave={(e) => {
					;(e.currentTarget as HTMLElement).style.background = "transparent"
				}}
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 24,
					height: 24,
					borderRadius: 4,
					background: "transparent",
					border: "1px solid transparent",
					color: "var(--vscode-foreground, #ddd)",
					cursor: "pointer",
					flexShrink: 0,
				}}
				title="Exit Edit Mode"
				type="button">
				<span className="codicon codicon-close" style={{ fontSize: 12 }} />
			</button>
		</div>
	)
}
