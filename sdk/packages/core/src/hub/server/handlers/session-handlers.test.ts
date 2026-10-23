import { describe, expect, it } from "vitest";
import {
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

/**
 * `session.update_connection` must ANNOUNCE what it changed. Without the
 * broadcast, a phone that retargets a session's model updates only itself, and
 * a terminal watching the same session keeps rendering the old model forever —
 * the same one-client-drifts bug `session.update` already solved by publishing
 * `session.updated`. The typed provider/model fields ride the same record.
 */
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import type { SessionRecord as LocalSessionRecord } from "../../../types/sessions";
import type { HubTransportContext } from "./context";
import { handleSessionUpdateConnection } from "./session-handlers";

function localRecord(model: string): LocalSessionRecord {
	return {
		sessionId: "sess_model",
		source: "hub",
		pid: 1,
		startedAt: new Date(1_700_000_000_000).toISOString(),
		endedAt: null,
		exitCode: null,
		status: "idle",
		interactive: true,
		provider: "anthropic",
		model,
		workspaceRoot: "/tmp/w",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: new Date(1_700_000_000_000).toISOString(),
	} as LocalSessionRecord;
}

describe("handleSessionUpdateConnection", () => {
	it("applies the update and broadcasts the refreshed record", async () => {
		const published: HubEventEnvelope[] = [];
		let applied: Record<string, unknown> | undefined;
		let model = "claude-haiku-4-5";
		const ctx = {
			sessionState: new Map(),
			sessionHost: {
				updateSessionConnection: async (
					_sessionId: string,
					updates: Record<string, unknown>,
				) => {
					applied = updates;
					model = String(updates.modelId);
				},
				getSession: async () => localRecord(model),
			},
			publish: (event: HubEventEnvelope) => published.push(event),
			buildEvent: (
				event: HubEventEnvelope["event"],
				payload?: Record<string, unknown>,
				sessionId?: string,
			) => ({ version: "v1", event, payload, sessionId }) as HubEventEnvelope,
		} as unknown as HubTransportContext;

		const reply = await handleSessionUpdateConnection(ctx, {
			version: "v1",
			command: "session.update_connection",
			requestId: "hubreq_uc1",
			clientId: "phone-1",
			sessionId: "sess_model",
			payload: {
				sessionId: "sess_model",
				updates: { modelId: "claude-opus-5" },
			},
		} as unknown as HubCommandEnvelope);

		expect(reply.ok).toBe(true);
		expect(applied).toEqual({ modelId: "claude-opus-5" });
		expect(published).toHaveLength(1);
		expect(published[0]?.event).toBe("session.updated");
		const record = (
			published[0]?.payload as { session?: { model?: string } } | undefined
		)?.session;
		expect(record?.model).toBe("claude-opus-5");
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
