/**
 * CommentSidebar — pending comments + draft batch for the active module.
 *
 * Lives in the Files/Modules/Skills/Comments accordion stack.  Listens to
 * `aihydro-preview-event` messages of kind `user.comment.draft`,
 * `user.batch_changes`, and `user.batch.cleared` to maintain a running
 * list of pending changes.
 *
 * Each entry is a card showing:
 *   - Quoted text (for text comments) OR component label (for cell/map/figure)
 *   - The user's comment body
 *   - A "Remove" action that posts a remove command into the iframe
 *
 * A primary **"Send N changes to agent"** button at the top mirrors the
 * EditContextRibbon's button so the user can fire the batch from either UI.
 */

import React, { useCallback, useEffect, useState } from "react"

interface PendingComment {
	id: string
	type: "comment" | "text"
	target: "text" | "component"
	body: string
	anchor?: { quote?: string }
	component?: { kind?: string; id?: string }
	createdAt: number
}

interface CommentSidebarProps {
	moduleId: string
	iframeWindow?: Window | null
}

export const CommentSidebar: React.FC<CommentSidebarProps> = ({ moduleId, iframeWindow }) => {
	const [pending, setPending] = useState<PendingComment[]>([])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data as { type?: string; kind?: string; payloadJson?: string; moduleId?: string }
			if (!data || data.type !== "aihydro-preview-event") return
			if (data.moduleId && data.moduleId !== moduleId) return

			let payload: Record<string, unknown> = {}
			try {
				payload = data.payloadJson ? JSON.parse(data.payloadJson) : {}
			} catch {
				/* ignore */
			}

			if (data.kind === "user.comment.draft") {
				setPending((list) => [...list, payload as unknown as PendingComment])
			} else if (data.kind === "user.batch_changes" || data.kind === "user.batch.cleared") {
				setPending([])
			} else if (data.kind === "edit.toggled" && payload?.enabled === false) {
				// Edit Mode was turned off — drop drafts
				setPending([])
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [moduleId])

	const handleSend = useCallback(() => {
		if (!iframeWindow) return
		iframeWindow.postMessage({ type: "aihydro-send-batch" }, "*")
	}, [iframeWindow])

	const handleClear = useCallback(() => {
		if (!iframeWindow) return
		iframeWindow.postMessage({ type: "aihydro-clear-batch" }, "*")
	}, [iframeWindow])

	if (pending.length === 0) {
		return (
			<div
				style={{
					padding: "16px 12px",
					fontSize: 11,
					color: "var(--vscode-descriptionForeground, #888)",
					lineHeight: 1.5,
				}}>
				No pending comments.
				<br />
				<span style={{ opacity: 0.7 }}>
					Enter <b>Edit Mode</b>, then select text or click any cell/map/figure to add a comment.
				</span>
			</div>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px" }}>
			{/* Send batch primary button */}
			<button
				onClick={handleSend}
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					padding: "7px 10px",
					borderRadius: 8,
					border: "none",
					background: "linear-gradient(135deg, #00A3FF, #00DDFF)",
					color: "#0a0a15",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 11,
					fontWeight: 700,
					cursor: "pointer",
				}}
				type="button">
				<span className="codicon codicon-send" style={{ fontSize: 12 }} />
				Send {pending.length} change{pending.length === 1 ? "" : "s"} to agent
			</button>

			{/* Pending list */}
			{pending.map((p) => (
				<div
					key={p.id}
					style={{
						background: "rgba(15,15,30,0.5)",
						border: "1px solid rgba(125,211,252,0.18)",
						borderRadius: 8,
						padding: 8,
						fontFamily: "Nunito, system-ui, sans-serif",
					}}>
					<div
						style={{
							fontSize: 10,
							color: "#00DDFF",
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							marginBottom: 4,
						}}>
						{p.target === "component"
							? `${p.component?.kind ?? "Component"}${p.component?.id ? `: ${p.component.id}` : ""}`
							: "Text comment"}
					</div>
					{p.target === "text" && p.anchor?.quote && (
						<div
							style={{
								fontSize: 11,
								color: "#94a3b8",
								fontStyle: "italic",
								marginBottom: 4,
								borderLeft: "2px solid rgba(0,221,255,0.4)",
								paddingLeft: 6,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}>
							“{p.anchor.quote}”
						</div>
					)}
					<div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.4 }}>{p.body}</div>
				</div>
			))}

			{/* Clear all */}
			<button
				onClick={handleClear}
				style={{
					padding: "4px 8px",
					background: "transparent",
					border: "1px solid rgba(125,211,252,0.18)",
					borderRadius: 6,
					color: "#94a3b8",
					fontFamily: "Poppins, system-ui, sans-serif",
					fontSize: 10,
					cursor: "pointer",
					marginTop: 4,
				}}
				type="button">
				Clear all
			</button>
		</div>
	)
}
