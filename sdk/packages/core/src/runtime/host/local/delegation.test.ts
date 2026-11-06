import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext, TeamTeammateSpec } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createConfiguredAgentTools } from "../../../extensions/tools/team/configured-agent-tool";
import {
	createDelegatedAgent,
	createDelegatedAgentConfigProvider,
	resolveDelegatedAgentConfig,
} from "../../../extensions/tools/team/delegated-agent";
import { AgentTeamsRuntime } from "../../../extensions/tools/team/multi-agent";
import { createSpawnAgentTool } from "../../../extensions/tools/team/spawn-agent-tool";
import {
	bootstrapAgentTeams,
	createAgentTeamsTools,
} from "../../../extensions/tools/team/team-tools";
import { listDelegationTargets } from "../../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import { SqliteSessionStore } from "../../../services/storage/sqlite-session-store";
import { SqliteTeamStore } from "../../../services/storage/sqlite-team-store";
import { FileSessionService } from "../../../session/services/file-session-service";
import { CoreSessionService } from "../../../session/services/session-service";
import { SessionSource } from "../../../types/common";
import type { CoreSessionConfig } from "../../../types/config";
import { RuntimeOAuthTokenManager } from "../../orchestration/runtime-oauth-token-manager";
import { createDelegationResolver } from "./delegation";

const context: AgentToolContext = { agentId: "lead", iteration: 1 };
const target = { providerId: "deepseek", modelId: "deepseek-chat" };
const prompt = {
	task: "Review the supplied example.",
	systemPrompt: "Give a concise review.",
};

