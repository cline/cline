import { z } from "zod";
import { SESSION_STATUSES } from "../types/common";

const SessionStatusSchema = z.enum(SESSION_STATUSES);

export const SessionManifestSchema = z.object({
	version: z.literal(1),
	session_id: z.string().min(1),
	source: z.string().min(1),
	pid: z.number().int(),
	started_at: z.string().min(1),
	ended_at: z.string().min(1).optional(),
	exit_code: z.number().int().nullable().optional(),
	status: SessionStatusSchema,
	interactive: z.boolean(),
	provider: z.string().min(1),
	model: z.string().min(1),
	cwd: z.string().min(1),
	workspace_root: z.string().min(1),
	team_name: z.string().min(1).optional(),
	enable_tools: z.boolean(),
	enable_spawn: z.boolean(),
	enable_teams: z.boolean(),
	prompt: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	messages_path: z.string().min(1).optional(),
});

export type SessionManifest = z.infer<typeof SessionManifestSchema>;
