/**
 * Locked AgentRef union (DEC-agent-source-of-truth).
 *
 * `configured` is migration-only — lint should warn; no new writes.
 */

import { z } from "zod";

/** Workspace / user home slug: `[a-z0-9-]+`. */
export const DriveagentSlugSchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9-]+$/, "Driveagent slug must match [a-z0-9-]+");
export type DriveagentSlug = z.infer<typeof DriveagentSlugSchema>;

export const AgentRefSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("driveagent"),
			slug: DriveagentSlugSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("builtin"),
			id: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("configured"),
			id: z.string().min(1),
		})
		.strict(),
]);
export type AgentRef = z.infer<typeof AgentRefSchema>;

export function parseAgentRef(input: unknown): AgentRef {
	return AgentRefSchema.parse(input);
}

/**
 * Exhaustive helper for switches on `ref.kind`.
 */
export function assertNeverAgentRef(ref: never): never {
	throw new Error(`Unhandled AgentRef: ${JSON.stringify(ref satisfies never)}`);
}
