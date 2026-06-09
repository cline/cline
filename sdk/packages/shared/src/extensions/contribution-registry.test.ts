import { describe, expect, it, vi } from "vitest";
import { createContributionRegistry } from "./contribution-registry";

describe("ContributionRegistry automation event contributions", () => {
	it("accepts skills-only plugins without setup contributions", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "skill-pack",
					manifest: { capabilities: ["skills"] },
				},
			],
		});

		await expect(registry.initialize()).resolves.toBeUndefined();
		expect(registry.getRegistrySnapshot()).toMatchObject({
			tools: [],
			commands: [],
			rules: [],
			messageBuilder: [],
			providers: [],
			automationEventTypes: [],
		});
	});

	it("registers automation event types declared by plugins", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "local-events",
					manifest: { capabilities: ["automationEvents"] },
					setup(api) {
						api.registerAutomationEventType({
							eventType: " local.manual_test ",
							source: " local ",
							description: "Manual local smoke test",
							attributesSchema: {
								type: "object",
								properties: { topic: { type: "string" } },
							},
							examples: [
								{
									eventId: "evt_1",
									eventType: "local.manual_test",
									source: "local",
									occurredAt: "2026-04-24T10:00:00.000Z",
									attributes: { topic: "cron-feature-2" },
								},
							],
						});
					},
				},
			],
		});

		await registry.initialize();

		expect(registry.getRegistrySnapshot().automationEventTypes).toEqual([
			expect.objectContaining({
				eventType: "local.manual_test",
				source: "local",
				description: "Manual local smoke test",
			}),
		]);
		expect(registry.getRegisteredAutomationEventTypes()).toHaveLength(1);
	});

	it("passes automation ingestion context into setup", async () => {
		const ingestEvent = vi.fn();
		const registry = createContributionRegistry({
			setupContext: {
				automation: { ingestEvent },
			},
			extensions: [
				{
					name: "event-source",
					manifest: { capabilities: ["automationEvents"] },
					setup(_api, ctx) {
						ctx.automation?.ingestEvent({
							eventId: "evt_plugin_1",
							eventType: "local.plugin_event",
							source: "local-plugin",
							occurredAt: "2026-04-24T10:00:00.000Z",
						});
					},
				},
			],
		});

		await registry.initialize();

		expect(ingestEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "evt_plugin_1",
				eventType: "local.plugin_event",
			}),
		);
	});

	it("passes caller identity and logger context into setup", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const registry = createContributionRegistry({
			setupContext: {
				session: { sessionId: "sess-1" },
				client: { name: "cline-sdk", version: "1.0.0" },
				user: { distinctId: "user-1" },
				workspaceInfo: { rootPath: "/tmp/workspace" },
				logger,
			},
			extensions: [
				{
					name: "context-plugin",
					manifest: { capabilities: ["tools"] },
					setup(_api, ctx) {
						ctx.logger?.log("plugin setup", {
							sessionId: ctx.session?.sessionId,
							client: ctx.client?.name,
						});
					},
				},
			],
		});

		await registry.initialize();

		expect(logger.log).toHaveBeenCalledWith("plugin setup", {
			sessionId: "sess-1",
			client: "cline-sdk",
		});
	});

	it("requires the automationEvents capability before registration", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "missing-capability",
					manifest: { capabilities: ["tools"] },
					setup(api) {
						api.registerAutomationEventType({
							eventType: "local.bad",
							source: "local",
						});
					},
				},
			],
		});

		await expect(registry.initialize()).rejects.toThrow(
			/registerAutomationEventType requires the "automationEvents" capability/,
		);
	});
});

describe("ContributionRegistry tool contributions", () => {
	it("rejects raw plugin tool schemas with regex lookaround patterns", async () => {
		const registry = createContributionRegistry({
			extensions: [
				{
					name: "raw-tool-plugin",
					manifest: { capabilities: ["tools"] },
					setup(api) {
						api.registerTool({
							name: "save_handoff",
							description: "Save a handoff file",
							inputSchema: {
								type: "object",
								properties: {
									path: {
										type: "string",
										pattern:
											"^(?!\\/)(?!.*(?:^|\\/)\\.\\.(?:\\/|$))[A-Za-z0-9._/-]+$",
									},
								},
								required: ["path"],
							},
							execute: async () => ({ ok: true }),
						});
					},
				},
			],
		});

		await expect(registry.initialize()).rejects.toThrow(
			/raw-tool-plugin\.save_handoff.*\$\.properties\.path\.pattern.*lookaround/i,
		);
	});
});