describe("configured delegation connections", () => {
	let dir: string;
	let settings: ProviderSettingsManager;
	let store: SqliteSessionStore | undefined;
	let endpoint: string;
	let close: () => Promise<void>;
	let requests: Array<{
		path: string;
		model: string;
		headers: IncomingHttpHeaders;
	}>;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "delegation-"));
		requests = [];
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = z
				.object({ model: z.string() })
				.parse(JSON.parse(Buffer.concat(chunks).toString()));
			requests.push({
				path: req.url ?? "",
				model: body.model,
				headers: req.headers,
			});
			if (
				body.model === "rejected-model" ||
				req.headers.authorization?.endsWith("expired-token")
			) {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: { message: "Synthetic authentication failure" },
					}),
				);
				return;
			}
			const text =
				body.model === "deepseek-chat"
					? "Finding\n".repeat(90)
					: "Short review";
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const data of [
				{
					choices: [
						{
							index: 0,
							delta: { role: "assistant", content: text },
							finish_reason: null,
						},
					],
				},
				{
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
				},
			])
				res.write(
					`data: ${JSON.stringify({ id: "synthetic-completion", object: "chat.completion.chunk", created: 1, model: body.model, ...data })}\n\n`,
				);
			res.end("data: [DONE]\n\n");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing test listener");
		endpoint = `http://127.0.0.1:${address.port}`;
		close = () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		settings = new ProviderSettingsManager({
			filePath: join(dir, "providers.json"),
		});
		settings.saveProviderSettings({
			provider: "deepseek",
			model: target.modelId,
			apiKey: "child-key",
			baseUrl: `${endpoint}/child`,
			headers: { "X-Route": "child" },
		});
	});

	afterEach(async () => {
		await close();
		vi.unstubAllEnvs();
		store?.close();
		store = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	function parent(
		oauth = new RuntimeOAuthTokenManager({ providerSettingsManager: settings }),
	) {
		const config: CoreSessionConfig = {
			providerId: "openai-compatible",
			modelId: "parent-model",
			systemPrompt: "Lead",
			cwd: dir,
			enableTools: false,
			enableSpawnAgent: true,
			enableAgentTeams: true,
			apiKey: "parent-key",
			baseUrl: `${endpoint}/parent`,
			headers: { "X-Route": "parent" },
			extensionContext: { workspace: { cwd: dir, rootPath: dir } },
		};
		return createDelegatedAgentConfigProvider(
			config,
			createDelegationResolver({
				rootConfig: () => config,
				sessionId: "synthetic-session",
				source: SessionSource.CORE,
				settings,
				oauth,
			}),
		);
	}

	it.each([
		"file",
		"sqlite",
	])("sends selected generic, profile, and nested requests with %s persistence", async (storage) => {
		const provider = parent();
		let nestedProvider = provider;
		const sessionsDir = join(dir, "sessions");
		if (storage === "sqlite") store = new SqliteSessionStore({ sessionsDir });
		const service = store
			? new CoreSessionService(store, { sessionArtifactsDir: sessionsDir })
			: new FileSessionService(sessionsDir);
		await service.createRootSessionWithArtifacts({
			sessionId: "synthetic-session",
			source: SessionSource.CORE,
			pid: process.pid,
			interactive: false,
			provider: "openai-compatible",
			model: "parent-model",
			cwd: dir,
			workspaceRoot: dir,
			enableTools: false,
			enableSpawn: true,
			enableTeams: true,
			prompt: "Lead",
			startedAt: new Date().toISOString(),
		});
		const spawn = createSpawnAgentTool({
			configProvider: provider,
			onSubAgentStart: async (start) => {
				// A hook may create the provisional row before the resolved lifecycle arrives.
				await service.upsertSubagentSession({
					agentId: start.subAgentId,
					conversationId: start.conversationId,
					parentAgentId: start.parentAgentId,
					rootSessionId: "synthetic-session",
				});
				await service.handleSubAgentStart("synthetic-session", start);
			},
			onSubAgentEnd: (end) =>
				service.handleSubAgentEnd("synthetic-session", end),
			createSubAgentTools: (_input, _context, child) => {
				nestedProvider = child;
				return [];
			},
		});
		const result = await spawn.execute({ ...prompt, target }, context);
		expect(result.target).toEqual(target);
		expect(result.text).toBe("Finding\n".repeat(90));
		expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
		expect(
			(await service.listSessions(10)).filter((row) => row.isSubagent),
		).toEqual([
			expect.objectContaining({
				provider: target.providerId,
				model: target.modelId,
				status: "completed",
			}),
		]);
		await createSpawnAgentTool({ configProvider: nestedProvider }).execute(
			prompt,
			context,
		);
		const [profile] = createConfiguredAgentTools({
			configProvider: provider,
			agents: [
				{
					name: "review",
					description: "Review",
					systemPrompt: prompt.systemPrompt,
					...target,
				},
			],
		});
		await profile?.execute({ prompt: prompt.task }, context);
		await spawn.execute(prompt, context);
		expect(
			requests.map((request) => [
				request.path,
				request.model,
				request.headers.authorization,
				request.headers["x-route"],
			]),
		).toEqual([
			["/child/chat/completions", target.modelId, "Bearer child-key", "child"],
			["/child/chat/completions", target.modelId, "Bearer child-key", "child"],
			["/child/chat/completions", target.modelId, "Bearer child-key", "child"],
			[
				"/parent/chat/completions",
				"parent-model",
				"Bearer parent-key",
				"parent",
			],
		]);
		expect(nestedProvider.getRuntimeConfig().extensionContext).toEqual(
			provider.getRuntimeConfig().extensionContext,
		);
	});

	it("restores a selected teammate and preserves successful results alongside a failed sibling", async () => {
		const provider = parent();
		const definitions: TeamTeammateSpec[] = [];
		const original = new AgentTeamsRuntime({
			teamName: "original",
			onTeamEvent: (event) => {
				if (event.type === "teammate_spawned")
					definitions.push({ agentId: event.agentId, ...event.teammate });
			},
		});
		const tools = createAgentTeamsTools({
			runtime: original,
			requesterId: "lead",
			teammateConfigProvider: provider,
		});
		await tools
			.find((tool) => tool.name === "team_spawn_teammate")
			?.execute(
				{ agentId: "reviewer", rolePrompt: prompt.systemPrompt, target },
				context,
			);
		const teamStore = new SqliteTeamStore({ teamDir: join(dir, "teams") });
		teamStore.init();
		teamStore.persistRuntime("original", original.exportState(), definitions);
		const loaded = teamStore.loadRuntime("original");
		teamStore.close();
		const restored = new AgentTeamsRuntime({ teamName: "restored" });
		await bootstrapAgentTeams({
			runtime: restored,
			teammateConfigProvider: provider,
			restoredTeammates: loaded.teammates,
		});
		const restoredTools = createAgentTeamsTools({
			runtime: restored,
			requesterId: "lead",
			teammateConfigProvider: provider,
		});
		await restoredTools
			.find((tool) => tool.name === "team_spawn_teammate")
			?.execute(
				{
					agentId: "bad",
					rolePrompt: "Review",
					target: { ...target, modelId: "rejected-model" },
				},
				context,
			);
		restored.updateTeammateConnections(
			{ apiKey: "unrelated-root-key", baseUrl: `${endpoint}/wrong` },
			"openai-compatible",
		);
		const good = restored.startTeammateRun("reviewer", prompt.task);
		const bad = restored.startTeammateRun("bad", prompt.task);
		const awaitRuns = restoredTools.find(
			(tool) => tool.name === "team_await_runs",
		);
		expect(awaitRuns).toBeDefined();
		const all = await awaitRuns?.execute({}, context);
		expect(all).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: good.id,
					status: "completed",
					resultSummary: expect.objectContaining({
						textPreview: expect.any(String),
					}),
				}),
				expect.objectContaining({
					id: bad.id,
					status: "failed",
					error: expect.any(String),
				}),
			]),
		);
		expect(JSON.stringify(all)).not.toContain("Finding\\n".repeat(90));
		expect(await awaitRuns?.execute({ runId: bad.id }, context)).toMatchObject({
			status: "failed",
			error: expect.any(String),
		});
		const selected = await awaitRuns?.execute({ runId: good.id }, context);
		expect(selected).toMatchObject({
			resultSummary: { text: "Finding\n".repeat(90) },
		});
		expect(
			requests.every(
				(request) =>
					request.path === "/child/chat/completions" &&
					request.headers.authorization === "Bearer child-key",
			),
		).toBe(true);
	});

	it("refreshes a subscription child before retrying without changing its parent", async () => {
		settings.saveProviderSettings({
			provider: "cline",
			baseUrl: `${endpoint}/subscription`,
			auth: { accessToken: "expired-token" },
		});
		const oauth = new RuntimeOAuthTokenManager({
			providerSettingsManager: settings,
		});
		const resolveKey = vi
			.spyOn(oauth, "resolveProviderApiKey")
			.mockImplementation(async (input) => {
				const apiKey = input.forceRefresh ? "fresh-token" : "expired-token";
				settings.saveProviderSettings({
					provider: "cline",
					baseUrl: `${endpoint}/subscription`,
					auth: { accessToken: apiKey },
				});
				return { apiKey, refreshed: Boolean(input.forceRefresh) };
			});
		const provider = parent(oauth);
		const refreshParent = vi.fn(async () => true);
		provider.updateConnectionDefaults({
			onAuthError: refreshParent,
			maxTokensPerTurn: 71,
			temperature: 0.2,
		});
		const selected = await resolveDelegatedAgentConfig(provider, {
			providerId: "cline-pass",
			modelId: "review-model",
		});
		const child = createDelegatedAgent({
			kind: "subagent",
			prompt: prompt.systemPrompt,
			tools: [],
			configProvider: selected,
		});
		expect((await child.run(prompt.task)).text).toBe("Short review");
		expect(
			requests.map((request) => [request.path, request.headers.authorization]),
		).toEqual([
			["/subscription/chat/completions", "Bearer workos:expired-token"],
			["/subscription/chat/completions", "Bearer workos:fresh-token"],
		]);
		expect(resolveKey).toHaveBeenLastCalledWith({
			providerId: "cline-pass",
			forceRefresh: true,
		});
		expect(refreshParent).not.toHaveBeenCalled();
		expect(provider.getRuntimeConfig().apiKey).toBe("parent-key");
		const inherited = await resolveDelegatedAgentConfig(provider);
		expect(inherited.getRuntimeConfig()).toMatchObject({
			maxTokensPerTurn: 71,
			temperature: 0.2,
		});
	});

	it("inherits live reasoning settings after the parent disables an older provider snapshot", async () => {
		const provider = parent();
		provider.updateConnectionDefaults({
			providerConfig: {
				providerId: "openai-compatible",
				modelId: "parent-model",
				thinking: true,
				reasoningEffort: "high",
				thinkingBudgetTokens: 1024,
			},
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
		});
		const disabled = await resolveDelegatedAgentConfig(provider);
		expect(disabled.getConnectionConfig()).toMatchObject({
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
		});
		provider.updateConnectionDefaults({
			thinking: true,
			thinkingBudgetTokens: 2048,
		});
		const enabled = await resolveDelegatedAgentConfig(provider);
		expect(enabled.getConnectionConfig()).toMatchObject({
			thinking: true,
			thinkingBudgetTokens: 2048,
		});
	});

	it("keeps healthy restored teammates usable when a sibling needs reauthentication", async () => {
		const oauth = new RuntimeOAuthTokenManager({
			providerSettingsManager: settings,
		});
		vi.spyOn(oauth, "resolveProviderApiKey").mockRejectedValue(
			new Error("Subscription requires reauthentication"),
		);
		const runtime = new AgentTeamsRuntime({ teamName: "partial-restore" });
		const result = await bootstrapAgentTeams({
			runtime,
			teammateConfigProvider: parent(oauth),
			restoredTeammates: [
				{ agentId: "healthy", rolePrompt: "Review", ...target },
				{
					agentId: "blocked",
					rolePrompt: "Review",
					providerId: "cline-pass",
					modelId: "review-model",
				},
			],
		});
		expect(result.restoredTeammates).toEqual(["healthy"]);
		expect(runtime.exportState().missionLog).toContainEqual(
			expect.objectContaining({
				kind: "error",
				summary: expect.stringContaining("blocked"),
			}),
		);
		expect((await runtime.routeToTeammate("healthy", prompt.task)).text).toBe(
			"Finding\n".repeat(90),
		);
	});

	it("does not start a request if cancellation arrives during connection resolution", async () => {
		const controller = new AbortController();
		const oauth = new RuntimeOAuthTokenManager({
			providerSettingsManager: settings,
		});
		vi.spyOn(oauth, "resolveProviderApiKey").mockImplementation(async () => {
			controller.abort();
			return { apiKey: "unused-token", refreshed: false };
		});
		const spawn = createSpawnAgentTool({ configProvider: parent(oauth) });
		await expect(
			spawn.execute(
				{
					...prompt,
					target: { providerId: "cline-pass", modelId: "review-model" },
				},
				{ ...context, signal: controller.signal },
			),
		).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

	it("discovers environment-configured routes without exposing the environment key", async () => {
		vi.stubEnv("XAI_API_KEY", "synthetic-environment-key");
		const result = await listDelegationTargets(settings, {
			query: "xai",
			current: { providerId: "openai-compatible", modelId: "parent-model" },
		});
		expect(result.targets).toContainEqual(
			expect.objectContaining({
				target: expect.objectContaining({ providerId: "xai" }),
			}),
		);
		expect(JSON.stringify(result)).not.toContain("synthetic-environment-key");
	});

	it("discovers only configured targets without exposing connection secrets", async () => {
		const result = await listDelegationTargets(settings, { query: "deepseek" });
		expect(result.targets).toContainEqual(expect.objectContaining({ target }));
		expect(
			result.targets.every(
				(entry) => entry.target.providerId === target.providerId,
			),
		).toBe(true);
		expect(result.targets.length).toBeLessThanOrEqual(20);
		expect(JSON.stringify(result)).not.toMatch(
			/child-key|X-Route|baseUrl|apiKey|accessToken|refreshToken/,
		);
		settings.saveProviderSettings({
			provider: "cline",
			auth: { accessToken: "subscription-token" },
		});
		const subscription = await listDelegationTargets(settings, {
			query: "cline-pass",
		});
		expect(subscription.targets).toContainEqual(
			expect.objectContaining({
				target: expect.objectContaining({ providerId: "cline-pass" }),
				billing: "subscription",
			}),
		);
	});
});
