import { describe, expect, it } from "vitest";
import {
	applyFactoryManagerRequest,
	readHubClientContext,
	readHubUserContext,
	readSessionConnectionUpdate,
	resolveSessionAutoApproveTools,
	selectSessionTools,
	stripServerOwnedSessionMetadata,
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

describe("Factory manager session metadata", () => {
	it("never takes the manager marker from a client and stamps it only for a trusted client's request", () => {
		// A forged marker is dropped, trusted or not.
		for (const trusted of [false, true]) {
			const forged: Record<string, unknown> = {
				factoryManager: { schemaVersion: 1 },
				title: "Chat",
			};
			expect(applyFactoryManagerRequest(forged, trusted)).toBeUndefined();
			expect(forged).toEqual({ title: "Chat" });
		}
		// An untrusted request is refused.
		const untrusted: Record<string, unknown> = {
			factoryManagerRequested: true,
		};
		expect(applyFactoryManagerRequest(untrusted, false)).toMatch(
			/Only the desktop app/,
		);
		expect(untrusted).toEqual({});
		// A trusted request gets the marker the Hub sets.
		const trusted: Record<string, unknown> = {
			factoryManagerRequested: true,
			title: "Factory manager",
		};
		expect(applyFactoryManagerRequest(trusted, true)).toBeUndefined();
		expect(trusted).toEqual({
			title: "Factory manager",
			factoryManager: { schemaVersion: 1 },
		});
		// Never together with a Factory task, intake or remote session.
		for (const key of [
			"factoryTaskId",
			"factoryRole",
			"agendaTaskId",
			"factoryIntake",
			"remoteEnvironmentId",
		])
			expect(
				applyFactoryManagerRequest(
					{ factoryManagerRequested: true, [key]: "x" },
					true,
				),
				key,
			).toMatch(/cannot also be/);
		expect(
			applyFactoryManagerRequest({ factoryManagerRequested: "yes" }, true),
		).toMatch(/must be true/);
	});

	it("strips the manager marker and request from session updates", () => {
		expect(
			stripServerOwnedSessionMetadata({
				factoryManager: { schemaVersion: 1 },
				factoryManagerRequested: true,
				title: "Chat",
			}),
		).toEqual({ title: "Chat" });
	});
});
