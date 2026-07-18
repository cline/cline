import { runSubprocessEvent } from "@cline/core";
import type {
	ConnectorAuthorizationDecision,
	ConnectorAuthorizationRequest,
	ConnectorHookEvent,
} from "@cline/shared";
import { z } from "zod";
import type { CliLoggerAdapter } from "../logging/adapter";

const ConnectorAuthorizationDecisionSchema = z.object({
	action: z.enum(["allow", "deny"]),
	message: z.string().optional(),
	reason: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

const AUTHORIZATION_HOOK_FAILURE: ConnectorAuthorizationDecision = {
	action: "deny",
	message: "Authorization check failed. Please try again later.",
	reason: "authorization_hook_failed",
};

export interface ConnectorHookDependencies {
	runSubprocessEvent: typeof runSubprocessEvent;
}

const DEFAULT_CONNECTOR_HOOK_DEPENDENCIES: ConnectorHookDependencies = {
	runSubprocessEvent,
};

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
	dependencies: ConnectorHookDependencies = DEFAULT_CONNECTOR_HOOK_DEPENDENCIES,
): Promise<ConnectorAuthorizationDecision> {
	const trimmed = command?.trim();
	if (!trimmed) {
		return { action: "allow" };
	}

	try {
		const shell = process.env.SHELL?.trim() || "sh";
		const result = await dependencies.runSubprocessEvent(
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

		if (!result || result.exitCode !== 0) {
			logger.core.log("Connector authorization hook failed closed", {
				severity: "warn",
				adapter: input.adapter,
				event: "session.authorize",
				code: result?.exitCode,
				timedOut: result?.timedOut,
				stderr: result?.stderr.trim() || undefined,
			});
			return { ...AUTHORIZATION_HOOK_FAILURE };
		}

		const parsed = ConnectorAuthorizationDecisionSchema.safeParse(
			result.parsedJson,
		);
		if (parsed.success) {
			return parsed.data;
		}
		logger.core.log("Connector authorization hook returned invalid control", {
			severity: "warn",
			adapter: input.adapter,
			event: "session.authorize",
			parseError: result.parseError,
			stdout: result.stdout.trim() || undefined,
		});
	} catch (error) {
		logger.core.log("Connector authorization hook dispatch failed", {
			severity: "warn",
			adapter: input.adapter,
			event: "session.authorize",
			error,
		});
	}
	return { ...AUTHORIZATION_HOOK_FAILURE };
}
