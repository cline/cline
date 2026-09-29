import type { HubCommandEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { StartSessionInput } from "../../../runtime/host/runtime-host";
import type { HubTransportContext } from "./context";
import {
	handleSessionCreate,
	readHubClientContext,
	readHubUserContext,
	readSessionConnectionUpdate,
	resolveSessionAutoApproveTools,
	selectSessionTools,
} from "./session-handlers";

const tool = (name: string) => ({ name });

describe("readHubClientContext", () => {
	it("accepts the serializable client identity used for telemetry", () => {
		expect(
			readHubClientContext({
				name: " cline-desktop ",
				version: " 0.0.23 ",
				platform: " Cline Desktop ",
				platformVersion: " 0.0.23 ",
				isMultiRoot: false,
			}),
		).toEqual({
			name: "cline-desktop",
			version: "0.0.23",
			platform: "Cline Desktop",
			platformVersion: "0.0.23",
			isMultiRoot: false,
		});
	});

	it("rejects a client context without a name", () => {
		expect(readHubClientContext({ version: "0.0.23" })).toBeUndefined();
	});
});

describe("readHubUserContext", () => {
	it("accepts the serializable authenticated identity used for telemetry", () => {
		expect(
			readHubUserContext({
				distinctId: " account-1 ",
				accountId: " account-1 ",
				email: " dev@example.com ",
				organizationId: " org-1 ",
			}),
		).toEqual({
			distinctId: "account-1",
			accountId: "account-1",
			email: "dev@example.com",
			organizationId: "org-1",
		});
	});

	it("rejects an empty user context", () => {
		expect(readHubUserContext({ distinctId: " " })).toBeUndefined();
	});

	it("preserves an explicit signed-out account state", () => {
		expect(
			readHubUserContext({ distinctId: "machine-1", accountId: null }),
		).toEqual({ distinctId: "machine-1", accountId: null });
	});
});

describe("selectSessionTools", () => {
	it("excludes tasks in yolo mode and CLI/VS Code sessions", () => {
		const tools = [tool("read_files"), tool("tasks")];

		expect(selectSessionTools(tools, "act").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "plan").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "zen").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "yolo").map(({ name }) => name)).toEqual([
			"read_files",
		]);
		expect(
			selectSessionTools(tools, "act", "cli").map(({ name }) => name),
		).toEqual(["read_files"]);
		expect(
			selectSessionTools(tools, "act", "cline-cli-zen").map(({ name }) => name),
		).toEqual(["read_files"]);
		expect(
			selectSessionTools(tools, "act", "vscode").map(({ name }) => name),
		).toEqual(["read_files"]);
	});
});

describe("readSessionConnectionUpdate", () => {
	it("enables thinking when a positive budget is supplied without thinking", () => {
		expect(readSessionConnectionUpdate({ thinkingBudgetTokens: 2048 })).toEqual(
			{
				thinking: true,
				thinkingBudgetTokens: 2048,
			},
		);
	});

	it("lets explicit thinking disable override reasoning fields", () => {
		const updates = readSessionConnectionUpdate({
			thinking: false,
			reasoningEffort: "high",
			thinkingBudgetTokens: 2048,
		});

		expect(updates.thinking).toBe(false);
		expect(Object.hasOwn(updates, "reasoningEffort")).toBe(true);
		expect(updates.reasoningEffort).toBeUndefined();
		expect(Object.hasOwn(updates, "thinkingBudgetTokens")).toBe(true);
		expect(updates.thinkingBudgetTokens).toBeUndefined();
	});
});

describe("resolveSessionAutoApproveTools", () => {
	it("prefers the effective global tool policy", () => {
		expect(
			resolveSessionAutoApproveTools(
				{ "*": { autoApprove: false } },
				{ autoApproveTools: true },
			),
		).toBe(false);
		expect(
			resolveSessionAutoApproveTools(
				{ "*": { autoApprove: true } },
				{ autoApproveTools: false },
			),
		).toBe(true);
	});

	it("falls back to the runtime option", () => {
		expect(resolveSessionAutoApproveTools(undefined, {})).toBe(false);
		expect(
			resolveSessionAutoApproveTools(undefined, { autoApproveTools: true }),
		).toBe(true);
	});
});

