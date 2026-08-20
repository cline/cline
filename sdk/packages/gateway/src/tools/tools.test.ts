import { join } from "node:path";
import {
	createBotId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { createGatewayStores } from "../stores";
import { tempDataRoot } from "../test-support";
import { ToolCatalog } from "./catalog";
import { previewTools, resolveToolSnapshot } from "./resolver";
import { ToolConfigurationStore } from "./store";
import { GatewayToolSystem } from "./system";

describe("tool resolution", () => {
	it("applies provider/model assignments and explains exclusions", () => {
		const catalog = new ToolCatalog().current;
		const preview = previewTools(catalog, {
			providerId: "ollama",
			modelId: "qwen-coder",
			role: "lead",
			global: {
				assignments: [
					{
						when: { providers: ["ollama"] },
						deny: ["builtin:fetch_web_content"],
					},
				],
			},
		});
		expect(preview.canStartRun).toBe(true);
		expect(preview.resolutions).toContainEqual({
			toolId: "builtin:fetch_web_content",
			status: "denied",
			required: false,
			reason: "Denied by an assignment policy",
			source: "assignment",
		});
	});

	it("fails closed when a required tool has no healthy descriptor", () => {
		const catalog = new ToolCatalog();
		catalog.setExecutorHealth("worker:builtin", false);
		const preview = previewTools(catalog.current, {
			providerId: "anthropic",
			modelId: "claude",
			role: "worker",
		});
		expect(preview.canStartRun).toBe(false);
		expect(preview.resolutions).toContainEqual(
			expect.objectContaining({
				toolId: "builtin:read_files",
				status: "required_missing",
			}),
		);
	});

	it("fails closed when policy denies a required profile tool", () => {
		const preview = previewTools(new ToolCatalog().current, {
			providerId: "anthropic",
			modelId: "claude",
			role: "lead",
			global: { assignments: [{ deny: ["builtin:read_files"] }] },
		});
		expect(preview.canStartRun).toBe(false);
		expect(preview.resolutions).toContainEqual(
			expect.objectContaining({
				toolId: "builtin:read_files",
				status: "denied",
			}),
		);
	});

	it("creates deterministic, secret-free snapshots", () => {
		const snapshot = resolveToolSnapshot(new ToolCatalog().current, {
			providerId: "openai",
			modelId: "gpt-test",
			role: "contractor",
			now: 10,
			bot: {
				tools: {
					"builtin:run_commands": {
						approval: "never",
						configuration: { timeoutMs: 100 },
					},
				},
			},
		});
		expect(snapshot.providerId).toBe("openai");
		expect(
			snapshot.tools.find((tool) => tool.id === "builtin:run_commands"),
		).toEqual(
			expect.objectContaining({
				modelFacingName: "run_commands",
				approval: { mode: "never" },
			}),
		);
		expect(JSON.stringify(snapshot)).not.toContain("apiKey");
	});

	it("auto-approves connector tools by default but preserves explicit approval", () => {
		const catalog = new ToolCatalog().current;
		const defaultSnapshot = resolveToolSnapshot(catalog, {
			providerId: "cline",
			modelId: "connector-model",
			role: "lead",
			source: "connector",
			now: 10,
		});
		expect(
			defaultSnapshot.tools.find(
				(tool) => tool.id === "builtin:run_commands",
			)?.approval,
		).toEqual({ mode: "never" });

		const configuredSnapshot = resolveToolSnapshot(catalog, {
			providerId: "cline",
			modelId: "connector-model",
			role: "lead",
			source: "connector",
			bot: {
				tools: {
					"builtin:run_commands": { approval: "always" },
				},
			},
			now: 10,
		});
		expect(
			configuredSnapshot.tools.find(
				(tool) => tool.id === "builtin:run_commands",
			)?.approval,
		).toEqual({ mode: "always" });
	});
});

describe("durable tool configuration and attempts", () => {
	it("uses optimistic revisions and reuses an immutable snapshot on retry", () => {
		const database = openGatewayDatabase(join(tempDataRoot(), "gateway.db"));
		const stores = createGatewayStores(database, "gwi_tools");
		const configurations = new ToolConfigurationStore(database);
		configurations.bootstrap(1);
		const first = configurations.put(
			{ kind: "global" },
			{ profiles: ["coding"] },
			0,
			2,
		);
		expect(first.revision).toBe(1);
		expect(() => configurations.put({ kind: "global" }, {}, 0, 3)).toThrow(
			"revision conflict",
		);

		const botId = createBotId();
		stores.bots.save({
			identity: {
				botId,
				name: "bot",
				role: "lead",
				parentBotId: null,
				provenance: { createdBy: "bootstrap" },
				createdAt: 1,
			},
			config: { providerId: "anthropic", modelId: "claude" },
			status: "active",
			revision: 0,
		});
		const runId = createRunId();
		const invocation = {
			runId,
			sessionId: createSessionId(),
			botId,
			input: "test",
			workspaceRoot: "/workspace",
			effectiveConfig: { providerId: "anthropic", modelId: "claude" },
		};
		const system = new GatewayToolSystem({
			configurations,
			attempts: stores.attempts,
			getBot: (id) => stores.bots.get(id as never),
			resolveModelSelection: () => ({
				providerId: "anthropic",
				modelId: "claude",
			}),
			clock: () => 10,
		});
		const attempt1 = stores.attempts.begin(runId, 10);
		const prepared1 = system.prepareAttempt(invocation, attempt1.attempt);
		system.catalog.setExecutorHealth("worker:builtin", false);
		const attempt2 = stores.attempts.begin(runId, 20);
		const prepared2 = system.prepareAttempt(invocation, attempt2.attempt);
		expect(prepared2.executionSnapshot).toEqual(prepared1.executionSnapshot);
		database.close();
	});

	it("captures connector auto-approval in the immutable attempt snapshot", () => {
		const database = openGatewayDatabase(join(tempDataRoot(), "gateway.db"));
		const stores = createGatewayStores(database, "gwi_connector_tools");
		const configurations = new ToolConfigurationStore(database);
		configurations.bootstrap(1);
		const botId = createBotId();
		stores.bots.save({
			identity: {
				botId,
				name: "connector bot",
				role: "lead",
				parentBotId: null,
				provenance: { createdBy: "bootstrap" },
				createdAt: 1,
			},
			config: { providerId: "cline", modelId: "connector-model" },
			status: "active",
			revision: 0,
		});
		const runId = createRunId();
		const system = new GatewayToolSystem({
			configurations,
			attempts: stores.attempts,
			getBot: (id) => stores.bots.get(id as never),
			resolveModelSelection: () => ({
				providerId: "cline",
				modelId: "connector-model",
			}),
			clock: () => 10,
		});
		const attempt = stores.attempts.begin(runId, 10);
		const prepared = system.prepareAttempt(
			{
				runId,
				sessionId: createSessionId(),
				botId,
				input: "test",
				workspaceRoot: "/workspace",
				source: "connector",
				effectiveConfig: {
					providerId: "cline",
					modelId: "connector-model",
				},
			},
			attempt.attempt,
		);
		expect(
			prepared.executionSnapshot?.tools.find(
				(tool) => tool.id === "builtin:run_commands",
			)?.approval,
		).toEqual({ mode: "never" });
		database.close();
	});
});
