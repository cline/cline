/**
 * EditContextRibbon — context-aware secondary ribbon that appears
 * ONLY when Edit Mode is active.
 *
 * Layout (left → right):
 *   ↩ ↪  │  [B I U]  [H2 H3 P]  [• ≡]  [🔗]   │   💬 N pending   │   💾 Save   ▶ Send N   ✕
 *
 * Undo/Redo:
 *   - ↩ Undo / ↪ Redo buttons live at the far left, enabled/disabled by
 *     `canUndo` / `canRedo` props (driven by the iframe's `edit.state` events,
 *     which query `document.queryCommandEnabled('undo/redo')` in real time).
 *   - Keyboard shortcuts ⌘Z / ⌘⇧Z are handled entirely in the iframe adapter
 *     (no extra wiring needed here).
 *
 * Format buttons post `aihydro-editor-command` messages into the iframe
 * (handled by editor-adapter.ts via document.execCommand). They do NOT trigger
 * text.changed — only actual DOM mutations from typing/paste/cut/execCommand
 * that produce a content delta fire the change event (via MutationObserver +
 * 'input' event in the adapter).
 *
 * Save button activates only when `hasPendingTextEdits` is true — i.e. only
 * after a real prose change has been detected.
 */

import React, { useState } from "react"

interface EditContextRibbonProps {
	iframeRef: React.RefObject<HTMLIFrameElement | null>
	pendingCount: number
	onSendBatch: () => void
	onExit: () => void
	/** Save prose edits to disk — resolves true on success */
	onSave: () => Promise<boolean>
	/** True when real prose DOM mutations have been detected (not just button clicks) */
	hasPendingTextEdits: boolean
	/** True while a save request is in-flight */
	isSaving?: boolean
	/** Whether the iframe's undo stack has items to undo */
	canUndo: boolean
	/** Whether the iframe's undo stack has items to redo */
	canRedo: boolean
}

const BORDER = "var(--vscode-panel-border, rgba(125,211,252,0.18))"