// Exercise the real command handler with the JSON payload sent by SDK clients.
describe("handleSessionCreate unattended defaults", () => {
	it.each<{
		name: string;
		payload: NonNullable<HubCommandEnvelope["payload"]>;
		mode: StartSessionInput["config"]["mode"];
		autoApprove: boolean;
	}>([
		{
			name: "SDK wildcard auto-approval",
			payload: { toolPolicies: { "*": { autoApprove: true } } },
			mode: "yolo",
			autoApprove: true,
		},
		{
			name: "config wildcard auto-approval",
			payload: {
				sessionConfig: { toolPolicies: { "*": { autoApprove: true } } },
			},
			mode: "yolo",
			autoApprove: true,
		},
		{
			name: "runtime auto-approval",
			payload: { runtimeOptions: { autoApproveTools: true } },
			mode: "yolo",
			autoApprove: true,
		},
		{
			name: "explicit act",
			payload: {
				sessionConfig: { mode: "act" },
				toolPolicies: { "*": { autoApprove: true } },
			},
			mode: "act",
			autoApprove: true,
		},
		{
			name: "explicit runtime act",
			payload: { runtimeOptions: { mode: "act", autoApproveTools: true } },
			mode: "act",
			autoApprove: true,
		},
		{
			name: "explicit plan",
			payload: {
				sessionConfig: { mode: "plan" },
				toolPolicies: { "*": { autoApprove: true } },
			},
			mode: "plan",
			autoApprove: true,
		},
		{
			name: "interactive auto-approval",
			payload: {
				metadata: { interactive: true },
				toolPolicies: { "*": { autoApprove: true } },
			},
			mode: undefined,
			autoApprove: true,
		},
		{
			name: "no approval policy",
			payload: {},
			mode: undefined,
			autoApprove: false,
		},
		{
			name: "empty policy overrides runtime approval",
			payload: { toolPolicies: {}, runtimeOptions: { autoApproveTools: true } },
			mode: undefined,
			autoApprove: false,
		},
		{
			name: "empty policy overrides config approval",
			payload: {
				toolPolicies: {},
				sessionConfig: { toolPolicies: { "*": { autoApprove: true } } },
			},
			mode: undefined,
			autoApprove: false,
		},
		{
			name: "disabled runtime approval overrides config",
			payload: {
				runtimeOptions: { autoApproveTools: false },
				sessionConfig: { toolPolicies: { "*": { autoApprove: true } } },
			},
			mode: undefined,
			autoApprove: false,
		},
	])("resolves $name before selecting tools", async ({
		payload,
		mode,
		autoApprove,
	}) => {
		const startSession = vi
			.fn()
			.mockResolvedValue({ sessionId: "session-test" });
		const ctx = {
			sessionHost: {
				startSession,
				getSession: vi.fn().mockResolvedValue(undefined),
			},
			sessionState: new Map(),
			sessionTools: [tool("tasks"), tool("custom_tool")],
		} as unknown as HubTransportContext;
		const reply = await handleSessionCreate(
			ctx,
			{
				version: "v1",
				requestId: "request-test",
				clientId: "client-test",
				command: "session.create",
				payload: JSON.parse(
					JSON.stringify({ metadata: { interactive: false }, ...payload }),
				),
			},
			vi.fn().mockResolvedValue({ approved: true }),
		);
		expect(reply.ok).toBe(true);
		const input = startSession.mock.calls[0]?.[0] as StartSessionInput;
		expect(input.config.mode).toBe(mode);
		expect(input.config.enableSpawnAgent).toBeUndefined();
		expect(input.config.enableAgentTeams).toBeUndefined();
		expect(input.sessionMetadata?.autoApproveTools).toBe(autoApprove);
		expect(input.localRuntime?.extraTools?.map((entry) => entry.name)).toEqual(
			mode === "yolo" ? ["custom_tool"] : ["tasks", "custom_tool"],
		);
	});

	it.each([
		true,
		false,
	])("preserves explicit spawn/team settings: %s", async (enabled) => {
		const startSession = vi
			.fn()
			.mockResolvedValue({ sessionId: "session-test" });
		const ctx = {
			sessionHost: {
				startSession,
				getSession: vi.fn().mockResolvedValue(undefined),
			},
			sessionState: new Map(),
		} as unknown as HubTransportContext;
		await handleSessionCreate(
			ctx,
			{
				version: "v1",
				requestId: "request-test",
				command: "session.create",
				payload: {
					metadata: { interactive: false },
					runtimeOptions: {
						autoApproveTools: true,
						enableSpawn: enabled,
						enableTeams: enabled,
					},
				},
			},
			vi.fn().mockResolvedValue({ approved: true }),
		);
		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					mode: "yolo",
					enableSpawnAgent: enabled,
					enableAgentTeams: enabled,
				}),
			}),
		);
	});
});
