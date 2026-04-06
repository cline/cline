import type {
	AgentHooks,
	HookEventPayload,
	PersistentSubprocessHooksOptions,
	RunHookResult,
} from "@clinebot/core";
import {
	createPersistentSubprocessHooks,
	type HookSessionContext,
} from "@clinebot/core";
import { formatHookDispatchOutput } from "../commands/hook";
import { logSpawnedProcess } from "../logging/process";
import { closeInlineStreamIfNeeded } from "./events";
import {
	buildCliSubcommandCommand,
	buildInternalCliEnv,
	shouldDisableInternalRuntimeHooks,
} from "./internal-launch";
import {
	c,
	emitJsonLine,
	getActiveCliSession,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";

const isDev = process.env.NODE_ENV === "development";

function hasHookControlOutput(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.cancel === true ||
		record.review === true ||
		(typeof record.context === "string" && record.context.trim().length > 0) ||
		(typeof record.contextModification === "string" &&
			record.contextModification.trim().length > 0) ||
		(typeof record.errorMessage === "string" &&
			record.errorMessage.trim().length > 0) ||
		Object.hasOwn(record, "overrideInput")
	);
}

function getHookCommand(): string[] | undefined {
	const command = buildCliSubcommandCommand("hook");
	return command ? [command.launcher, ...command.childArgs] : undefined;
}

function getHookWorkerCommand(): string[] | undefined {
	const command = buildCliSubcommandCommand("hook-worker");
	return command ? [command.launcher, ...command.childArgs] : undefined;
}

export function currentHookSessionContext(): HookSessionContext | undefined {
	const session = getActiveCliSession();
	if (!session) {
		return undefined;
	}
	return {
		rootSessionId: session.manifest.session_id,
		hookLogPath: session.hookPath,
	};
}

function writeHookInvocation(
	payload: HookEventPayload,
	options: { verbose: boolean },
	result?: RunHookResult,
): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", {
			type: "hook_event",
			hookEventName: payload.hookName,
			hookOutput: result?.parsedJson,
			agentId: payload.agent_id,
			taskId: payload.taskId,
			parentAgentId: payload.parent_agent_id,
		});
		return;
	}
	if (!options.verbose) {
		if (payload.hookName === "tool_result") {
			return;
		}
		if (
			payload.hookName === "tool_call" &&
			!hasHookControlOutput(result?.parsedJson)
		) {
			return;
		}
	}
	closeInlineStreamIfNeeded();
	const hookName = payload.hookName;
	const toolName =
		payload.hookName === "tool_call"
			? payload.tool_call.name
			: payload.hookName === "tool_result"
				? payload.tool_result.name
				: undefined;
	const details = toolName ? ` ${c.cyan}${toolName}${c.reset}` : "";
	const output = formatHookDispatchOutput(result);
	if (output) {
		write(
			`\n${c.dim}[hook:${hookName}]${c.reset}${details} ${c.dim}-> ${output}${c.reset}\n`,
		);
		return;
	}
	if (details) {
		write(`\n${c.dim}[hook:${hookName}]${c.reset}${details}\n`);
	}
}

export function createRuntimeHooks(options?: {
	verbose?: boolean;
	yolo?: boolean;
}): {
	hooks?: AgentHooks;
	shutdown: () => Promise<void>;
} {
	if (options?.yolo === true || shouldDisableInternalRuntimeHooks()) {
		return {
			hooks: undefined,
			shutdown: async () => {},
		};
	}
	const hookCommand = getHookCommand();
	const workerCommand = getHookWorkerCommand();
	if (!hookCommand || !workerCommand) {
		return {
			hooks: undefined,
			shutdown: async () => {},
		};
	}
	const verbose = options?.verbose === true;
	const sharedOptions: Omit<PersistentSubprocessHooksOptions, "command"> = {
		env: buildInternalCliEnv("hook-worker"),
		cwd: process.cwd(),
		sessionContext: currentHookSessionContext,
		onDispatchError: (error: Error) => {
			if (isDev) {
				writeErr(`hook dispatch failed: ${error.message}`);
			}
		},
		onDispatch: ({
			payload,
			result,
		}: {
			payload: HookEventPayload;
			result?: RunHookResult;
			detached: boolean;
		}) => {
			writeHookInvocation(payload, { verbose }, result);
		},
		onSpawn: ({
			command,
			pid,
			detached,
		}: {
			command: string[];
			pid?: number;
			detached: boolean;
		}) => {
			logSpawnedProcess({
				component: "hooks",
				command,
				childPid: pid,
				detached,
				cwd: process.cwd(),
			});
		},
	};
	const control = createPersistentSubprocessHooks({
		...sharedOptions,
		command: workerCommand,
	});
	return {
		hooks: control.hooks,
		shutdown: async () => {
			await control.client.close();
		},
	};
}
