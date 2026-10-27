import type { HandoffGitPreview } from "@cline/core/cloud"

export type CloudHandoffView = { id: string; sourceTaskId: string } & (
	| { phase: "preparing" }
	| {
			phase: "ready"
			git: HandoffGitPreview
			modelId: string
			organizationName: string
			instruction: string
			imageCount: number
	  }
	| { phase: "launching"; sessionId?: string }
	| { phase: "complete"; sessionId: string; delivery: "sent" | "unsent" | "unconfirmed"; message?: string }
	| { phase: "failed"; message: string }
)

export function parseCloudCommand(text: string): string | undefined {
	const match = /^\/cloud(?:\s+([\s\S]*))?$/i.exec(text.trim())
	return match ? (match[1] ?? "").trim() : undefined
}
