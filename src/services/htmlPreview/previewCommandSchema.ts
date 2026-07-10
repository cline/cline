import { z } from "zod"

/**
 * Validates JSON command files dropped by Python MCP tools into
 * ~/.aihydro/preview_commands/ before PreviewCommandWatcher acts on them
 * (audit finding E-9). This channel is local-only and unauthenticated by
 * design — any process running as the current user can write here — so
 * schema validation is defence-in-depth against malformed payloads, not an
 * auth boundary. `.passthrough()` preserves forward-compat with command
 * types this schema doesn't know about yet (the original interface had a
 * `[key: string]: unknown` catch-all).
 */
export const previewCommandSchema = z
	.object({
		type: z.string().min(1),
		module_id: z.string().optional(),
		cell_id: z.string().optional(),
		section_id: z.string().optional(),
		new_html: z.string().optional(),
		comment_id: z.string().optional(),
		new_text: z.string().optional(),
	})
	.passthrough()

export type PreviewCommandPayload = z.infer<typeof previewCommandSchema>
