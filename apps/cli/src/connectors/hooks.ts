import { runSubprocessEvent } from "@cline/core";
import type {
	ConnectorAuthorizationDecision,
	ConnectorAuthorizationRequest,
	ConnectorHookEvent,
} from "@cline/shared";
import { z } from "zod";
import type { CliLoggerAdapter } from "../logging/adapter";

const ConnectorAuthorizationDecisionSchema = z.object({
	action: z.enum(["allow", "deny"]).default("allow"),
	message: z.string().optional(),
	reason: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function dispatchConnectorHook(
	command: string | undefined,
	hookPayload: ConnectorHookEvent,
	logger: CliLoggerAdapter,
): Promise<void> {
	const trimmed = command?.trim();
	if (!trimmed) {
		return;
	}

	try {
		const shell = process.env.SHELL?.trim() || "sh";
		const result = await runSubprocessEvent(hookPayload, {
			command: [shell, "-lc", trimmed],
			cwd: process.cwd(),
			env: process.env,
			onSpawn: ({ command, pid, detached }) => {
				logger.core.log("Process spawned", {
					component: "connector-hooks",
					command: command.join(" "),
					commandArgs: command.slice(1),
					executable: command[0],
					childPid: pid,
					cwd: process.cwd(),
					detached,
					adapter: hookPayload.adapter,
					event: hookPayload.event,
				});
			},
		});
		if ((result?.exitCode ?? 0) !== 0) {
			logger.core.log("Connector hook exited non-zero", {
				severity: "warn",
				adapter: hookPayload.adapter,
				event: hookPayload.event,
				code: result?.exitCode,
				stderr: result?.stderr.trim() || undefined,
			});
		}
	} catch (error) {
		logger.core.log("Connector hook dispatch failed", {
			severity: "warn",
			adapter: hookPayload.adapter,
			event: hookPayload.event,
			error,
		});
	}
}

export async function authorizeConnectorEvent(
	command: string | undefined,
	input: {
		adapter: string;
		botUserName?: string;
		request: ConnectorAuthorizationRequest;
	},
	logger: CliLoggerAdapter,
): Promise<ConnectorAuthorizationDecision> {
	const trimmed = command?.trim();
	if (!trimmed) {
		return { action: "allow" };
	}

	try {
		const shell = process.env.SHELL?.trim() || "sh";
		const result = await runSubprocessEvent(
			{
				adapter: input.adapter,
				botUserName: input.botUserName,
				event: "session.authorize",
				payload: input.request,
				ts: new Date().toISOString(),
			} satisfies ConnectorHookEvent,
			{
				command: [shell, "-lc", trimmed],
				cwd: process.cwd(),
				env: process.env,
				onSpawn: ({ command, pid, detached }) => {
					logger.core.log("Process spawned", {
						component: "connector-hooks",
						command: command.join(" "),
						commandArgs: command.slice(1),
						executable: command[0],
						childPid: pid,
						cwd: process.cwd(),
						detached,
						adapter: input.adapter,
						event: "session.authorize",
					});
				},
			},
		);

		const parsed = ConnectorAuthorizationDecisionSchema.safeParse(
			result?.parsedJson,
		);
		if (parsed.success) {
			return parsed.data;
		}
		if ((result?.exitCode ?? 0) !== 0) {
			logger.core.log("Connector authorization hook exited non-zero", {
				severity: "warn",
				adapter: input.adapter,
				event: "session.authorize",
				code: result?.exitCode,
				stderr: result?.stderr.trim() || undefined,
			});
		}
		if (result?.parseError || result?.stdout.trim()) {
			logger.core.log("Connector authorization hook returned invalid control", {
				severity: "warn",
				adapter: input.adapter,
				event: "session.authorize",
				parseError: result?.parseError,
				stdout: result?.stdout.trim() || undefined,
			});
		}
	} catch (error) {
		logger.core.log("Connector authorization hook dispatch failed", {
			severity: "warn",
			adapter: input.adapter,
			event: "session.authorize",
			error,
		});
	}
	return { action: "allow" };
}
