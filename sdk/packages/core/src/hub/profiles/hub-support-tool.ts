/**
 * `cline_hub_support` — the Hub-native port of the Gateway's Cline Support
 * plugin. Injected into session runtimes when the active bot profile asks
 * for it (Cline Dad does), it gives the agent read-only self-diagnostics:
 *
 * - `status`:   liveness, drain state, active turns, queue depth, event log
 * - `config`:   effective owner context, data paths, capabilities, profile
 * - `sessions`: registered sessions with their current states
 * - `runs`:     recent durable queue runs (state, errors, timing)
 * - `logs`:     redacted tail of hub-daemon.log
 *
 * Everything is read-only and secret-free: auth tokens, bearer headers, and
 * key-shaped strings are redacted before anything reaches the model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { z } from "zod";

export const HUB_SUPPORT_TOOL_NAME = "cline_hub_support";

const HubSupportInputSchema = z.object({
	query: z.enum(["status", "config", "sessions", "runs", "logs"]),
	/** Max rows for `sessions`/`runs` (default 20, cap 100). */
	limit: z.number().int().positive().max(100).optional(),
	/** Tail length for `logs` (default 80, cap 400 lines). */
	lines: z.number().int().positive().max(400).optional(),
});

export type HubSupportInput = z.infer<typeof HubSupportInputSchema>;

export interface HubSupportToolResult {
	ok: boolean;
	query?: HubSupportInput["query"];
	result?: unknown;
	error?: string;
}

export interface HubSupportToolDeps {
	getStatus: () => Record<string, unknown>;
	describeConfig: () => Record<string, unknown>;
	listSessions: () => Promise<readonly Record<string, unknown>[]>;
	listRuns: (limit: number) => readonly Record<string, unknown>[];
	/** Override for tests; defaults to `<data>/logs/hub-daemon.log`. */
	logPath?: string;
}

/**
 * Redact secret-shaped material: bearer headers, `authToken`-style JSON
 * fields, and long hex/base64url blobs (hub tokens are 64 hex chars).
 */
export function redactHubSecrets(text: string): string {
	return text
		.replace(/(authorization"?\s*[:=]\s*"?bearer\s+)[^\s"']+/gi, "$1[redacted]")
		.replace(
			/("(?:authToken|apiKey|token|secret)"\s*:\s*")[^"]+(")/gi,
			"$1[redacted]$2",
		)
		.replace(/\b[0-9a-f]{48,}\b/gi, "[redacted]")
		.replace(/\b[A-Za-z0-9_-]{43,}\b/g, "[redacted]");
}

function readLogTail(logPath: string, lines: number): string {
	let raw: string;
	try {
		raw = readFileSync(logPath, "utf8");
	} catch {
		return `No hub log found at ${logPath}. A hub launched in the foreground writes to its own stderr instead.`;
	}
	const tail = raw.split("\n").slice(-lines).join("\n");
	return redactHubSecrets(tail);
}

export function createHubSupportTool(
	deps: HubSupportToolDeps,
): AgentTool<HubSupportInput, HubSupportToolResult> {
	return createTool<HubSupportInput, HubSupportToolResult>({
		name: HUB_SUPPORT_TOOL_NAME,
		description:
			"Read-only Cline Hub diagnostics for self-service debugging and user support. " +
			'Queries: "status" (liveness, drain state, active turns, run-queue depth, event-log cursor), ' +
			'"config" (effective hub paths, capabilities, active bot profile), ' +
			'"sessions" (registered sessions and their states), ' +
			'"runs" (recent durable queue runs with states and errors), ' +
			'"logs" (redacted hub-daemon.log tail). ' +
			"Diagnose with these before retrying failed work or asking the user to intervene. " +
			"Output never contains credentials.",
		inputSchema: zodToJsonSchema(HubSupportInputSchema),
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput): Promise<HubSupportToolResult> => {
			const parsed = HubSupportInputSchema.safeParse(rawInput);
			if (!parsed.success) {
				return {
					ok: false,
					error: parsed.error.issues[0]?.message ?? "Invalid hub support input",
				};
			}
			const input = parsed.data;
			try {
				switch (input.query) {
					case "status":
						return { ok: true, query: input.query, result: deps.getStatus() };
					case "config":
						return {
							ok: true,
							query: input.query,
							result: deps.describeConfig(),
						};
					case "sessions": {
						const sessions = await deps.listSessions();
						return {
							ok: true,
							query: input.query,
							result: sessions.slice(0, input.limit ?? 20).map((session) => ({
								sessionId: session.sessionId,
								status: session.status,
								interactive: session.interactive,
								provider: session.provider,
								model: session.model,
								workspaceRoot: session.workspaceRoot,
								startedAt: session.startedAt,
								updatedAt: session.updatedAt,
							})),
						};
					}
					case "runs":
						return {
							ok: true,
							query: input.query,
							result: deps.listRuns(input.limit ?? 20),
						};
					case "logs":
						return {
							ok: true,
							query: input.query,
							result: readLogTail(
								deps.logPath ??
									join(resolveClineDataDir(), "logs", "hub-daemon.log"),
								input.lines ?? 80,
							),
						};
				}
			} catch (error) {
				return {
					ok: false,
					query: input.query,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	});
}
