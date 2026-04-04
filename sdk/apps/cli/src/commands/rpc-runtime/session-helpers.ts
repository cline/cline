import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AgentHooks } from "@clinebot/agents";
import {
	type DefaultSessionManager,
	LlmsProviders,
	type RpcChatMessage,
	type RpcChatRunTurnRequest,
	type RpcChatRuntimeConfigBase,
	type RpcChatStartSessionRequest,
	type RpcChatTurnResult,
	SessionSource,
	setHomeDir,
	setHomeDirIfUnset,
} from "@clinebot/core";
import { createCliLoggerAdapter } from "../../logging/adapter";
import { resolveSystemPrompt } from "../../runtime/prompt";
import { getCliTelemetryService } from "../../utils/telemetry";

function sanitizeFilename(name: string, index: number): string {
	const base = basename(name || `attachment-${index + 1}`);
	return base.replace(/[^\w.-]+/g, "_");
}

export async function materializeUserFiles(
	files: Array<{ name: string; content: string }> | undefined,
): Promise<{ tempDir?: string; paths: string[] }> {
	if (!files || files.length === 0) {
		return { paths: [] };
	}

	const resolvedTempDir = await mkdtemp(`${tmpdir()}/cline-rpc-attachments-`);
	const paths: string[] = [];
	for (const [index, file] of files.entries()) {
		const safeName = sanitizeFilename(file.name, index);
		const path = join(resolvedTempDir, safeName);
		await writeFile(path, file.content, "utf8");
		paths.push(path);
	}
	return { tempDir: resolvedTempDir, paths };
}

export async function cleanupMaterializedFiles(
	tempDir?: string,
): Promise<void> {
	if (!tempDir) {
		return;
	}
	try {
		await rm(tempDir, {
			recursive: true,
			force: true,
		});
	} catch {
		// best effort cleanup
	}
}

function resolveMode(config: RpcChatStartSessionRequest): "act" | "plan" {
	return config.mode === "plan" ? "plan" : "act";
}

function resolveSessionCwd(config: RpcChatStartSessionRequest): string {
	return (config.cwd?.trim() || config.workspaceRoot).trim();
}

function resolveToolPolicies(
	config: RpcChatStartSessionRequest,
): RpcChatRuntimeConfigBase["toolPolicies"] {
	const explicit = config.toolPolicies;
	if (explicit) {
		return explicit;
	}
	return {
		"*": {
			autoApprove: config.autoApproveTools !== false,
		},
	};
}

export async function buildSessionStartInput(input: {
	config: RpcChatStartSessionRequest;
	sessionId?: string;
	initialMessages?: LlmsProviders.Message[];
	hooks?: AgentHooks;
}): Promise<{
	mode: "act" | "plan";
	sessionInput: Parameters<DefaultSessionManager["start"]>[0];
}> {
	const { config } = input;
	const mode = resolveMode(config);
	const cwd = resolveSessionCwd(config);
	const providerId = LlmsProviders.normalizeProviderId(config.provider);
	const systemPrompt = await resolveSystemPrompt({
		cwd,
		explicitSystemPrompt: config.systemPrompt,
		providerId,
		rules: config.rules,
		mode: config.autoApproveTools ? "yolo" : mode,
	});
	const logger = createCliLoggerAdapter({
		runtime: "rpc-runtime",
		component: "session-runtime",
		runtimeConfig: config.logger,
	});

	return {
		mode,
		sessionInput: {
			source: SessionSource.CLI,
			interactive: true,
			initialMessages: input.initialMessages,
			config: {
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
				providerId,
				modelId: config.model,
				mode,
				apiKey: config.apiKey?.trim() || undefined,
				cwd,
				workspaceRoot: config.workspaceRoot,
				systemPrompt,
				maxIterations: config.maxIterations,
				enableTools: config.enableTools,
				enableSpawnAgent: config.enableSpawn,
				enableAgentTeams: config.enableTeams,
				teamName: config.teamName,
				missionLogIntervalSteps: config.missionStepInterval,
				missionLogIntervalMs: config.missionTimeIntervalMs,
				hooks: input.hooks,
				logger: logger.core,
				telemetry: getCliTelemetryService(logger.core),
			},
			toolPolicies: resolveToolPolicies(config),
		},
	};
}

export function applyHomeDir(config: RpcChatStartSessionRequest): void {
	const homeDir = config.sessions?.homeDir?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
		return;
	}
	setHomeDirIfUnset(homedir());
}

export function parseStartPayload(
	request: RpcChatStartSessionRequest,
): RpcChatStartSessionRequest {
	const parsed = request as RpcChatStartSessionRequest & {
		maxIterations?: unknown;
	};
	const normalizedMaxIterations =
		typeof parsed.maxIterations === "number" &&
		Number.isFinite(parsed.maxIterations) &&
		parsed.maxIterations > 0
			? Math.floor(parsed.maxIterations)
			: undefined;
	return {
		...parsed,
		maxIterations: normalizedMaxIterations,
	};
}

export function parseSendPayload(
	request: RpcChatRunTurnRequest,
): RpcChatRunTurnRequest {
	const parsed = request as RpcChatRunTurnRequest & {
		config?: RpcChatRunTurnRequest["config"] & {
			maxIterations?: unknown;
		};
	};
	if (!parsed.config) {
		return parsed;
	}
	const normalizedMaxIterations =
		typeof parsed.config.maxIterations === "number" &&
		Number.isFinite(parsed.config.maxIterations) &&
		parsed.config.maxIterations > 0
			? Math.floor(parsed.config.maxIterations)
			: undefined;
	return {
		...parsed,
		config: {
			...parsed.config,
			maxIterations: normalizedMaxIterations,
		},
	};
}

function toRpcMessages(messages: LlmsProviders.Message[]): RpcChatMessage[] {
	return messages as unknown as RpcChatMessage[];
}

export function toRpcTurnResult(result: {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	finishReason: string;
	messages: LlmsProviders.Message[];
	toolCalls: Array<{
		name: string;
		input: unknown;
		output: unknown;
		error?: string;
		durationMs?: number;
	}>;
}): RpcChatTurnResult {
	return {
		text: result.text,
		usage: result.usage,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		iterations: result.iterations,
		finishReason: result.finishReason,
		messages: toRpcMessages(result.messages),
		toolCalls: result.toolCalls.map((call) => ({
			name: call.name,
			input: call.input,
			output: call.output,
			error: call.error,
			durationMs: call.durationMs,
		})),
	};
}

export function shouldRestoreSession(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return message.includes("session not found");
}
