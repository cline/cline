import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtensionAutomationContext,
	type AgentResult,
	type AgentRuntimeEvent,
	type BasicLogger,
	isChatWorkspacePath,
} from "@cline/shared";
import {
	resolveChatWorkspacePath,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import type { SessionManifest } from "../../session/models/session-manifest";
import { FileSessionService } from "../../session/services/file-session-service";
import { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

const distinctId = "test-machine-id";

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
		prompt: "hello",
		messages_path: "/tmp/messages.json",
	};
}

type PluginEventTestHarness = {
	handlePluginEvent: (
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: AgentExtensionAutomationContext,
	) => Promise<void>;
	getPendingPrompts: (
		sessionId: string,
	) => Array<{ prompt: string; delivery: "queue" | "steer" }>;
};

function createPluginEventHarness(
	manager: RuntimeHostUnderTest,
): PluginEventTestHarness {
	const target = manager as object;
	return {
		handlePluginEvent: async (rootSessionId, event, fallbackAutomation) => {
			const handler = Reflect.get(target, "handlePluginEvent");
			if (typeof handler !== "function") {
				throw new Error("handlePluginEvent test hook unavailable");
			}
			await Reflect.apply(
				handler as (
					rootSessionId: string,
					event: { name: string; payload?: unknown },
					fallbackAutomation?: AgentExtensionAutomationContext,
				) => Promise<void>,
				target,
				[rootSessionId, event, fallbackAutomation],
			);
		},
		getPendingPrompts: (sessionId) => {
			const getter = Reflect.get(target, "getSessionOrThrow");
			if (typeof getter !== "function") {
				throw new Error("getSessionOrThrow test hook unavailable");
			}
			const session = Reflect.apply(
				getter as (sessionId: string) => {
					pendingPrompts: Array<{
						id: string;
						prompt: string;
						delivery: "queue" | "steer";
						userFiles?: unknown;
						userImages?: unknown;
					}>;
				},
				target,
				[sessionId],
			);
			return session.pendingPrompts.map(({ prompt, delivery }) => ({
				prompt,
				delivery,
			}));
		},
	};
}

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return {
		...input,
		...split,
	};
}