// ─── Format button (posts aihydro-editor-command to iframe) ──────────────────
const FormatBtn: React.FC<{
	icon?: string
	label?: string
	command: string
	title: string
	iframeRef: React.RefObject<HTMLIFrameElement | null>
	value?: string
	disabled?: boolean
}> = ({ icon, label, command, title, iframeRef, value, disabled = false }) => {
	const [hovered, setHovered] = useState(false)
	const handleClick = () => {
		if (disabled) {
			return
		}
		const win = iframeRef.current?.contentWindow
		if (!win) {
			return
		}
		win.postMessage({ type: "aihydro-editor-command", command, value }, "*")
	}
	return (
		<button
			disabled={disabled}
			onClick={handleClick}
			onMouseEnter={() => !disabled && setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				minWidth: 26,
				height: 22,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: label ? "0 6px" : 0,
				background: hovered && !disabled ? "rgba(0,221,255,0.10)" : "transparent",
				border: `1px solid ${hovered && !disabled ? "rgba(0,221,255,0.35)" : "transparent"}`,
				borderRadius: 4,
				color: disabled ? "var(--vscode-disabledForeground, #555)" : "var(--vscode-foreground, #ddd)",
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.4 : 1,
				flexShrink: 0,
				fontFamily: "Poppins, system-ui, sans-serif",
				fontSize: 11,
				fontWeight: 600,
				gap: 3,
				transition: "background 0.1s, opacity 0.1s",
			}}
			title={title}
			type="button">
			{icon && <span className={`codicon codicon-${icon}`} style={{ fontSize: 13 }} />}
			{label && <span>{label}</span>}
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
	canUndo,
	canRedo,
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
			{/* ── Undo / Redo ─────────────────────────────────────── */}
			<FormatGroup>
				<FormatBtn
					command="undo"
					disabled={!canUndo}
					icon="discard"
					iframeRef={iframeRef}
					title={canUndo ? "Undo (⌘Z)" : "Nothing to undo"}
				/>
				<FormatBtn
					command="redo"
					disabled={!canRedo}
					icon="redo"
					iframeRef={iframeRef}
					title={canRedo ? "Redo (⌘⇧Z)" : "Nothing to redo"}
				/>
			</FormatGroup>

			<GroupDivider />

			{/* ── Inline styling ───────────────────────────────────── */}
			<FormatGroup>
				<FormatBtn command="bold" icon="bold" iframeRef={iframeRef} title="Bold (⌘B)" />
				<FormatBtn command="italic" icon="italic" iframeRef={iframeRef} title="Italic (⌘I)" />
				<FormatBtn command="underline" icon="text-size" iframeRef={iframeRef} title="Underline (⌘U)" />
			</FormatGroup>

			{/* ── Headings / paragraph ─────────────────────────────── */}
			<FormatGroup>
				<FormatBtn command="formatBlock" icon="symbol-key" iframeRef={iframeRef} title="Heading 2" value="h2" />
				<FormatBtn command="formatBlock" icon="symbol-string" iframeRef={iframeRef} title="Heading 3" value="h3" />
				<FormatBtn command="formatBlock" icon="symbol-text" iframeRef={iframeRef} title="Paragraph" value="p" />
			</FormatGroup>

			{/* ── Lists ────────────────────────────────────────────── */}
			<FormatGroup>
				<FormatBtn command="insertUnorderedList" icon="list-unordered" iframeRef={iframeRef} title="Bulleted list" />
				<FormatBtn command="insertOrderedList" icon="list-ordered" iframeRef={iframeRef} title="Numbered list" />
			</FormatGroup>

			{/* ── Link ─────────────────────────────────────────────── */}
			<FormatBtn command="aihydro-link" icon="link" iframeRef={iframeRef} title="Insert / edit link" />

			{/* ── Pending comment count ─────────────────────────────── */}
			<GroupDivider />
			<span
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
					fontSize: 11,
					color: pendingCount > 0 ? "#00DDFF" : "var(--vscode-descriptionForeground, #888)",
					fontFamily: "Nunito, system-ui, sans-serif",
					flexShrink: 0,
				}}>
				<span className="codicon codicon-comment-discussion" style={{ fontSize: 13 }} />
				{pendingCount === 0 ? "Select text or click a component to comment" : `${pendingCount} pending`}
			</span>

			<div style={{ flex: 1 }} />

			{/* ── Save prose edits ─────────────────────────────────── */}
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
					border: `1px solid ${
						canSave ? "rgba(0,221,255,0.4)" : hasPendingTextEdits ? "rgba(0,221,255,0.2)" : "rgba(125,211,252,0.12)"
					}`,
					background: canSave ? "rgba(0,221,255,0.10)" : "transparent",
					color: canSave ? "#00DDFF" : "var(--vscode-descriptionForeground, #555)",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 11,
					fontWeight: 600,
					cursor: canSave ? "pointer" : "not-allowed",
					opacity: canSave ? 1 : hasPendingTextEdits ? 0.6 : 0.35,
					transition: "all 0.15s",
					flexShrink: 0,
				}}
				title={
					isSaving
						? "Saving…"
						: hasPendingTextEdits
							? "Save prose edits to disk (overwrites the HTML file)"
							: "No unsaved prose edits — make a change first"
				}
				type="button">
				<span className="codicon codicon-save" style={{ fontSize: 12 }} />
				{isSaving ? "Saving…" : "Save"}
			</button>

			{/* ── Send batch to agent ───────────────────────────────── */}
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
						: "var(--vscode-button-secondaryBackground, rgba(125,211,252,0.10))",
					color: canSend ? "#0a0a15" : "var(--vscode-descriptionForeground, #666)",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 11,
					fontWeight: 700,
					cursor: canSend ? "pointer" : "not-allowed",
					opacity: canSend ? 1 : 0.5,
					transition: "all 0.15s",
					flexShrink: 0,
				}}
				title={
					canSend
						? "Send all pending changes to the AI-Hydro agent in one batch"
						: "Add a comment or make a change first"
				}
				type="button">
				<span className="codicon codicon-send" style={{ fontSize: 12 }} />
				{canSend ? `Send ${pendingCount} change${pendingCount === 1 ? "" : "s"} to agent` : "Nothing to send"}
			</button>

			{/* ── Exit edit mode ────────────────────────────────────── */}
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
					transition: "background 0.1s",
				}}
				title={hasPendingTextEdits ? "Exit Edit Mode (unsaved changes)" : "Exit Edit Mode"}
				type="button">
				<span className="codicon codicon-close" style={{ fontSize: 12 }} />
			</button>
		</div>
	)
}
